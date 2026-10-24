import { foundry, sepolia } from 'viem/chains';
import type { Chain } from 'viem';

/**
 * Chains the application supports. Ethereum Sepolia is the public test network;
 * Foundry/Anvil (chain ID 31337) is the local chain for repeatable tests.
 * Mainnet is intentionally absent.
 */
export const SUPPORTED_CHAINS = [sepolia, foundry] as const;

export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

export const SUPPORTED_CHAIN_IDS: readonly number[] = SUPPORTED_CHAINS.map((chain) => chain.id);

export function isSupportedChainId(chainId: number | undefined): boolean {
  return chainId !== undefined && SUPPORTED_CHAIN_IDS.includes(chainId);
}

/** Human-readable chain name, or a neutral label for chains the app does not support. */
export function chainDisplayName(chainId: number | undefined): string {
  if (chainId === undefined) return 'Unknown network';
  const known = SUPPORTED_CHAINS.find((chain) => chain.id === chainId);
  if (known) return known.id === foundry.id ? 'Local Anvil' : known.name;
  return 'Unsupported network';
}

/** Resolves the configured default chain. Throws if it is not a supported chain. */
export function resolveDefaultChain(chainId: number): Chain {
  const chain = SUPPORTED_CHAINS.find((candidate) => candidate.id === chainId);
  if (!chain) {
    throw new Error(
      `VITE_DEFAULT_CHAIN_ID ${chainId} is not supported. Supported chain IDs: ${SUPPORTED_CHAIN_IDS.join(', ')}.`,
    );
  }
  return chain;
}
