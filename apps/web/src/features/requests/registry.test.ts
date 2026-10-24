import { describe, expect, it } from 'vitest';
import { MAX_RECORDS, cancel, decide, expireDue, submit } from './registry';
import {
  ACCOUNT,
  NOW,
  SPENDER,
  numbered,
  rawRequest,
  recordOf,
  storeWith,
  validated,
} from './fixtures';
import type { RequestStore } from './types';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

describe('submit', () => {
  it('creates a pending record with a creation history entry', () => {
    const result = submit({}, numbered(1), NOW);
    expect(result.kind).toBe('created');
    if (result.kind === 'created') {
      expect(result.record.status).toBe('pending');
      expect(result.record.history).toEqual([
        { from: null, to: 'pending', at: NOW, actor: 'agent' },
      ]);
      expect(result.store['req-1']).toBe(result.record);
    }
  });

  it('returns the existing record when the identical request is submitted again', () => {
    const store = storeWith(numbered(1));
    const result = submit(store, numbered(1), NOW + 5);
    expect(result.kind).toBe('duplicate');
    if (result.kind === 'duplicate') {
      expect(result.store).toBe(store);
      expect(result.record).toBe(recordOf(store, 'req-1'));
    }
  });

  it('keeps answering "duplicate" for the identical request after it is finished', () => {
    const store = storeWith(numbered(1));
    const cancelled = cancel(store, 'req-1', 'agent', NOW + 1);
    if (!cancelled.ok) throw new Error('fixture');
    expect(submit(cancelled.store, numbered(1), NOW + 2).kind).toBe('duplicate');
  });

  it('refuses a known id with a materially different payload', () => {
    const store = storeWith(numbered(1));
    for (const changed of [
      numbered(1, { value: '0', nonce: '1', expiresAt: NOW + 3_601 }),
      validated(rawRequest({ requestId: 'req-1', purpose: 'something else' }, { nonce: '1' })),
      validated(rawRequest({ requestId: 'req-1', owner: SPENDER }, { nonce: '1' })),
    ]) {
      expect(submit(store, changed, NOW)).toMatchObject({
        kind: 'rejected',
        code: 'ID_REUSED_WITH_DIFFERENT_PAYLOAD',
      });
    }
  });

  it('refuses a second active request on the same account nonce', () => {
    const store = storeWith(numbered(1));
    const clash = validated(
      rawRequest({ requestId: 'req-other' }, { nonce: '1', expiresAt: NOW + 7_000 }),
    );
    expect(submit(store, clash, NOW)).toMatchObject({
      kind: 'rejected',
      code: 'NONCE_CONFLICT',
      conflictsWith: 'req-1',
    });
  });

  it('reports an identical operation under a new id as a duplicate operation', () => {
    const store = storeWith(numbered(1));
    const copy = validated(rawRequest({ requestId: 'req-copy' }, { nonce: '1' }));
    expect(submit(store, copy, NOW)).toMatchObject({
      kind: 'rejected',
      code: 'DUPLICATE_OPERATION',
    });
  });

  it('treats nonces on different accounts or chains as independent', () => {
    const store = storeWith(numbered(1));
    const otherAccount = validated(
      rawRequest({ requestId: 'a' }, { nonce: '1', account: SPENDER }),
    );
    const otherChain = validated(rawRequest({ requestId: 'b' }, { nonce: '1', chainId: 31337 }));
    expect(submit(store, otherAccount, NOW).kind).toBe('created');
    expect(submit(store, otherChain, NOW).kind).toBe('created');
  });

  it('allows reusing a nonce after the earlier request was rejected, cancelled or expired', () => {
    let store = storeWith(numbered(1));
    const rejected = decide(store, 'req-1', 'rejected', { reviewedFingerprint: '', now: NOW + 1 });
    if (!rejected.ok) throw new Error(rejected.message);
    store = rejected.store;
    const again = validated(rawRequest({ requestId: 'req-again' }, { nonce: '1' }));
    expect(submit(store, again, NOW + 2).kind).toBe('created');
  });

  it('ignores an earlier request that has passed its expiry', () => {
    const store = storeWith(numbered(1));
    const later = NOW + 4_000;
    const again = validated(
      rawRequest(
        { requestId: 'req-late', createdAt: later - 5 },
        { nonce: '1', expiresAt: later + 3_600 },
      ),
      { nowSeconds: later, supportedChainIds: [11155111, 31337] },
    );
    expect(submit(store, again, later).kind).toBe('created');
  });

  it('caps the store size', () => {
    const store: Record<string, ReturnType<typeof recordOf>> = {};
    const base = recordOf(storeWith(numbered(1)), 'req-1');
    for (let i = 0; i < MAX_RECORDS; i += 1) store[`filler-${i}`] = base;
    expect(submit(store, numbered(2), NOW)).toMatchObject({ kind: 'rejected', code: 'STORE_FULL' });
  });
});

