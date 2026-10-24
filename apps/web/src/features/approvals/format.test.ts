import { describe, expect, it } from 'vitest';
import { describeExpiry, formatUnitsExact, formatUtc } from './format';

describe('formatUnitsExact', () => {
  it('formats exactly with trailing zeros removed', () => {
    expect(formatUnitsExact(1_500_000n, 6)).toBe('1.5');
    expect(formatUnitsExact(25_000_000n, 6)).toBe('25');
    expect(formatUnitsExact(1n, 6)).toBe('0.000001');
    expect(formatUnitsExact(0n, 6)).toBe('0');
    expect(formatUnitsExact(50_000_000_000_000_000n, 18)).toBe('0.05');
  });

  it('is exact beyond double precision', () => {
    expect(formatUnitsExact(9_007_199_254_740_993n, 0)).toBe('9007199254740993');
    expect(formatUnitsExact(123_456_789_012_345_678_901n, 18)).toBe('123.456789012345678901');
  });

  it('handles zero decimals and rejects invalid decimals', () => {
    expect(formatUnitsExact(42n, 0)).toBe('42');
    expect(() => formatUnitsExact(1n, -1)).toThrow(RangeError);
    expect(() => formatUnitsExact(1n, 1.5)).toThrow(RangeError);
  });
});

describe('time formatting', () => {
  it('formats UTC timestamps', () => {
    expect(formatUtc(0)).toBe('1970-01-01 00:00:00 UTC');
    expect(formatUtc(1_800_000_000)).toBe('2027-01-15 08:00:00 UTC');
  });

  it('describes future and past expiry', () => {
    const now = 1_800_000_000;
    expect(describeExpiry(now + 3_540, now)).toEqual({
      expired: false,
      text: '2027-01-15 08:59:00 UTC (in 59 min)',
    });
    const past = describeExpiry(now - 600, now);
    expect(past.expired).toBe(true);
    expect(past.text).toContain('expired 10 min ago');
  });

  it('treats expiry equal to now as expired', () => {
    expect(describeExpiry(100, 100).expired).toBe(true);
  });
});
