/**
 * Typed, validated environment configuration.
 *
 * Only VITE_-prefixed variables are exposed to the browser by Vite, so secrets
 * (private keys, seed phrases, API keys) must never be placed here.
 */

export interface AppEnv {
  appName: string;
  defaultChainId: number;
  explorerUrl: string;
  apiBaseUrl: string;
}

export const DEFAULTS = {
  appName: 'Sentinel Wallet',
  defaultChainId: 11155111, // Ethereum Sepolia
  explorerUrl: 'https://sepolia.etherscan.io',
  apiBaseUrl: 'http://localhost:4000',
} as const;

function readString(raw: Record<string, unknown>, key: string, fallback: string): string {
  const value = raw[key];
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string') throw new Error(`${key} must be a string.`);
  return value.trim();
}

function readUrl(raw: Record<string, unknown>, key: string, fallback: string): string {
  const value = readString(raw, key, fallback);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid http(s) URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${key} must be a valid http(s) URL.`);
  }
  return value.replace(/\/+$/, '');
}

function readChainId(raw: Record<string, unknown>, key: string, fallback: number): number {
  const value = raw[key];
  if (value === undefined || value === '') return fallback;
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`${key} must be a positive integer chain ID.`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${key} must be a positive integer chain ID.`);
  }
  return parsed;
}

/** Parses and validates raw environment values. Throws a descriptive Error on invalid input. */
export function parseEnv(raw: Record<string, unknown>): AppEnv {
  return {
    appName: readString(raw, 'VITE_APP_NAME', DEFAULTS.appName),
    defaultChainId: readChainId(raw, 'VITE_DEFAULT_CHAIN_ID', DEFAULTS.defaultChainId),
    explorerUrl: readUrl(raw, 'VITE_EXPLORER_URL', DEFAULTS.explorerUrl),
    apiBaseUrl: readUrl(raw, 'VITE_API_BASE_URL', DEFAULTS.apiBaseUrl),
  };
}

export const env: AppEnv = parseEnv(import.meta.env as Record<string, unknown>);
