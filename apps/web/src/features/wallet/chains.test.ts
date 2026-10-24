import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_CHAIN_IDS,
  chainDisplayName,
  isSupportedChainId,
  resolveDefaultChain,
} from './chains';

describe('supported chains', () => {
  it('supports exactly Sepolia and local Anvil, never mainnet', () => {
    expect([...SUPPORTED_CHAIN_IDS].sort()).toEqual([11155111, 31337].sort());
    expect(isSupportedChainId(1)).toBe(false);
  });

  it('treats undefined as unsupported', () => {
    expect(isSupportedChainId(undefined)).toBe(false);
  });

  it('names chains without guessing', () => {
    expect(chainDisplayName(11155111)).toBe('Sepolia');
    expect(chainDisplayName(31337)).toBe('Local Anvil');
    expect(chainDisplayName(1)).toBe('Unsupported network');
    expect(chainDisplayName(undefined)).toBe('Unknown network');
  });

  it('resolves the default chain and rejects unsupported ones', () => {
    expect(resolveDefaultChain(11155111).id).toBe(11155111);
    expect(() => resolveDefaultChain(1)).toThrow(/not supported/);
  });
});
