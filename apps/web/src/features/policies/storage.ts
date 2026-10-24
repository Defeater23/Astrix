import { isAddress } from 'viem';
import type { StorageLike } from '../agents/storage';
import type { PolicyRecord } from './types';
import { parseStoredWei } from './validation';

/**
 * Browser-local persistence of policy DRAFTS, scoped by chain ID and owner. A convenience store,
 * not an authorization source. Records claiming any state other than "draft" are rejected, so
 * edited storage cannot make the UI claim a policy was submitted or confirmed on-chain.
 */

const STORAGE_VERSION = 1;

export function policyStorageKey(chainId: number, owner: string): string {
  return `sentinel-wallet:policies:v${STORAGE_VERSION}:${chainId}:${owner.toLowerCase()}`;
}

function isAddressArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && isAddress(item));
}

export function isPolicyRecord(value: unknown): value is PolicyRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.agentId === 'string' &&
    record.agentId.length > 0 &&
    typeof record.perTxLimitWei === 'string' &&
    parseStoredWei(record.perTxLimitWei) !== undefined &&
    typeof record.dailyLimitWei === 'string' &&
    parseStoredWei(record.dailyLimitWei) !== undefined &&
    isAddressArray(record.recipients) &&
    isAddressArray(record.tokens) &&
    isAddressArray(record.contracts) &&
    Array.isArray(record.selectors) &&
    record.selectors.every((item) => typeof item === 'string' && /^0x[0-9a-f]{8}$/.test(item)) &&
    record.state === 'draft' &&
    typeof record.updatedAt === 'number' &&
    Number.isSafeInteger(record.updatedAt)
  );
}

export interface PolicyLoadResult {
  policies: PolicyRecord[];
  dropped: number;
  corrupt: boolean;
}

export function loadPolicies(storage: StorageLike | undefined, key: string): PolicyLoadResult {
  const empty: PolicyLoadResult = { policies: [], dropped: 0, corrupt: false };
  if (!storage) return empty;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ...empty, corrupt: true };
  }
  if (raw === null) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== STORAGE_VERSION ||
      !Array.isArray((parsed as { policies?: unknown }).policies)
    ) {
      return { ...empty, corrupt: true };
    }
    const items = (parsed as { policies: unknown[] }).policies;
    const policies = items.filter(isPolicyRecord);
    return { policies, dropped: items.length - policies.length, corrupt: false };
  } catch {
    return { ...empty, corrupt: true };
  }
}

export function savePolicies(
  storage: StorageLike | undefined,
  key: string,
  policies: readonly PolicyRecord[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, policies }));
    return true;
  } catch {
    return false;
  }
}
