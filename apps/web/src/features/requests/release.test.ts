import { describe, expect, it } from 'vitest';
import { evaluateRelease } from './release';
import type { AuthorizationVerifier, ReleaseContext } from './release';
import { decide } from './registry';
import {
  ACCOUNT,
  AGENT,
  NOW,
  OWNER,
  SPENDER,
  numbered,
  rawRequest,
  recordOf,
  storeWith,
  validated,
} from './fixtures';
import type { RequestRecord, RequestStore } from './types';

function approved(n = 1): { store: RequestStore; record: RequestRecord } {
  const store = storeWith(numbered(n));
  const id = `req-${n}`;
  const r = decide(store, id, 'approved', {
    reviewedFingerprint: recordOf(store, id).fingerprint,
    now: NOW + 1,
  });
  if (!r.ok) throw new Error(r.message);
  return { store: r.store, record: r.record };
}

function ctx(overrides: Partial<ReleaseContext['execution']> = {}, owner = OWNER): ReleaseContext {
  return {
    owner,
    execution: {
      chainId: 11155111,
      account: ACCOUNT,
      nowSeconds: NOW + 60,
      expectedNonce: '1',
      agentAuthorized: true,
      ...overrides,
    },
  };
}

// Test doubles only. Module 7C will provide the real verifier; these prove the gate's wiring.
const acceptingVerifier: AuthorizationVerifier = { verify: () => ({ valid: true }) };
const rejectingVerifier: AuthorizationVerifier = {
  verify: () => ({ valid: false, reason: 'bad signature' }),
};

function codes(decision: ReturnType<typeof evaluateRelease>): string[] {
  return decision.allowed ? [] : decision.blocks.map((b) => b.code);
}

