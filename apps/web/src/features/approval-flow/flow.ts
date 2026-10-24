import type { Hex } from 'viem';
import { approvalDigest, executeCallData, executionHashOf } from '../authorization/typedData';
import type { VerifiedOwnerApproval } from '../authorization/verify';
import { canSubmit, recordEvidence, registerOperation } from '../execution/tracker';
import type { Ledger } from '../execution/tracker';
import type { ExecutionStatus, InclusionEvidence, OperationRequest } from '../execution/types';
import { operationKey } from '../execution/validate';
import { decide } from '../requests/registry';
import type { ChangeResult } from '../requests/registry';
import { evaluateRelease } from '../requests/release';
import type { AuthorizationVerifier, ReleaseBlock, ReleaseContext } from '../requests/release';
import { requestFingerprint } from '../requests/schema';
import type { RequestRecord, RequestStore } from '../requests/types';

/**
 * Module 7D: joins the 7B workflow, the 7C owner signature and the Module 06 execution ledger.
 *
 * Everything here is client-side coordination. It is ADVISORY: the smart account validates the
 * UserOperation signature, `SentinelPolicy` enforces limits, and `SentinelOwnerApproval` is consumed
 * by the hook at execution. A "plan" from this file never authorizes anything; it only guarantees
 * that the app hands the bundler exactly the operation the owner reviewed and signed, once.
 */

/** What the owner had on screen. Captured when the review opens; compared again before sending. */
export interface ReviewSnapshot {
  readonly requestId: string;
  readonly fingerprint: string;
  readonly executionHash: Hex;
}

export function snapshotForReview(record: RequestRecord): ReviewSnapshot {
  return Object.freeze({
    requestId: record.request.requestId,
    fingerprint: requestFingerprint(record.request),
    executionHash: executionHashOf(record.request.operation),
  });
}

/** `SentinelOwnerApproval.Status` as returned by `statusOf(digest)`. */
export type OnChainApprovalStatus = 'none' | 'approved' | 'consumed' | 'revoked';

export const ON_CHAIN_STATUS_BY_INDEX: readonly OnChainApprovalStatus[] = [
  'none',
  'approved',
  'consumed',
  'revoked',
];

export function onChainStatusFromIndex(index: number): OnChainApprovalStatus | undefined {
  return ON_CHAIN_STATUS_BY_INDEX[index];
}

export type PlanBlockCode =
  | 'RELEASE_BLOCKED'
  | 'REVIEW_MISMATCH'
  | 'APPROVAL_MISMATCH'
  | 'APPROVAL_NOT_ON_CHAIN'
  | 'NONCE_CONFLICT'
  | 'NOT_SUBMITTABLE';

export interface PlanBlock {
  code: PlanBlockCode;
  message: string;
  /** Release gate blocks, present for `RELEASE_BLOCKED`. */
  release?: ReleaseBlock[];
}

/** Exactly what will be sent. Built only by `prepareExecution`. */
export interface ExecutionPlan {
  readonly requestId: string;
  readonly fingerprint: string;
  readonly operation: OperationRequest;
  /** `userOp.callData[4:]`: the `execute(mode, executionCalldata)` bytes the hook will hash. */
  readonly callData: Hex;
  readonly executionHash: Hex;
  readonly approvalDigest: Hex;
  readonly approvalSignature: Hex;
  readonly operationKey: string;
}

export type PrepareResult =
  | { ok: true; plan: ExecutionPlan; ledger: Ledger }
  | { ok: false; blocks: PlanBlock[]; ledger: Ledger };

export interface PrepareInput {
  record: RequestRecord;
  /** What the owner reviewed. */
  review: ReviewSnapshot;
  ctx: ReleaseContext;
  /** Evidence from `verifyOwnerSignature`. */
  approval: VerifiedOwnerApproval;
  verifier: AuthorizationVerifier;
  /** `SentinelOwnerApproval.statusOf(digest)` read from the chain. Must be `approved`. */
  onChainStatus: OnChainApprovalStatus;
  ledger: Ledger;
}

/**
 * Decides whether this exact request may be handed to the bundler now. It re-derives the
 * fingerprint, execution hash and digest from the record, and requires the reviewed snapshot, the
 * signed message and the on-chain approval to all agree with them. Every failure is reported.
 */
