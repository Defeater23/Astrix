import { browserStorage } from '../agents/storage';
import type { StorageLike } from '../agents/storage';
import type {
  ApprovalRequest,
  ApprovalStatus,
  DecisionRecord,
  LocalDecision,
} from './types';

/**
 * Browser-local record of the owner's UI decisions, scoped by chain ID and owner. A decision is
 * bound to a fingerprint of the exact reviewed payload: if any field changes, the decision no
 * longer applies and the request needs a fresh review. This store authorizes nothing.
 */

const STORAGE_VERSION = 1;

export { browserStorage };

export function decisionStorageKey(chainId: number, owner: string): string {
  return `sentinel-wallet:approval-decisions:v${STORAGE_VERSION}:${chainId}:${owner.toLowerCase()}`;
}

/** Canonical string over every field the owner reviewed. Addresses and hex are lowercased. */
export function requestFingerprint(request: ApprovalRequest): string {
  const op = request.operation;
  return JSON.stringify([
    request.id,
    op.account.toLowerCase(),
    op.agent.toLowerCase(),
    op.chainId,
    op.nonce,
    op.expiresAt,
    op.target.toLowerCase(),
    op.value,
    op.data.toLowerCase(),
    request.purpose,
    request.reason,
    request.tokenMeta ? [request.tokenMeta.symbol, request.tokenMeta.decimals] : null,
  ]);
}

export function isDecisionRecord(value: unknown): value is DecisionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.requestId === 'string' &&
    r.requestId.length > 0 &&
    (r.decision === 'ui_approved' || r.decision === 'ui_rejected') &&
    typeof r.decidedAt === 'number' &&
    Number.isSafeInteger(r.decidedAt) &&
    r.decidedAt >= 0 &&
    typeof r.fingerprint === 'string' &&
    r.fingerprint.length > 0
  );
}

export interface LoadedDecisions {
  decisions: DecisionRecord[];
  dropped: number;
  corrupt: boolean;
}

export function loadDecisions(storage: StorageLike | undefined, key: string): LoadedDecisions {
  const empty: LoadedDecisions = { decisions: [], dropped: 0, corrupt: false };
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
      !Array.isArray((parsed as { decisions?: unknown }).decisions)
    ) {
      return { ...empty, corrupt: true };
    }
    const items = (parsed as { decisions: unknown[] }).decisions;
    const seen = new Set<string>();
    const decisions: DecisionRecord[] = [];
    for (const item of items) {
      // One record per request: a duplicate id is treated as tampering and dropped.
      if (isDecisionRecord(item) && !seen.has(item.requestId)) {
        seen.add(item.requestId);
        decisions.push(item);
      }
    }
    return { decisions, dropped: items.length - decisions.length, corrupt: false };
  } catch {
    return { ...empty, corrupt: true };
  }
}

/** Returns false when the data could not be written. */
export function saveDecisions(
  storage: StorageLike | undefined,
  key: string,
  decisions: readonly DecisionRecord[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, decisions }));
    return true;
  } catch {
    return false;
  }
}

export interface DerivedStatus {
  status: ApprovalStatus;
  /** A decision exists for this id but the payload changed since: fresh review required. */
  changedSinceDecision: boolean;
}

/**
 * Status of one request. A decision counts only if its fingerprint matches the current payload.
 * Otherwise the request is expired (when past expiry) or pending again.
 */
export function deriveStatus(
  request: ApprovalRequest,
  decisions: readonly DecisionRecord[],
  nowSeconds: number,
): DerivedStatus {
  const record = decisions.find((d) => d.requestId === request.id);
  const matches = record !== undefined && record.fingerprint === requestFingerprint(request);
  if (record && matches) return { status: record.decision, changedSinceDecision: false };
  const changedSinceDecision = record !== undefined;
  if (request.operation.expiresAt <= nowSeconds) return { status: 'expired', changedSinceDecision };
  return { status: 'pending', changedSinceDecision };
}

export function withDecision(
  decisions: readonly DecisionRecord[],
  request: ApprovalRequest,
  decision: LocalDecision,
  nowSeconds: number,
): DecisionRecord[] {
  const record: DecisionRecord = {
    requestId: request.id,
    decision,
    decidedAt: nowSeconds,
    fingerprint: requestFingerprint(request),
  };
  return [...decisions.filter((d) => d.requestId !== request.id), record];
}