describe('evaluateRelease', () => {
  it('never releases on an approved status alone (no verifier exists in 7B)', () => {
    const { record } = approved();
    const decision = evaluateRelease(record, ctx());
    expect(decision.allowed).toBe(false);
    expect(codes(decision)).toEqual(['NO_VERIFIER']);
  });

  it('requires signature evidence even when a verifier is present', () => {
    const { record } = approved();
    expect(codes(evaluateRelease(record, ctx(), { verifier: acceptingVerifier }))).toEqual([
      'NO_EVIDENCE',
    ]);
  });

  it('releases only with approval, validity, matching payload and a verifier that accepts', () => {
    const { record } = approved();
    const decision = evaluateRelease(record, ctx(), {
      verifier: acceptingVerifier,
      evidence: { sig: '0x' },
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.operation).toEqual(record.request.operation);
  });

  it('blocks when the verifier rejects or throws', () => {
    const { record } = approved();
    expect(
      codes(evaluateRelease(record, ctx(), { verifier: rejectingVerifier, evidence: 1 })),
    ).toEqual(['AUTHORIZATION_INVALID']);
    const throwing: AuthorizationVerifier = {
      verify: () => {
        throw new Error('boom');
      },
    };
    expect(codes(evaluateRelease(record, ctx(), { verifier: throwing, evidence: 1 }))).toEqual([
      'AUTHORIZATION_INVALID',
    ]);
  });

  it('passes the exact reviewed request and its fingerprint to the verifier', () => {
    const { record } = approved();
    let seen: { fingerprint: string; nonce: string } | undefined;
    const spy: AuthorizationVerifier = {
      verify: (check) => {
        seen = { fingerprint: check.fingerprint, nonce: check.request.operation.nonce };
        return { valid: true };
      },
    };
    evaluateRelease(record, ctx(), { verifier: spy, evidence: 1 });
    expect(seen).toEqual({ fingerprint: record.fingerprint, nonce: '1' });
  });

  it('blocks a pending, rejected, cancelled or superseded request even with valid evidence', () => {
    const store = storeWith(numbered(1));
    const pendingRecord = recordOf(store, 'req-1');
    expect(
      codes(evaluateRelease(pendingRecord, ctx(), { verifier: acceptingVerifier, evidence: 1 })),
    ).toContain('NOT_APPROVED');
    for (const status of ['rejected', 'cancelled', 'superseded', 'expired'] as const) {
      const forged: RequestRecord = { ...pendingRecord, status };
      expect(
        codes(evaluateRelease(forged, ctx(), { verifier: acceptingVerifier, evidence: 1 })),
      ).toContain('NOT_APPROVED');
    }
  });

  it('blocks an approval that has expired', () => {
    const { record } = approved();
    const late = ctx({ nowSeconds: record.request.operation.expiresAt });
    expect(
      codes(evaluateRelease(record, late, { verifier: acceptingVerifier, evidence: 1 })),
    ).toContain('EXPIRED');
  });

  it('blocks a payload altered after approval', () => {
    const { record } = approved();
    const altered: RequestRecord = {
      ...record,
      request: { ...record.request, operation: { ...record.request.operation, target: SPENDER } },
    };
    expect(
      codes(evaluateRelease(altered, ctx(), { verifier: acceptingVerifier, evidence: 1 })),
    ).toContain('PAYLOAD_CHANGED');
  });

  it('blocks an approval recorded for a different payload', () => {
    const { record } = approved();
    const swapped: RequestRecord = { ...record, approvedFingerprint: 'another' };
    expect(
      codes(evaluateRelease(swapped, ctx(), { verifier: acceptingVerifier, evidence: 1 })),
    ).toContain('APPROVAL_FOR_DIFFERENT_PAYLOAD');
  });

  it('blocks a different connected owner', () => {
    const { record } = approved();
    expect(
      codes(
        evaluateRelease(record, ctx({}, SPENDER), { verifier: acceptingVerifier, evidence: 1 }),
      ),
    ).toContain('OWNER_MISMATCH');
    expect(
      codes(
        evaluateRelease(record, ctx({}, OWNER.toUpperCase().replace('0X', '0x')), {
          verifier: acceptingVerifier,
          evidence: 1,
        }),
      ),
    ).toEqual([]);
  });

  it('integrates the Module 6 validation: chain, account, nonce, agent and policy preview', () => {
    const { record } = approved();
    const bad = ctx({
      chainId: 31337,
      account: SPENDER,
      expectedNonce: '9',
      agentAuthorized: false,
      policyPreview: { allowed: false, reason: 'over limit' },
    });
    const decision = evaluateRelease(record, bad, { verifier: acceptingVerifier, evidence: 1 });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      const block = decision.blocks.find((b) => b.code === 'EXECUTION_VALIDATION_FAILED');
      const rejected = (block?.rejections ?? []).map((r) => r.code);
      for (const code of [
        'WRONG_CHAIN',
        'WRONG_ACCOUNT',
        'NONCE_MISMATCH',
        'AGENT_NOT_AUTHORIZED',
        'POLICY_PREVIEW_DENIED',
      ]) {
        expect(rejected).toContain(code);
      }
    }
  });

  it('blocks a reused nonce known to Module 6', () => {
    const { record } = approved();
    const used = ctx({ usedNonces: new Set(['1']) });
    const decision = evaluateRelease(record, used, { verifier: acceptingVerifier, evidence: 1 });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      const block = decision.blocks.find((b) => b.code === 'EXECUTION_VALIDATION_FAILED');
      expect((block?.rejections ?? []).map((r) => r.code)).toContain('NONCE_REUSED');
    }
  });

  it('reports every block at once so the owner sees the full picture', () => {
    const { record } = approved();
    const decision = evaluateRelease(
      { ...record, status: 'pending' },
      ctx({ nowSeconds: record.request.operation.expiresAt + 1 }),
    );
    for (const code of ['NOT_APPROVED', 'EXPIRED', 'NO_VERIFIER'])
      expect(codes(decision)).toContain(code);
  });

  it('a fresh request after a material change needs a fresh approval', () => {
    const first = approved();
    const changed = validated(
      rawRequest({ requestId: 'req-1b', reason: 'amount changed' }, { nonce: '1' }),
    );
    const record: RequestRecord = {
      request: changed.request,
      fingerprint: changed.fingerprint,
      status: 'pending',
      history: [{ from: null, to: 'pending', at: NOW, actor: 'agent' }],
    };
    expect(first.record.fingerprint).not.toBe(record.fingerprint);
    expect(
      codes(evaluateRelease(record, ctx(), { verifier: acceptingVerifier, evidence: 1 })),
    ).toContain('NOT_APPROVED');
    expect(AGENT).toBeDefined();
  });
});
