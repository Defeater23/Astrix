import { isConsistentHistory } from './lifecycle';
import { parseRequest } from './schema';
import type { ParseContext } from './schema';
import type { RequestRecord, RequestStatus, RequestStore } from './types';

/**
 * Browser-local persistence for the request store, scoped by chain ID and owner. A convenience
 * store, not a security boundary: anyone with the browser profile can edit it. Loading therefore
 * re-validates every record and drops anything inconsistent, but a self-consistent forgery cannot
 * be detected here, which is why a stored `approved` status can never authorize execution.
 */

export interface RequestStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_VERSION = 1;
const STATUSES: readonly RequestStatus[] = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'cancelled',
  'superseded',
];

export function requestStorageKey(chainId: number, owner: string): string {
  return `sentinel-wallet:requests:v${STORAGE_VERSION}:${chainId}:${owner.toLowerCase()}`;
}

export interface LoadedRequests {
  store: RequestStore;
  /** Stored records that failed validation and were ignored. */
  dropped: number;
  /** True when stored data existed but could not be read as a request store at all. */
  corrupt: boolean;
}

export interface LoadScope {
  chainId: number;
  owner: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rebuilds a record from untrusted JSON, or returns undefined when anything is inconsistent. */
export function readRecord(
  value: unknown,
  scope: LoadScope,
  ctx: Pick<ParseContext, 'supportedChainIds'>,
): RequestRecord | undefined {
  if (!isObject(value)) return undefined;
  const { request, fingerprint, status, history, approvedFingerprint, supersededBy } = value;
  if (typeof fingerprint !== 'string' || typeof status !== 'string') return undefined;
  if (!STATUSES.includes(status as RequestStatus) || !Array.isArray(history)) return undefined;

  const parsed = parseRequest(request, {
    nowSeconds: 0,
    supportedChainIds: ctx.supportedChainIds,
    checkTime: false,
  });
  if (!parsed.ok) return undefined;
  // The stored fingerprint must equal the one recomputed from the stored payload.
  if (parsed.value.fingerprint !== fingerprint) return undefined;
  if (
    parsed.value.request.owner !== scope.owner.toLowerCase() ||
    parsed.value.request.operation.chainId !== scope.chainId
  ) {
    return undefined;
  }

  const record: RequestRecord = {
    request: parsed.value.request,
    fingerprint,
    status: status as RequestStatus,
    history: history as RequestRecord['history'],
    ...(typeof approvedFingerprint === 'string' ? { approvedFingerprint } : {}),
    ...(typeof supersededBy === 'string' ? { supersededBy } : {}),
  };
  if (!isConsistentHistory(record)) return undefined;
  if (record.status === 'approved' && record.approvedFingerprint !== record.fingerprint) {
    return undefined;
  }
  if (record.status === 'superseded' && !record.supersededBy) return undefined;
  if (record.status !== 'superseded' && record.supersededBy !== undefined) return undefined;
  return record;
}

export function loadRequests(
  storage: RequestStorageLike | undefined,
  scope: LoadScope,
  ctx: Pick<ParseContext, 'supportedChainIds'>,
): LoadedRequests {
  const empty: LoadedRequests = { store: {}, dropped: 0, corrupt: false };
  if (!storage) return empty;
  let raw: string | null;
  try {
    raw = storage.getItem(requestStorageKey(scope.chainId, scope.owner));
  } catch {
    return { ...empty, corrupt: true };
  }
  if (raw === null) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.records)) {
      return { ...empty, corrupt: true };
    }
    const store: Record<string, RequestRecord> = {};
    for (const item of parsed.records as unknown[]) {
      const record = readRecord(item, scope, ctx);
      // One record per request ID: a duplicate is treated as tampering and dropped.
      if (record && !(record.request.requestId in store)) {
        store[record.request.requestId] = record;
      }
    }
    return {
      store,
      dropped: (parsed.records as unknown[]).length - Object.keys(store).length,
      corrupt: false,
    };
  } catch {
    return { ...empty, corrupt: true };
  }
}

/** Returns false when the data could not be written. */
export function saveRequests(
  storage: RequestStorageLike | undefined,
  scope: LoadScope,
  store: RequestStore,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      requestStorageKey(scope.chainId, scope.owner),
      JSON.stringify({ version: STORAGE_VERSION, records: Object.values(store) }),
    );
    return true;
  } catch {
    return false;
  }
}
