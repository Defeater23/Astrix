import { requestFingerprint } from './schema';
import type { Actor, RequestRecord, RequestStatus, TransitionEntry } from './types';

/**
 * Module 7B status lifecycle. These are application states. `approved` means the owner clicked
 * Approve for the exact payload they reviewed; it is NOT authorization. Nothing in this file can
 * make the smart account or the on-chain policy execute anything.
 *
 *   pending  -> approved   (owner, payload unchanged, not expired)
 *   pending  -> rejected   (owner, not expired)
 *   pending  -> cancelled  (agent or owner)
 *   approved -> cancelled  (owner; revokes the app-level approval)
 *   pending | approved -> expired     (system, only once the expiry time has passed)
 *   pending | approved -> superseded  (system, when a replacement request is submitted)
 *
 * rejected, expired, cancelled and superseded are final.
 */

export const ALLOWED_TRANSITIONS: Readonly<
  Record<RequestStatus, Readonly<Partial<Record<RequestStatus, readonly Actor[]>>>>
> = {
  pending: {
    approved: ['owner'],
    rejected: ['owner'],
    cancelled: ['agent', 'owner'],
    expired: ['system'],
    superseded: ['system'],
  },
  approved: {
    cancelled: ['owner'],
    expired: ['system'],
    superseded: ['system'],
  },
  rejected: {},
  expired: {},
  cancelled: {},
  superseded: {},
};

export function isTerminal(status: RequestStatus): boolean {
  return Object.keys(ALLOWED_TRANSITIONS[status]).length === 0;
}

export function isActive(status: RequestStatus): boolean {
  return status === 'pending' || status === 'approved';
}

export type TransitionErrorCode =
  | 'NOT_FOUND'
  | 'NOT_ALLOWED'
  | 'ACTOR_NOT_PERMITTED'
  | 'EXPIRED'
  | 'NOT_YET_EXPIRED'
  | 'STALE_REVIEW'
  | 'INTEGRITY'
  | 'CLOCK_BACKWARDS'
  | 'MISSING_REPLACEMENT';

export interface TransitionInput {
  to: RequestStatus;
  actor: Actor;
  /** Unix seconds (UTC). */
  now: number;
  /** Required for `approved`: the fingerprint of the payload the owner had on screen. */
  reviewedFingerprint?: string;
  /** Required for `superseded`. */
  supersededBy?: string;
  note?: string;
}

export type TransitionResult =
  | { ok: true; record: RequestRecord }
  | { ok: false; code: TransitionErrorCode; message: string };

function fail(code: TransitionErrorCode, message: string): TransitionResult {
  return { ok: false, code, message };
}

/** Applies one status change if, and only if, every rule allows it. Never mutates its input. */
export function transition(record: RequestRecord, input: TransitionInput): TransitionResult {
  const { to, actor, now } = input;
  const allowedActors = ALLOWED_TRANSITIONS[record.status][to];
  if (!allowedActors) {
    return fail('NOT_ALLOWED', `A ${record.status} request cannot become ${to}.`);
  }
  if (!allowedActors.includes(actor)) {
    return fail('ACTOR_NOT_PERMITTED', `The ${actor} may not move a request to ${to}.`);
  }

  const last = record.history[record.history.length - 1];
  if (last && now < last.at) {
    return fail('CLOCK_BACKWARDS', 'The clock is earlier than the last recorded change.');
  }

  const expiresAt = record.request.operation.expiresAt;
  if ((to === 'approved' || to === 'rejected') && now >= expiresAt) {
    return fail('EXPIRED', 'The request has expired.');
  }
  if (to === 'expired' && now < expiresAt) {
    return fail('NOT_YET_EXPIRED', 'The request has not reached its expiry time.');
  }

  if (to === 'approved') {
    if (requestFingerprint(record.request) !== record.fingerprint) {
      return fail('INTEGRITY', 'The stored request no longer matches its fingerprint.');
    }
    if (input.reviewedFingerprint !== record.fingerprint) {
      return fail('STALE_REVIEW', 'The request changed after it was reviewed. Review it again.');
    }
  }
  if (to === 'superseded' && !input.supersededBy) {
    return fail('MISSING_REPLACEMENT', 'A superseded request must name its replacement.');
  }

  const entry: TransitionEntry = {
    from: record.status,
    to,
    at: now,
    actor,
    ...(input.note ? { note: input.note } : {}),
  };
  const next: RequestRecord = {
    ...record,
    status: to,
    history: [...record.history, entry],
    ...(to === 'approved' ? { approvedFingerprint: record.fingerprint } : {}),
    ...(to === 'superseded' && input.supersededBy ? { supersededBy: input.supersededBy } : {}),
  };
  return { ok: true, record: next };
}

/** Moves an active request past its expiry to `expired`. Returns the record unchanged otherwise. */
export function refreshExpiry(record: RequestRecord, now: number): RequestRecord {
  if (!isActive(record.status) || now < record.request.operation.expiresAt) return record;
  const result = transition(record, {
    to: 'expired',
    actor: 'system',
    now,
    note: 'Expiry time passed.',
  });
  return result.ok ? result.record : record;
}

/** True when the history is a valid chain from creation to the current status. */
export function isConsistentHistory(record: RequestRecord): boolean {
  const { history } = record;
  const first = history[0];
  if (!first || first.from !== null || first.to !== 'pending' || first.actor !== 'agent') {
    return false;
  }
  let status: RequestStatus = 'pending';
  let at = first.at;
  for (const entry of history.slice(1)) {
    if (entry.from !== status || entry.at < at) return false;
    const actors = ALLOWED_TRANSITIONS[status][entry.to];
    if (!actors || !actors.includes(entry.actor)) return false;
    status = entry.to;
    at = entry.at;
  }
  return status === record.status;
}
