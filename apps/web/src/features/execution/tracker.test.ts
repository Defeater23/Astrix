import { describe, expect, it } from 'vitest';
import { canSubmit, EMPTY_LEDGER, recordEvidence, registerOperation, statusOf } from './tracker';
import type { OperationRequest } from './types';

const op: OperationRequest = {
  account: '0x1111111111111111111111111111111111111111',
  agent: '0x2222222222222222222222222222222222222222',
  chainId: 31337,
  nonce: '5',
  expiresAt: 2000,
  target: '0x3333333333333333333333333333333333333333',
  value: '1000',
  data: '0x',
};

function created() {
  const r = registerOperation(EMPTY_LEDGER, op, 100);
  if (r.kind !== 'created') throw new Error('expected created');
  return r;
}

describe('registerOperation', () => {
  it('returns the existing record for an identical payload (duplicate)', () => {
    const first = created();
    const again = registerOperation(first.ledger, { ...op }, 200);
    expect(again.kind).toBe('duplicate');
    if (again.kind === 'duplicate') expect(again.record.createdAt).toBe(100);
    expect(Object.keys(first.ledger)).toHaveLength(1);
  });

  it('flags a different payload that reuses the same account, chain and nonce', () => {
    const first = created();
    const r = registerOperation(first.ledger, { ...op, value: '9999' }, 200);
    expect(r.kind).toBe('nonce_conflict');
  });

  it('allows the same nonce on a different chain or account', () => {
    const first = created();
    expect(registerOperation(first.ledger, { ...op, chainId: 1 }, 200).kind).toBe('created');
    expect(
      registerOperation(first.ledger, { ...op, account: '0x4444444444444444444444444444444444444444' }, 200).kind,
    ).toBe('created');
  });
});

describe('canSubmit and retries', () => {
  it('allows a first submission', () => {
    expect(canSubmit(created().record)).toEqual({ allowed: true });
  });

  it('allows a retry only when the failed attempt produced no UserOperation hash', () => {
    const { ledger, record } = created();
    const failed = recordEvidence(ledger, record.key, { submission: { attempted: true, error: 'timeout' } }, { countAttempt: true });
    const rec = failed.ledger[record.key];
    expect(rec?.attempts).toBe(1);
    expect(rec && canSubmit(rec)).toEqual({ allowed: true });

    const ambiguous = recordEvidence(ledger, record.key, {
      submission: { attempted: true, error: 'timeout after send', userOpHash: '0xabc' },
    });
    const rec2 = ambiguous.ledger[record.key];
    expect(rec2 && canSubmit(rec2).allowed).toBe(false);
  });

  it('blocks resubmission while pending and after a final outcome', () => {
    const { ledger, record } = created();
    const pending = recordEvidence(ledger, record.key, {
      submission: { attempted: true, bundlerAccepted: true, userOpHash: '0xabc' },
    });
    const p = pending.ledger[record.key];
    expect(p && canSubmit(p).allowed).toBe(false);

    const done = recordEvidence(pending.ledger, record.key, {
      inclusion: { transactionHash: '0x1', blockNumber: 7, txStatus: 'success', userOpSuccess: true },
    });
    expect(done.status).toBe('confirmed');
    const d = done.ledger[record.key];
    expect(d && canSubmit(d).allowed).toBe(false);
  });

  it('blocks resubmission of rejected operations; a new nonce is required', () => {
    const { ledger, record } = created();
    const rejected = recordEvidence(ledger, record.key, {
      policyRejection: { source: 'simulation', reason: 'RecipientNotAllowed' },
    });
    const r = rejected.ledger[record.key];
    expect(r && canSubmit(r).allowed).toBe(false);
  });
});

describe('recordEvidence', () => {
  it('never overwrites a final outcome with weaker evidence', () => {
    const { ledger, record } = created();
    const done = recordEvidence(ledger, record.key, {
      submission: { attempted: true, bundlerAccepted: true, userOpHash: '0xabc' },
      inclusion: { transactionHash: '0x1', blockNumber: 7, txStatus: 'success', userOpSuccess: true },
    });
    expect(done.status).toBe('confirmed');

    const late = recordEvidence(done.ledger, record.key, { userRejectedSignature: true, inclusion: undefined });
    expect(late.applied).toBe(false);
    expect(late.status).toBe('confirmed');
    expect(statusOf(late.ledger, record.key)).toBe('confirmed');
  });

  it('does not mutate the previous ledger', () => {
    const { ledger, record } = created();
    recordEvidence(ledger, record.key, { userRejectedSignature: true });
    expect(statusOf(ledger, record.key)).toBe('not_submitted');
  });

  it('throws for an unknown operation', () => {
    expect(() => recordEvidence(EMPTY_LEDGER, 'nope', {})).toThrow(/Unknown operation/);
  });
});
