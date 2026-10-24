import { isSupportedChainId } from './chains';

/**
 * Pure derivation of the wallet state shown in the UI. It takes only facts reported by
 * the wallet connection layer and never invents an address, chain or balance.
 */

export type ConnectionStatus = 'connecting' | 'reconnecting' | 'connected' | 'disconnected';

export interface WalletFacts {
  /** Whether an injected provider (window.ethereum) is present. */
  hasProvider: boolean;
  status: ConnectionStatus;
  address?: string | undefined;
  chainId?: number | undefined;
  /** Chain the application prefers (Sepolia by default). */
  defaultChainId: number;
}

export type WalletState =
  | { kind: 'no-provider' }
  | { kind: 'disconnected' }
  | { kind: 'connecting' }
  | { kind: 'connected-supported'; address: string; chainId: number; isDefaultChain: boolean }
  | { kind: 'connected-unsupported'; address: string; chainId: number | undefined };

export function deriveWalletState(facts: WalletFacts): WalletState {
  if (facts.status === 'connecting' || facts.status === 'reconnecting') {
    return { kind: 'connecting' };
  }

  if (facts.status === 'connected' && facts.address) {
    if (isSupportedChainId(facts.chainId) && facts.chainId !== undefined) {
      return {
        kind: 'connected-supported',
        address: facts.address,
        chainId: facts.chainId,
        isDefaultChain: facts.chainId === facts.defaultChainId,
      };
    }
    return { kind: 'connected-unsupported', address: facts.address, chainId: facts.chainId };
  }

  return facts.hasProvider ? { kind: 'disconnected' } : { kind: 'no-provider' };
}

/** 0x1234...abcd form for compact display. Returns the input unchanged if it is short. */
export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface EthereumLike {
  isMetaMask?: boolean;
}

/** True when an injected EIP-1193 provider exists on the given window-like object. */
export function detectInjectedProvider(target: { ethereum?: unknown } | undefined): boolean {
  return target?.ethereum !== undefined && target.ethereum !== null;
}

/** True when the injected provider identifies itself as MetaMask (informational only). */
export function isMetaMaskProvider(target: { ethereum?: unknown } | undefined): boolean {
  const provider = target?.ethereum as EthereumLike | undefined;
  return provider?.isMetaMask === true;
}

/** Browser check used by the app (tests inject their own detector). */
export function hasInjectedProvider(): boolean {
  return (
    typeof window !== 'undefined' &&
    detectInjectedProvider(window as unknown as { ethereum?: unknown })
  );
}
