import { isAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { ENTRYPOINT_V07_ABI, ENTRYPOINT_V07_ADDRESS, ENTRYPOINT_VERSION } from './entryPoint';

describe('EntryPoint v0.7 constants', () => {
  it('pins version 0.7', () => {
    expect(ENTRYPOINT_VERSION).toBe('0.7');
  });

  it('uses a valid checksummed address', () => {
    expect(isAddress(ENTRYPOINT_V07_ADDRESS)).toBe(true);
  });

  it('exposes only the read-only balanceOf function', () => {
    expect(ENTRYPOINT_V07_ABI).toHaveLength(1);
    expect(ENTRYPOINT_V07_ABI[0].name).toBe('balanceOf');
    expect(ENTRYPOINT_V07_ABI[0].stateMutability).toBe('view');
  });
});
