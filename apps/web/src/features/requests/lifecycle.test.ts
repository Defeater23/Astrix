import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  isActive,
  isConsistentHistory,
  isTerminal,
  refreshExpiry,
  transition,
} from './lifecycle';
import type { TransitionInput } from './lifecycle';
import { NOW, numbered, rawRequest, validated } from './fixtures';
import type { Actor, RequestRecord, RequestStatus } from './types';

const STATUSES: RequestStatus[] = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'cancelled',
  'superseded',
];
const ACTORS: Actor[] = ['agent', 'owner', 'system'];

function pending(): RequestRecord {
  const v = numbered(1);
  return {
    request: v.request,
    fingerprint: v.fingerprint,
    status: 'pending',
    history: [{ from: null, to: 'pending', at: NOW, actor: 'agent' }],
  };
}

function approve(record: RequestRecord, now = NOW + 10): RequestRecord {
  const r = transition(record, {
    to: 'approved',
    actor: 'owner',
    now,
    reviewedFingerprint: record.fingerprint,
  });
  if (!r.ok) throw new Error(r.message);
  return r.record;
}

/** A record in each status, built through the real transitions. */
function inStatus(status: RequestStatus): RequestRecord {
  const base = pending();
  const expiresAt = base.request.operation.expiresAt;
  switch (status) {
    case 'pending':
      return base;
    case 'approved':
      return approve(base);
    case 'rejected': {
      const r = transition(base, { to: 'rejected', actor: 'owner', now: NOW + 10 });
      if (!r.ok) throw new Error(r.message);
      return r.record;
    }
    case 'cancelled': {
      const r = transition(base, { to: 'cancelled', actor: 'agent', now: NOW + 10 });
      if (!r.ok) throw new Error(r.message);
      return r.record;
    }
    case 'expired': {
      const r = transition(base, { to: 'expired', actor: 'system', now: expiresAt });
      if (!r.ok) throw new Error(r.message);
      return r.record;
    }
    case 'superseded': {
      const r = transition(base, {
        to: 'superseded',
        actor: 'system',
        now: NOW + 10,
        supersededBy: 'req-2',
      });
      if (!r.ok) throw new Error(r.message);
      return r.record;
    }
  }
}

function inputFor(to: RequestStatus, actor: Actor, record: RequestRecord): TransitionInput {
  const expiresAt = record.request.operation.expiresAt;
  return {
    to,
    actor,
    now: to === 'expired' ? expiresAt + 5 : NOW + 20,
    reviewedFingerprint: record.fingerprint,
    supersededBy: 'req-2',
  };
}

describe('transition matrix', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      for (const actor of ACTORS) {
        const permitted = ALLOWED_TRANSITIONS[from][to]?.includes(actor) ?? false;
        it(`${from} -> ${to} by ${actor} is ${permitted ? 'allowed' : 'refused'}`, () => {
          const record = inStatus(from);
          const result = transition(record, inputFor(to, actor, record));
          expect(result.ok).toBe(permitted);
          if (!result.ok && ALLOWED_TRANSITIONS[from][to] === undefined) {
            expect(result.code).toBe('NOT_ALLOWED');
          }
          if (!result.ok && ALLOWED_TRANSITIONS[from][to] !== undefined) {
            expect(result.code).toBe('ACTOR_NOT_PERMITTED');
          }
        });
      }
    }
  }

  it('treats rejected, expired, cancelled and superseded as final', () => {
    for (const status of ['rejected', 'expired', 'cancelled', 'superseded'] as const) {
      expect(isTerminal(status)).toBe(true);
      expect(isActive(status)).toBe(false);
    }
    expect(isTerminal('pending')).toBe(false);
    expect(isTerminal('approved')).toBe(false);
  });

  it('never lets anyone but the owner approve or reject', () => {
    for (const actor of ['agent', 'system'] as const) {
      expect(
        transition(pending(), {
          to: 'approved',
          actor,
          now: NOW + 5,
          reviewedFingerprint: pending().fingerprint,
        }).ok,
      ).toBe(false);
      expect(transition(pending(), { to: 'rejected', actor, now: NOW + 5 }).ok).toBe(false);
    }
  });

  it('does not let the agent cancel an approved request', () => {
    const r = transition(inStatus('approved'), { to: 'cancelled', actor: 'agent', now: NOW + 30 });
    expect(r.ok).toBe(false);
  });

  it('does not let a rejected or approved decision be flipped', () => {
    expect(
      transition(inStatus('rejected'), {
        to: 'approved',
        actor: 'owner',
        now: NOW + 30,
        reviewedFingerprint: pending().fingerprint,
      }).ok,
    ).toBe(false);
    expect(
      transition(inStatus('approved'), { to: 'rejected', actor: 'owner', now: NOW + 30 }).ok,
    ).toBe(false);
  });
});

