import { describe, expect, it } from 'vitest';
import type { PolicyInput } from './validation';
import { MAX_LIMIT_ETH, parseAmountWei, parseLimit, validatePolicy } from './validation';

const A = '0x00000000000000000000000000000000000000a1';
const B = '0x00000000000000000000000000000000000000b2';

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    perTxLimit: '0.1',
    dailyLimit: '1',
    recipients: A,
    tokens: '',
    contracts: '',
    selectors: '',
    ...overrides,
  };
}

describe('parseLimit', () => {
  it('parses exact wei without floating point', () => {
    const result = parseLimit('0.000000000000000001');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.wei).toBe(1n);
    const big = parseLimit('123456.123456789012345678');
    if (big.ok) expect(big.wei).toBe(123456123456789012345678n);
  });

  it('rejects empty, zero, negative, exponent, too many decimals and over the cap', () => {
    for (const text of ['', '0', '0.0', '-1', '1e3', '1.0000000000000000001', 'abc', '1,5']) {
      expect(parseLimit(text).ok).toBe(false);
    }
    expect(parseLimit(String(MAX_LIMIT_ETH + 1)).ok).toBe(false);
    expect(parseLimit(String(MAX_LIMIT_ETH)).ok).toBe(true);
  });
});

describe('parseAmountWei', () => {
  it('treats empty as zero and rejects malformed values', () => {
    expect(parseAmountWei('')).toBe(0n);
    expect(parseAmountWei('1.5')).toBe(1500000000000000000n);
    expect(parseAmountWei('x')).toBe(undefined);
    expect(parseAmountWei('-1')).toBe(undefined);
  });
});

describe('validatePolicy', () => {
  it('accepts a valid policy and stores wei strings', () => {
    const result = validatePolicy(input());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.perTxLimitWei).toBe('100000000000000000');
      expect(result.value.dailyLimitWei).toBe('1000000000000000000');
      expect(result.value.recipients).toEqual(['0x00000000000000000000000000000000000000A1']);
      expect(result.value.tokens).toEqual([]);
    }
  });

  it('requires the daily limit to be at least the per-transaction limit', () => {
    expect(validatePolicy(input({ perTxLimit: '2', dailyLimit: '1' })).ok).toBe(false);
    expect(validatePolicy(input({ perTxLimit: '1', dailyLimit: '1' })).ok).toBe(true);
  });

  it('splits lists on commas, spaces and lines, and removes duplicates', () => {
    // The checksummed form of A differs only in letter case and must count as a duplicate.
    const checksummed = A.toUpperCase().replace('0X', '0x');
    const ok = validatePolicy(input({ recipients: `${A}, ${B}\n${checksummed}` }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.recipients.length).toBe(2);
  });

  it('rejects invalid addresses and the zero address', () => {
    expect(validatePolicy(input({ recipients: '0x123' })).ok).toBe(false);
    expect(validatePolicy(input({ contracts: `0x${'0'.repeat(40)}` })).ok).toBe(false);
  });

  it('validates selectors and lower-cases them', () => {
    const ok = validatePolicy(input({ selectors: '0xA9059CBB 0xa9059cbb' }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.selectors).toEqual(['0xa9059cbb']);
    expect(validatePolicy(input({ selectors: '0x1234' })).ok).toBe(false);
    expect(validatePolicy(input({ selectors: 'transfer(address,uint256)' })).ok).toBe(false);
  });

  it('limits the number of entries per list', () => {
    const many = Array.from(
      { length: 51 },
      (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`,
    );
    expect(validatePolicy(input({ recipients: many.join('\n') })).ok).toBe(false);
  });

  it('reports every field error at once', () => {
    const result = validatePolicy(
      input({ perTxLimit: '', dailyLimit: 'x', recipients: 'bad', selectors: 'bad' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        'dailyLimit',
        'perTxLimit',
        'recipients',
        'selectors',
      ]);
    }
  });
});
