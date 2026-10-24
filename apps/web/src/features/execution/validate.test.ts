import { describe, expect, it } from 'vitest';
import type { OperationRequest } from './types';
import { operationKey, validateOperation, type ValidationContext } from './validate';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const AGENT = '0x2222222222222222222222222222222222222222';
const TARGET = '0x3333333333333333333333333333333333333333';

const op: OperationRequest = {
  account: ACCOUNT,
  agent: AGENT,
  chainId: 31337,
  nonce: '5',
  expiresAt: 2000,
  target: TARGET,
  value: '1000',
  data: '0x',
};

const ctx: ValidationContext = {
  chainId: 31337,
  account: ACCOUNT,
  nowSeconds: 1000,
  expectedNonce: '5',
  agentAuthorized: true,
};

function codes(o: OperationRequest, c: ValidationContext): string[] {
  const r = validateOperation(o, c);
  return r.ok ? [] : r.rejections.map((x) => x.code);
}

describe('validateOperation', () => {
  it('accepts a well-formed, current operation', () => {
    expect(validateOperation(op, ctx)).toEqual({ ok: true });
  });

  it('rejects the wrong chain', () => {
    expect(codes({ ...op, chainId: 11155111 }, ctx)).toContain('WRONG_CHAIN');
  });

  it('rejects another smart account, case-insensitively matching the right one', () => {
    expect(codes({ ...op, account: TARGET }, ctx)).toContain('WRONG_ACCOUNT');
    expect(codes({ ...op, account: ACCOUNT.toUpperCase().replace('0X', '0x') }, ctx)).toHaveLength(0);
  });

  it('rejects expired operations, including exactly at the expiry second', () => {
    expect(codes({ ...op, expiresAt: 1000 }, ctx)).toContain('EXPIRED');
    expect(codes({ ...op, expiresAt: 999 }, ctx)).toContain('EXPIRED');
    expect(codes({ ...op, expiresAt: 1001 }, ctx)).toHaveLength(0);
  });

  it('rejects a wrong nonce and a reused nonce', () => {
    expect(codes({ ...op, nonce: '6' }, ctx)).toContain('NONCE_MISMATCH');
    expect(codes(op, { ...ctx, usedNonces: new Set(['5']) })).toContain('NONCE_REUSED');
  });

  it('rejects malformed numbers, addresses and calldata', () => {
    expect(codes({ ...op, nonce: '-1' }, ctx)).toContain('INVALID_NONCE');
    expect(codes({ ...op, nonce: '1.5' }, ctx)).toContain('INVALID_NONCE');
    expect(codes({ ...op, value: '1e18' }, ctx)).toContain('INVALID_AMOUNT');
    expect(codes({ ...op, value: '-5' }, ctx)).toContain('INVALID_AMOUNT');
    expect(codes({ ...op, target: '0x123' }, ctx)).toContain('INVALID_ADDRESS');
    expect(codes({ ...op, data: '0xabc' }, ctx)).toContain('INVALID_DATA');
    expect(codes({ ...op, data: 'abcd' }, ctx)).toContain('INVALID_DATA');
  });

  it('rejects values above uint256', () => {
    expect(codes({ ...op, value: (2n ** 256n).toString() }, ctx)).toContain('INVALID_AMOUNT');
  });

  it('rejects an agent that is not authorized', () => {
    expect(codes(op, { ...ctx, agentAuthorized: false })).toContain('AGENT_NOT_AUTHORIZED');
  });

  it('reports a denied advisory policy preview as a client-side rejection only', () => {
    expect(codes(op, { ...ctx, policyPreview: { allowed: false, reason: 'over limit' } })).toContain(
      'POLICY_PREVIEW_DENIED',
    );
  });

  it('reports every problem, not just the first', () => {
    const bad = { ...op, chainId: 1, nonce: '9', expiresAt: 1 };
    expect(codes(bad, ctx)).toEqual(['WRONG_CHAIN', 'EXPIRED', 'NONCE_MISMATCH']);
  });
});

describe('operationKey', () => {
  it('is stable across address case and numeric formatting', () => {
    const a = operationKey(op);
    const b = operationKey({ ...op, account: ACCOUNT.toUpperCase().replace('0X', '0x'), value: '01000'.slice(1) });
    expect(a).toBe(b);
  });

  it('changes when any material field changes', () => {
    const base = operationKey(op);
    expect(operationKey({ ...op, value: '1001' })).not.toBe(base);
    expect(operationKey({ ...op, target: AGENT })).not.toBe(base);
    expect(operationKey({ ...op, data: '0x00' })).not.toBe(base);
    expect(operationKey({ ...op, nonce: '6' })).not.toBe(base);
    expect(operationKey({ ...op, chainId: 1 })).not.toBe(base);
    expect(operationKey({ ...op, expiresAt: 2001 })).not.toBe(base);
  });
});