export function prepareExecution(input: PrepareInput): PrepareResult {
  const { record, review, ctx, approval, verifier, onChainStatus } = input;
  const op = record.request.operation;
  const blocks: PlanBlock[] = [];
  const add = (code: PlanBlockCode, message: string, release?: ReleaseBlock[]) =>
    blocks.push({ code, message, ...(release ? { release } : {}) });

  const release = evaluateRelease(record, ctx, { verifier, evidence: approval });
  if (!release.allowed) {
    add('RELEASE_BLOCKED', 'The release gate refused this request.', release.blocks);
  }

  const fingerprint = requestFingerprint(record.request);
  const executionHash = executionHashOf(op);
  if (
    review.requestId !== record.request.requestId ||
    review.fingerprint !== fingerprint ||
    review.executionHash !== executionHash
  ) {
    add('REVIEW_MISMATCH', 'The operation to be executed is not the one the owner reviewed.');
  }

  const digest = approvalDigest(record.request, approval.verifyingContract);
  const m = approval.message;
  if (
    approval.requestId !== record.request.requestId ||
    approval.fingerprint !== fingerprint ||
    approval.digest !== digest ||
    m.executionHash !== executionHash ||
    m.account.toLowerCase() !== op.account.toLowerCase() ||
    m.agent.toLowerCase() !== op.agent.toLowerCase() ||
    m.userOpNonce !== BigInt(op.nonce) ||
    m.expiry !== BigInt(op.expiresAt) ||
    approval.chainId !== op.chainId
  ) {
    add('APPROVAL_MISMATCH', 'The signed approval does not match this exact operation.');
  }

  if (onChainStatus !== 'approved') {
    add(
      'APPROVAL_NOT_ON_CHAIN',
      `The approval is "${onChainStatus}" on-chain; it must be submitted and still approved.`,
    );
  }

  let ledger = input.ledger;
  const registered = registerOperation(ledger, op, ctx.execution.nowSeconds);
  if (registered.kind === 'nonce_conflict') {
    add('NONCE_CONFLICT', 'Another operation already uses this account, chain and nonce.');
  } else {
    ledger = registered.ledger;
    const decision = canSubmit(registered.record);
    if (!decision.allowed) add('NOT_SUBMITTABLE', decision.reason);
  }

  if (blocks.length > 0) return { ok: false, blocks, ledger };

  const plan: ExecutionPlan = Object.freeze({
    requestId: record.request.requestId,
    fingerprint,
    operation: Object.freeze({ ...op }),
    callData: executeCallData(op),
    executionHash,
    approvalDigest: digest,
    approvalSignature: approval.signature,
    operationKey: operationKey(op),
  });
  return { ok: true, plan, ledger };
}

// ------------------------------------------------------------------------- recording decisions

export type DecisionResult =
  | { ok: true; store: RequestStore }
  | { ok: false; store: RequestStore; message: string };

function refused(store: RequestStore, message: string): DecisionResult {
  return { ok: false, store, message };
}

function fromChange(result: ChangeResult): DecisionResult {
  return result.ok
    ? { ok: true, store: result.store }
    : { ok: false, store: result.store, message: result.message };
}

/**
 * Marks a request `approved` only after a verified owner signature for the SAME reviewed payload
 * exists. The status is bookkeeping; execution still needs the on-chain approval.
 */
export function recordSignedApproval(
  store: RequestStore,
  requestId: string,
  review: ReviewSnapshot,
  approval: VerifiedOwnerApproval,
  now: number,
): DecisionResult {
  const record = store[requestId];
  if (!record) return refused(store, 'No such request.');
  if (approval.requestId !== requestId || review.requestId !== requestId) {
    return refused(store, 'The signature or review belongs to another request.');
  }
  if (approval.fingerprint !== review.fingerprint) {
    return refused(store, 'The owner signed a different payload than the one reviewed.');
  }
  return fromChange(decide(store, requestId, 'approved', { reviewedFingerprint: review.fingerprint, now }));
}

