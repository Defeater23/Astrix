import type { Address } from 'viem';
import { getAddress, isAddress, zeroAddress } from 'viem';

/**
 * Smart-account address per supported chain, supplied through environment variables.
 *
 * In this module the address is configuration, not something derived from an account factory:
 * deriving a counterfactual address requires the pinned account implementation's factory ABI,
 * which is integrated later. Addresses are public data, so VITE_ variables are appropriate;
 * private keys and seed phrases must never be placed here.
 */

export const SMART_ACCOUNT_ENV_KEYS: Record<number, string> = {
  11155111: 'VITE_SMART_ACCOUNT_ADDRESS_SEPOLIA',
  31337: 'VITE_SMART_ACCOUNT_ADDRESS_ANVIL',
};

export interface SmartAccountConfig {
  addresses: Record<number, Address | undefined>;
}

/** Parses and validates addresses. Throws a descriptive Error on invalid input. */
export function parseSmartAccountConfig(raw: Record<string, unknown>): SmartAccountConfig {
  const addresses: Record<number, Address | undefined> = {};
  for (const [chainId, key] of Object.entries(SMART_ACCOUNT_ENV_KEYS)) {
    const value = raw[key];
    if (value === undefined || value === '') {
      addresses[Number(chainId)] = undefined;
      continue;
    }
    if (typeof value !== 'string') throw new Error(`${key} must be a string.`);
    const trimmed = value.trim();
    if (!isAddress(trimmed)) {
      throw new Error(`${key} must be a valid EVM address (checksum casing is enforced).`);
    }
    const normalized = getAddress(trimmed);
    if (normalized === zeroAddress) throw new Error(`${key} must not be the zero address.`);
    addresses[Number(chainId)] = normalized;
  }
  return { addresses };
}

export const smartAccountConfig: SmartAccountConfig = parseSmartAccountConfig(
  import.meta.env as Record<string, unknown>,
);