describe('submit with supersedes', () => {
  it('replaces an active request, retiring the old one atomically', () => {
    const store = storeWith(numbered(1));
    const replacement = validated(
      rawRequest({ requestId: 'req-1b', reason: 'corrected amount' }, { nonce: '1' }),
    );
    const result = submit(store, replacement, NOW + 5, { supersedes: 'req-1' });
    expect(result.kind).toBe('created');
    if (result.kind === 'created') {
      const old = recordOf(result.store, 'req-1');
      expect(old.status).toBe('superseded');
      expect(old.supersededBy).toBe('req-1b');
      expect(recordOf(result.store, 'req-1b').status).toBe('pending');
    }
  });

  it('supersedes an approved request, so the old approval cannot be used', () => {
    let store = storeWith(numbered(1));
    const approved = decide(store, 'req-1', 'approved', {
      reviewedFingerprint: recordOf(store, 'req-1').fingerprint,
      now: NOW + 1,
    });
    if (!approved.ok) throw new Error(approved.message);
    store = approved.store;
    const replacement = validated(
      rawRequest({ requestId: 'req-1b', purpose: 'changed' }, { nonce: '1' }),
    );
    const result = submit(store, replacement, NOW + 5, { supersedes: 'req-1' });
    expect(result.kind).toBe('created');
    if (result.kind === 'created')
      expect(recordOf(result.store, 'req-1').status).toBe('superseded');
  });

  it('refuses a missing, finished, self or mismatched target', () => {
    const store = storeWith(numbered(1));
    const next = validated(rawRequest({ requestId: 'n' }, { nonce: '2' }));
    expect(submit(store, next, NOW, { supersedes: 'missing' })).toMatchObject({
      code: 'SUPERSEDE_TARGET_INVALID',
    });
    expect(
      submit(store, validated(rawRequest({ requestId: 'req-1' }, { nonce: '1' })), NOW, {
        supersedes: 'req-1',
      }),
    ).toMatchObject({
      kind: 'duplicate',
    });
    const otherOwner = validated(rawRequest({ requestId: 'o', owner: SPENDER }, { nonce: '3' }));
    expect(submit(store, otherOwner, NOW, { supersedes: 'req-1' })).toMatchObject({
      code: 'SUPERSEDE_TARGET_INVALID',
    });
    const otherAccount = validated(
      rawRequest({ requestId: 'p' }, { nonce: '4', account: SPENDER }),
    );
    expect(submit(store, otherAccount, NOW, { supersedes: 'req-1' })).toMatchObject({
      code: 'SUPERSEDE_TARGET_INVALID',
    });
    const cancelled = cancel(store, 'req-1', 'agent', NOW + 1);
    if (!cancelled.ok) throw new Error('fixture');
    expect(submit(cancelled.store, next, NOW + 2, { supersedes: 'req-1' })).toMatchObject({
      code: 'SUPERSEDE_TARGET_INVALID',
    });
  });

  it('still refuses a nonce clash with a request other than the one superseded', () => {
    const store = storeWith(numbered(1), numbered(2));
    const clash = validated(rawRequest({ requestId: 'c' }, { nonce: '2', expiresAt: NOW + 7_000 }));
    expect(submit(store, clash, NOW, { supersedes: 'req-1' })).toMatchObject({
      code: 'NONCE_CONFLICT',
      conflictsWith: 'req-2',
    });
  });
});

