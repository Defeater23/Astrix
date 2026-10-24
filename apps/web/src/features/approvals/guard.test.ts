import { describe, expect, it } from 'vitest';
import { buildDemoRequests } from './demoData';
import { isDisplayableRequest } from './guard';

const NOW = 1_800_000_000;

function good() {
  const first = buildDemoRequests({ owner: '0x1', chainId: 11155111 }, NOW)[0];
  if (!first) throw new Error('fixture missing');
  return structuredClone(first) as unknown as Record<string, unknown> & {
    operation: Record<string, unknown>;
  };
}

describe('isDisplayableRequest', () => {
  it('accepts every demo fixture', () => {
    for (const request of buildDemoRequests({ owner: '0x1', chainId: 31337 }, NOW)) {
      expect(isDisplayableRequest(request)).toBe(true);
    }
  });

  it.each([
    ['not an object', null],
    ['empty id', { ...good(), id: '' }],
    ['bad account', (() => { const r = good(); r.operation.account = '0x12'; return r; })()],
    ['bad target', (() => { const r = good(); r.operation.target = 'nope'; return r; })()],
    ['float value', (() => { const r = good(); r.operation.value = '1.5'; return r; })()],
    ['negative value', (() => { const r = good(); r.operation.value = '-1'; return r; })()],
    ['leading-zero nonce', (() => { const r = good(); r.operation.nonce = '007'; return r; })()],
    ['odd-length calldata', (() => { const r = good(); r.operation.data = '0xabc'; return r; })()],
    ['non-hex calldata', (() => { const r = good(); r.operation.data = '0xzz'; return r; })()],
    ['value over uint256', (() => { const r = good(); r.operation.value = (2n ** 256n).toString(); return r; })()],
    ['numeric string expiry', (() => { const r = good(); r.operation.expiresAt = '123'; return r; })()],
    ['chain zero', (() => { const r = good(); r.operation.chainId = 0; return r; })()],
    ['bad decimals', { ...good(), tokenMeta: { symbol: 'X', decimals: 99 } }],
    ['empty symbol', { ...good(), tokenMeta: { symbol: '', decimals: 6 } }],
  ])('rejects %s', (_name, value) => {
    expect(isDisplayableRequest(value)).toBe(false);
  });
});
