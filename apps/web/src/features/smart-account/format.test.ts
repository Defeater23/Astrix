import { describe, expect, it } from 'vitest';
import { formatNative, nativeSymbol, renderBalance } from './format';

describe('formatNative', () => {
  it('formats wei exactly without floating point', () => {
    expect(formatNative(1n, 11155111)).toBe('0.000000000000000001 ETH');
    expect(formatNative(1_500_000_000_000_000_000n, 31337)).toBe('1.5 ETH');
    expect(formatNative(0n, 11155111)).toBe('0 ETH');
  });

  it('keeps precision beyond Number.MAX_SAFE_INTEGER', () => {
    expect(formatNative(123456789012345678901234567890n, 11155111)).toBe(
      '123456789012.34567890123456789 ETH',
    );
  });
});

describe('nativeSymbol', () => {
  it('uses the chain definition and falls back for unknown chains', () => {
    expect(nativeSymbol(11155111)).toBe('ETH');
    expect(nativeSymbol(1)).toBe('native');
  });
});

describe('renderBalance', () => {
  it('shows unavailable when there is no result', () => {
    expect(renderBalance(undefined, 11155111)).toEqual({ text: 'Unavailable', unavailable: true });
  });

  it('shows the error instead of a number when a read failed', () => {
    expect(renderBalance({ ok: false, error: 'rpc down' }, 11155111)).toEqual({
      text: 'Unavailable: rpc down',
      unavailable: true,
    });
  });

  it('shows the exact value when the read succeeded', () => {
    expect(renderBalance({ ok: true, value: 2_000_000_000_000_000_000n }, 31337)).toEqual({
      text: '2 ETH',
      unavailable: false,
    });
  });
});