describe('decide', () => {
  it('records an approval for the reviewed payload', () => {
    const store = storeWith(numbered(1));
    const fp = recordOf(store, 'req-1').fingerprint;
    const r = decide(store, 'req-1', 'approved', { reviewedFingerprint: fp, now: NOW + 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.status).toBe('approved');
      expect(r.record.approvedFingerprint).toBe(fp);
    }
  });

  it('refuses an approval of a payload that was not the one reviewed', () => {
    const store = storeWith(numbered(1));
    const r = decide(store, 'req-1', 'approved', { reviewedFingerprint: 'stale', now: NOW + 5 });
    expect(r).toMatchObject({ ok: false, code: 'STALE_REVIEW' });
    expect(recordOf(store, 'req-1').status).toBe('pending');
  });

  it('refuses unknown requests and double decisions', () => {
    const store = storeWith(numbered(1));
    expect(decide(store, 'nope', 'rejected', { reviewedFingerprint: '', now: NOW })).toMatchObject({
      code: 'NOT_FOUND',
    });
    const first = decide(store, 'req-1', 'rejected', { reviewedFingerprint: '', now: NOW + 1 });
    if (!first.ok) throw new Error('fixture');
    expect(
      decide(first.store, 'req-1', 'approved', {
        reviewedFingerprint: recordOf(first.store, 'req-1').fingerprint,
        now: NOW + 2,
      }),
    ).toMatchObject({
      ok: false,
      code: 'NOT_ALLOWED',
    });
  });

  it('expires an overdue request and returns the updated store with the failure', () => {
    const store = storeWith(numbered(1));
    const rec = recordOf(store, 'req-1');
    const late = rec.request.operation.expiresAt + 1;
    const r = decide(store, 'req-1', 'approved', {
      reviewedFingerprint: rec.fingerprint,
      now: late,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NOT_ALLOWED');
      expect(recordOf(r.store, 'req-1').status).toBe('expired');
    }
  });
});

describe('cancel and expireDue', () => {
  it('lets the agent cancel pending but not approved, and the owner cancel both', () => {
    const store = storeWith(numbered(1), numbered(2));
    const fp = recordOf(store, 'req-2').fingerprint;
    const approved = decide(store, 'req-2', 'approved', { reviewedFingerprint: fp, now: NOW + 1 });
    if (!approved.ok) throw new Error('fixture');
    expect(cancel(approved.store, 'req-1', 'agent', NOW + 2).ok).toBe(true);
    expect(cancel(approved.store, 'req-2', 'agent', NOW + 2)).toMatchObject({
      ok: false,
      code: 'ACTOR_NOT_PERMITTED',
    });
    expect(cancel(approved.store, 'req-2', 'owner', NOW + 2).ok).toBe(true);
  });

  it('expireDue expires only overdue active requests and returns the same store when nothing changed', () => {
    const store = storeWith(numbered(1));
    expect(expireDue(store, NOW + 10)).toBe(store);
    const after = expireDue(store, NOW + 3_600);
    expect(recordOf(after, 'req-1').status).toBe('expired');
  });
});

describe('purity', () => {
  it('never mutates the store it is given', () => {
    const store: RequestStore = deepFreeze(storeWith(numbered(1), numbered(2)));
    const fp = recordOf(store, 'req-1').fingerprint;
    expect(() => {
      submit(store, numbered(3), NOW);
      submit(store, validated(rawRequest({ requestId: 'z' }, { nonce: '9' })), NOW, {
        supersedes: 'req-1',
      });
      decide(store, 'req-1', 'approved', { reviewedFingerprint: fp, now: NOW + 1 });
      cancel(store, 'req-2', 'owner', NOW + 1);
      expireDue(store, NOW + 9_999);
    }).not.toThrow();
    expect(ACCOUNT).toBeDefined();
  });
});