describe('transition guards', () => {
  it('refuses to approve or reject an expired request', () => {
    const record = pending();
    const at = record.request.operation.expiresAt;
    for (const to of ['approved', 'rejected'] as const) {
      const r = transition(record, {
        to,
        actor: 'owner',
        now: at,
        reviewedFingerprint: record.fingerprint,
      });
      expect(r).toMatchObject({ ok: false, code: 'EXPIRED' });
    }
    const justBefore = transition(record, {
      to: 'approved',
      actor: 'owner',
      now: at - 1,
      reviewedFingerprint: record.fingerprint,
    });
    expect(justBefore.ok).toBe(true);
  });

  it('refuses to expire a request early', () => {
    const record = pending();
    const r = transition(record, {
      to: 'expired',
      actor: 'system',
      now: record.request.operation.expiresAt - 1,
    });
    expect(r).toMatchObject({ ok: false, code: 'NOT_YET_EXPIRED' });
  });

  it('requires the reviewed fingerprint to match the current request', () => {
    const record = pending();
    expect(transition(record, { to: 'approved', actor: 'owner', now: NOW + 1 })).toMatchObject({
      ok: false,
      code: 'STALE_REVIEW',
    });
    expect(
      transition(record, {
        to: 'approved',
        actor: 'owner',
        now: NOW + 1,
        reviewedFingerprint: 'old',
      }),
    ).toMatchObject({ ok: false, code: 'STALE_REVIEW' });
  });

  it('refuses to approve a record whose payload was altered after storage', () => {
    const record = pending();
    const altered: RequestRecord = {
      ...record,
      request: { ...record.request, operation: { ...record.request.operation, value: '1' } },
    };
    expect(
      transition(altered, {
        to: 'approved',
        actor: 'owner',
        now: NOW + 1,
        reviewedFingerprint: record.fingerprint,
      }),
    ).toMatchObject({
      ok: false,
      code: 'INTEGRITY',
    });
  });

  it('refuses a clock earlier than the last change', () => {
    const record = approve(pending(), NOW + 100);
    expect(transition(record, { to: 'cancelled', actor: 'owner', now: NOW + 50 })).toMatchObject({
      ok: false,
      code: 'CLOCK_BACKWARDS',
    });
  });

  it('requires a replacement id to supersede', () => {
    expect(
      transition(pending(), { to: 'superseded', actor: 'system', now: NOW + 1 }),
    ).toMatchObject({ ok: false, code: 'MISSING_REPLACEMENT' });
  });

  it('records history, the approved fingerprint and never mutates its input', () => {
    const record = pending();
    const frozen = JSON.stringify(record);
    const approved = approve(record);
    expect(JSON.stringify(record)).toBe(frozen);
    expect(approved.history).toHaveLength(2);
    expect(approved.history[1]).toMatchObject({ from: 'pending', to: 'approved', actor: 'owner' });
    expect(approved.approvedFingerprint).toBe(record.fingerprint);
  });
});

describe('refreshExpiry', () => {
  it('expires active records at the expiry time and leaves others alone', () => {
    const record = approve(pending());
    const at = record.request.operation.expiresAt;
    expect(refreshExpiry(record, at - 1)).toBe(record);
    const expired = refreshExpiry(record, at);
    expect(expired.status).toBe('expired');
    expect(expired.history[expired.history.length - 1]).toMatchObject({
      actor: 'system',
      to: 'expired',
    });
    const rejected = inStatus('rejected');
    expect(refreshExpiry(rejected, at + 999)).toBe(rejected);
  });

  it('keeps an approval from outliving its expiry', () => {
    const record = approve(pending());
    expect(refreshExpiry(record, record.request.operation.expiresAt + 1).status).toBe('expired');
  });
});

describe('isConsistentHistory', () => {
  it('accepts histories built by transitions', () => {
    for (const status of STATUSES) expect(isConsistentHistory(inStatus(status))).toBe(true);
  });

  it('rejects forged histories', () => {
    const approved = inStatus('approved');
    const first = approved.history[0];
    const second = approved.history[1];
    if (!first || !second) throw new Error('fixture');
    expect(isConsistentHistory({ ...approved, history: [] })).toBe(false);
    expect(isConsistentHistory({ ...approved, history: [second] })).toBe(false);
    expect(isConsistentHistory({ ...approved, history: [first] })).toBe(false);
    expect(
      isConsistentHistory({ ...approved, history: [first, { ...second, actor: 'agent' }] }),
    ).toBe(false);
    expect(
      isConsistentHistory({ ...approved, history: [first, { ...second, at: first.at - 1 }] }),
    ).toBe(false);
    expect(
      isConsistentHistory({ ...approved, history: [first, { ...second, from: 'approved' }] }),
    ).toBe(false);
    expect(
      isConsistentHistory({ ...approved, history: [{ ...first, actor: 'owner' }, second] }),
    ).toBe(false);
  });

  it('is not fooled by a different request in the same shape', () => {
    const other = validated(rawRequest({ requestId: 'x' }));
    expect(other.fingerprint).not.toBe(pending().fingerprint);
  });
});
