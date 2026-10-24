import { deriveStatus, isFinal } from './status';
import type { ExecutionEvidence, ExecutionStatus, OperationRequest } from './types';
import { operationKey } from './validate';

export interface OperationRecord {
  key: string;
  op: OperationRequest;
  evidence: ExecutionEvidence;
  /** Number of submission attempts that reached the bundler call. */
  attempts: number;
  createdAt: number;
}

export type Ledger = Readonly<Record<string, OperationRecord>>;

export const EMPTY_LEDGER: Ledger = {};

export type RegisterResult =
  | { kind: 'created'; ledger: Ledger; record: OperationRecord }
  | { kind: 'duplicate'; ledger: Ledger; record: OperationRecord }
  | { kind: 'nonce_conflict'; ledger: Ledger; conflictsWith: OperationRecord };

/** Registers an operation. The same payload returns the existing record instead of a second one. */
export function registerOperation(ledger: Ledger, op: OperationRequest, now: number): RegisterResult {
  const key = operationKey(op);
  const existing = ledger[key];
  if (existing) return { kind: 'duplicate', ledger, record: existing };

  const nonce = BigInt(op.nonce).toString();
  for (const other of Object.values(ledger)) {
    if (
      other.op.chainId === op.chainId &&
      other.op.account.toLowerCase() === op.account.toLowerCase() &&
      BigInt(other.op.nonce).toString() === nonce
    ) {
      return { kind: 'nonce_conflict', ledger, conflictsWith: other };
    }
  }

  const record: OperationRecord = { key, op, evidence: {}, attempts: 0, createdAt: now };
  return { kind: 'created', ledger: { ...ledger, [key]: record }, record };
}

export type SubmitDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Whether the operation may be sent to the bundler now. A retry is allowed only if the previous
 * attempt provably produced no UserOperation hash; otherwise the caller must poll, not resend.
 */
export function canSubmit(record: OperationRecord): SubmitDecision {
  const status = deriveStatus(record.evidence);
  switch (status) {
    case 'not_submitted':
      return { allowed: true };
    case 'submission_failed':
      return record.evidence.submission?.userOpHash
        ? { allowed: false, reason: 'A UserOperation hash exists; check its status instead of resubmitting.' }
        : { allowed: true };
    case 'pending':
      return { allowed: false, reason: 'Operation is already pending; wait for its outcome.' };
    case 'confirmed':
    case 'reverted':
      return { allowed: false, reason: 'Operation already reached a final outcome; create a new operation.' };
    default:
      return { allowed: false, reason: `Operation is ${status}; create a new operation with a fresh nonce.` };
  }
}

export interface EvidenceUpdate {
  ledger: Ledger;
  status: ExecutionStatus;
  /** False when the update was refused because it would overwrite a final outcome. */
  applied: boolean;
}

/** Merges new evidence. A final outcome (confirmed or reverted) is never overwritten. */
export function recordEvidence(
  ledger: Ledger,
  key: string,
  patch: Partial<ExecutionEvidence>,
  options: { countAttempt?: boolean } = {},
): EvidenceUpdate {
  const record = ledger[key];
  if (!record) throw new Error(`Unknown operation ${key}`);

  const before = deriveStatus(record.evidence);
  const merged: ExecutionEvidence = { ...record.evidence, ...patch };
  const after = deriveStatus(merged);

  if (isFinal(before) && after !== before) {
    return { ledger, status: before, applied: false };
  }

  const next: OperationRecord = {
    ...record,
    evidence: merged,
    attempts: record.attempts + (options.countAttempt ? 1 : 0),
  };
  return { ledger: { ...ledger, [key]: next }, status: after, applied: true };
}

export function statusOf(ledger: Ledger, key: string): ExecutionStatus {
  const record = ledger[key];
  return record ? deriveStatus(record.evidence) : 'not_submitted';
}
