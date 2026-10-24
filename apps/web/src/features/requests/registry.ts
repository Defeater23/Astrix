import { operationKey } from '../execution/validate';
import { isActive, refreshExpiry, transition } from './lifecycle';
import type { TransitionErrorCode } from './lifecycle';
import type { RequestRecord, RequestStatus, RequestStore, ValidatedRequest } from './types';

/**
 * Pure operations over a request store: submission with duplicate, nonce and material-change
 * protection, owner decisions, cancellation and expiry. Every function returns a new store. This
 * is application bookkeeping; a stored `approved` status never authorizes execution.
 */

export const MAX_RECORDS = 500;

export type SubmitRejectionCode =
  | 'ID_REUSED_WITH_DIFFERENT_PAYLOAD'
  | 'DUPLICATE_OPERATION'
  | 'NONCE_CONFLICT'
  | 'SUPERSEDE_TARGET_INVALID'
  | 'STORE_FULL';

export type SubmitResult =
  | { kind: 'created'; store: RequestStore; record: RequestRecord }
  | { kind: 'duplicate'; store: RequestStore; record: RequestRecord }
  | {
      kind: 'rejected';
      code: SubmitRejectionCode;
      message: string;
      conflictsWith?: string;
    };

export interface SubmitOptions {
  /** Replace an active request of the same owner, account, chain and agent with this one. */
  supersedes?: string;
}

function sameNonceSpace(a: RequestRecord, b: RequestRecord): boolean {
  const x = a.request.operation;
  const y = b.request.operation;
  return (
    x.chainId === y.chainId &&
    x.account.toLowerCase() === y.account.toLowerCase() &&
    BigInt(x.nonce) === BigInt(y.nonce)
  );
}

/**
 * Adds a validated request. The same payload submitted again returns the existing record. A known
 * ID with a different payload is refused: a materially changed request needs a new ID (and, to
 * retire the old one, `supersedes`). Two active requests may not share an account nonce.
 */
export function submit(
  store: RequestStore,
  validated: ValidatedRequest,
  now: number,
  options: SubmitOptions = {},
): SubmitResult {
  const { request, fingerprint } = validated;

  const existing = store[request.requestId];
  if (existing) {
    if (existing.fingerprint === fingerprint) return { kind: 'duplicate', store, record: existing };
    return {
      kind: 'rejected',
      code: 'ID_REUSED_WITH_DIFFERENT_PAYLOAD',
      message: 'This request ID already exists with a different payload. Use a new request ID.',
      conflictsWith: request.requestId,
    };
  }

  let target: RequestRecord | undefined;
  if (options.supersedes !== undefined) {
    const candidate = store[options.supersedes];
    const fresh = candidate ? refreshExpiry(candidate, now) : undefined;
    const op = request.operation;
    if (
      !fresh ||
      !isActive(fresh.status) ||
      fresh.request.requestId === request.requestId ||
      fresh.request.owner !== request.owner ||
      fresh.request.operation.chainId !== op.chainId ||
      fresh.request.operation.account !== op.account ||
      fresh.request.operation.agent !== op.agent
    ) {
      return {
        kind: 'rejected',
        code: 'SUPERSEDE_TARGET_INVALID',
        message:
          'The request to supersede must exist, be pending or approved, and share owner, chain, account and agent.',
        conflictsWith: options.supersedes,
      };
    }
    target = fresh;
  }

  const candidateRecord: RequestRecord = {
    request,
    fingerprint,
    status: 'pending',
    history: [],
  };
  const key = operationKey(request.operation);
  for (const other of Object.values(store)) {
    if (target && other.request.requestId === target.request.requestId) continue;
    const fresh = refreshExpiry(other, now);
    if (!isActive(fresh.status) || !sameNonceSpace(fresh, candidateRecord)) continue;
    const identical = operationKey(fresh.request.operation) === key;
    return {
      kind: 'rejected',
      code: identical ? 'DUPLICATE_OPERATION' : 'NONCE_CONFLICT',
      message: identical
        ? `The same operation is already open as request ${fresh.request.requestId}.`
        : `Request ${fresh.request.requestId} already uses this account nonce.`,
      conflictsWith: fresh.request.requestId,
    };
  }

  if (Object.keys(store).length >= MAX_RECORDS) {
    return {
      kind: 'rejected',
      code: 'STORE_FULL',
      message: `At most ${MAX_RECORDS} requests are kept. Remove finished requests first.`,
    };
  }

  let next: Record<string, RequestRecord> = { ...store };
  if (target) {
    const superseded = transition(target, {
      to: 'superseded',
      actor: 'system',
      now,
      supersededBy: request.requestId,
      note: `Replaced by ${request.requestId}.`,
    });
    if (!superseded.ok) {
      return {
        kind: 'rejected',
        code: 'SUPERSEDE_TARGET_INVALID',
        message: superseded.message,
        conflictsWith: target.request.requestId,
      };
    }
    next = { ...next, [target.request.requestId]: superseded.record };
  }
  const record: RequestRecord = {
    ...candidateRecord,
    history: [{ from: null, to: 'pending', at: now, actor: 'agent' }],
  };
  next[request.requestId] = record;
  return { kind: 'created', store: next, record };
}

export type ChangeResult =
  | { ok: true; store: RequestStore; record: RequestRecord }
  | {
      ok: false;
      code: TransitionErrorCode;
      message: string;
      /** The store with any due expiry applied; callers should keep this one. */
      store: RequestStore;
    };

function change(
  store: RequestStore,
  requestId: string,
  now: number,
  apply: (record: RequestRecord) => ReturnType<typeof transition>,
): ChangeResult {
  const found = store[requestId];
  if (!found) return { ok: false, code: 'NOT_FOUND', message: 'No such request.', store };
  const record = refreshExpiry(found, now);
  const settled: RequestStore = record === found ? store : { ...store, [requestId]: record };
  const result = apply(record);
  if (!result.ok) return { ok: false, code: result.code, message: result.message, store: settled };
  return { ok: true, store: { ...settled, [requestId]: result.record }, record: result.record };
}

/**
 * Records the owner's decision. `reviewedFingerprint` must be the fingerprint of the payload the
 * owner was shown; if the stored request changed since, the approval is refused.
 */
export function decide(
  store: RequestStore,
  requestId: string,
  decision: Extract<RequestStatus, 'approved' | 'rejected'>,
  input: { reviewedFingerprint: string; now: number },
): ChangeResult {
  return change(store, requestId, input.now, (record) =>
    transition(record, {
      to: decision,
      actor: 'owner',
      now: input.now,
      reviewedFingerprint: input.reviewedFingerprint,
    }),
  );
}

export function cancel(
  store: RequestStore,
  requestId: string,
  actor: 'agent' | 'owner',
  now: number,
): ChangeResult {
  return change(store, requestId, now, (record) =>
    transition(record, { to: 'cancelled', actor, now }),
  );
}

/** Marks every active request past its expiry as expired. */
export function expireDue(store: RequestStore, now: number): RequestStore {
  let changed = false;
  const next: Record<string, RequestRecord> = {};
  for (const [id, record] of Object.entries(store)) {
    const fresh = refreshExpiry(record, now);
    if (fresh !== record) changed = true;
    next[id] = fresh;
  }
  return changed ? next : store;
}