/** Rejection needs no signature and creates nothing that could be sent. */
export function recordRejection(
  store: RequestStore,
  requestId: string,
  review: ReviewSnapshot,
  now: number,
): DecisionResult {
  return fromChange(decide(store, requestId, 'rejected', { reviewedFingerprint: review.fingerprint, now }));
}

// ----------------------------------------------------------------------------- submitting

export type SendOutcome =
  | { kind: 'accepted'; userOpHash: string }
  | { kind: 'user_rejected' }
  | { kind: 'policy_rejected'; reason: string; revertData?: string }
  | { kind: 'bundler_error'; error: string; userOpHash?: string }
  | { kind: 'unexpected_error'; error: string };

/** Builds, signs and sends the UserOperation. Implemented against the real bundler later. */
export interface OperationSender {
  send(plan: ExecutionPlan): Promise<SendOutcome>;
}

export interface SubmitResult {
  ledger: Ledger;
  status: ExecutionStatus;
  /** True only if the sender was actually called. */
  sent: boolean;
  reason?: string;
}

export interface SubmissionController {
  submit(plan: ExecutionPlan, ledger: Ledger): Promise<SubmitResult>;
}

/**
 * Sends a plan at most once per operation. It re-checks the ledger immediately before sending and
 * keeps an in-flight set so a double click or a concurrent call cannot send twice. A sender that
 * throws is recorded as `error`, which blocks retries: the operation may or may not have reached the
 * bundler, so resending could duplicate it.
 */
export function createSubmissionController(sender: OperationSender): SubmissionController {
  const inFlight = new Set<string>();

  return {
    async submit(plan, ledger): Promise<SubmitResult> {
      const record = ledger[plan.operationKey];
      if (!record) {
        return { ledger, status: 'not_submitted', sent: false, reason: 'The operation is not registered.' };
      }
      if (record.key !== operationKey(plan.operation)) {
        return { ledger, status: 'not_submitted', sent: false, reason: 'The plan does not match the ledger.' };
      }
      if (inFlight.has(plan.operationKey)) {
        return { ledger, status: 'not_submitted', sent: false, reason: 'This operation is already being sent.' };
      }
      const decision = canSubmit(record);
      if (!decision.allowed) {
        return { ledger, status: 'not_submitted', sent: false, reason: decision.reason };
      }

      inFlight.add(plan.operationKey);
      try {
        let outcome: SendOutcome;
        try {
          outcome = await sender.send(plan);
        } catch (error) {
          outcome = { kind: 'unexpected_error', error: error instanceof Error ? error.message : 'Unknown error.' };
        }
        const update = applyOutcome(ledger, plan.operationKey, outcome);
        return { ledger: update.ledger, status: update.status, sent: true };
      } finally {
        inFlight.delete(plan.operationKey);
      }
    },
  };
}

function applyOutcome(ledger: Ledger, key: string, outcome: SendOutcome) {
  switch (outcome.kind) {
    case 'accepted':
      return recordEvidence(
        ledger,
        key,
        { submission: { attempted: true, bundlerAccepted: true, userOpHash: outcome.userOpHash } },
        { countAttempt: true },
      );
    case 'user_rejected':
      return recordEvidence(ledger, key, { userRejectedSignature: true });
    case 'policy_rejected':
      return recordEvidence(
        ledger,
        key,
        {
          policyRejection: {
            source: 'simulation',
            reason: outcome.reason,
            ...(outcome.revertData ? { revertData: outcome.revertData } : {}),
          },
        },
        { countAttempt: true },
      );
    case 'bundler_error':
      return recordEvidence(
        ledger,
        key,
        {
          submission: {
            attempted: true,
            bundlerAccepted: false,
            error: outcome.error,
            ...(outcome.userOpHash ? { userOpHash: outcome.userOpHash } : {}),
          },
        },
        { countAttempt: true },
      );
    case 'unexpected_error':
      return recordEvidence(ledger, key, { unexpectedError: outcome.error }, { countAttempt: true });
  }
}

/** Receipt evidence for an operation, from chain data fetched by the caller. */
export function recordInclusion(ledger: Ledger, key: string, inclusion: InclusionEvidence) {
  return recordEvidence(ledger, key, { inclusion });
}
