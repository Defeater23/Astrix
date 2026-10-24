import { isAddress } from 'viem';
import type { AgentRecord } from './types';

/**
 * Browser-local persistence for the Module 4 agent registry. Records are scoped by chain ID and
 * owner address. This is a convenience store, not a security boundary: anyone with access to
 * the browser profile can edit it, which is why nothing here is treated as enforcement.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LoadResult {
  agents: AgentRecord[];
  /** Records that failed validation and were ignored. */
  dropped: number;
  /** True when stored data existed but could not be parsed at all. */
  corrupt: boolean;
}

const STORAGE_VERSION = 1;

export function agentStorageKey(chainId: number, owner: string): string {
  return `sentinel-wallet:agents:v${STORAGE_VERSION}:${chainId}:${owner.toLowerCase()}`;
}

export function isAgentRecord(value: unknown): value is AgentRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const isSeconds = (candidate: unknown) =>
    typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.name === 'string' &&
    typeof record.description === 'string' &&
    typeof record.signer === 'string' &&
    isAddress(record.signer) &&
    (record.expiresAt === null || isSeconds(record.expiresAt)) &&
    (record.status === 'active' || record.status === 'paused' || record.status === 'revoked') &&
    isSeconds(record.createdAt) &&
    isSeconds(record.updatedAt)
  );
}

export function loadAgents(storage: StorageLike | undefined, key: string): LoadResult {
  const empty: LoadResult = { agents: [], dropped: 0, corrupt: false };
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
      !Array.isArray((parsed as { agents?: unknown }).agents)
    ) {
      return { ...empty, corrupt: true };
    }
    const items = (parsed as { agents: unknown[] }).agents;
    const agents = items.filter(isAgentRecord);
    return { agents, dropped: items.length - agents.length, corrupt: false };
  } catch {
    return { ...empty, corrupt: true };
  }
}

/** Returns false when the data could not be written (no storage, quota, privacy mode). */
export function saveAgents(
  storage: StorageLike | undefined,
  key: string,
  agents: readonly AgentRecord[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, agents }));
    return true;
  } catch {
    return false;
  }
}

export function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
