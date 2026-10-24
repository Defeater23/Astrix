import { describe, expect, it } from 'vitest';
import {
  deriveWalletState,
  detectInjectedProvider,
  isMetaMaskProvider,
  shortAddress,
} from './state';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const base = { hasProvider: true, defaultChainId: 11155111 } as const;

describe('deriveWalletState', () => {
  it('reports no provider when disconnected and nothing is injected', () => {
    expect(deriveWalletState({ ...base, hasProvider: false, status: 'disconnected' })).toEqual({
      kind: 'no-provider',
    });
  });

  it('reports disconnected when a provider exists but no account is connected', () => {
    expect(deriveWalletState({ ...base, status: 'disconnected' })).toEqual({
      kind: 'disconnected',
    });
  });

  it('reports connecting while connecting or reconnecting', () => {
    expect(deriveWalletState({ ...base, status: 'connecting' }).kind).toBe('connecting');
    expect(deriveWalletState({ ...base, status: 'reconnecting' }).kind).toBe('connecting');
  });

  it('reports a supported default chain', () => {
    expect(
      deriveWalletState({ ...base, status: 'connected', address: ADDRESS, chainId: 11155111 }),
    ).toEqual({
      kind: 'connected-supported',
      address: ADDRESS,
      chainId: 11155111,
      isDefaultChain: true,
    });
  });

  it('reports a supported non-default chain (local Anvil)', () => {
    const state = deriveWalletState({
      ...base,
      status: 'connected',
      address: ADDRESS,
      chainId: 31337,
    });
    expect(state).toMatchObject({ kind: 'connected-supported', isDefaultChain: false });
  });

  it('reports an unsupported network such as mainnet', () => {
    expect(
      deriveWalletState({ ...base, status: 'connected', address: ADDRESS, chainId: 1 }),
    ).toEqual({ kind: 'connected-unsupported', address: ADDRESS, chainId: 1 });
  });

  it('treats an unknown chain ID as unsupported', () => {
    expect(
      deriveWalletState({ ...base, status: 'connected', address: ADDRESS, chainId: undefined }),
    ).toMatchObject({ kind: 'connected-unsupported' });
  });

  it('never reports connected without an address', () => {
    expect(
      deriveWalletState({ ...base, status: 'connected', address: undefined, chainId: 11155111 }),
    ).toEqual({ kind: 'disconnected' });
  });
});

describe('helpers', () => {
  it('shortens long addresses and leaves short ones alone', () => {
    expect(shortAddress(ADDRESS)).toBe('0x1234…5678');
    expect(shortAddress('0x1234')).toBe('0x1234');
  });

  it('detects an injected provider', () => {
    expect(detectInjectedProvider({ ethereum: {} })).toBe(true);
    expect(detectInjectedProvider({})).toBe(false);
    expect(detectInjectedProvider({ ethereum: null })).toBe(false);
    expect(detectInjectedProvider(undefined)).toBe(false);
  });

  it('identifies MetaMask only when the provider says so', () => {
    expect(isMetaMaskProvider({ ethereum: { isMetaMask: true } })).toBe(true);
    expect(isMetaMaskProvider({ ethereum: { isMetaMask: false } })).toBe(false);
    expect(isMetaMaskProvider({})).toBe(false);
  });
});
