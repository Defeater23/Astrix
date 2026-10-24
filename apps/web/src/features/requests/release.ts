import type { OperationRequest, Rejection } from '../execution/types';
import { validateOperation } from '../execution/validate';
import type { ValidationContext } from '../execution/validate';
import { requestFingerprint } from './schema';
import type { RequestPayload, RequestRecord } from './types';

/**
 * The interface between the approval workflow (7B), the Module 6 execution layer, and the
 * cryptographic owner authorization (7C, not built yet).
 *
 * `evaluateRelease` answers one question: may the app hand this request to the Module 6 submit
 * path now? It can say yes only when ALL of these hold: the owner approved the exact current
 * payload, it has not expired, the Module 6 advisory validation passes, and an
 * `AuthorizationVerifier` accepts the owner's signature evidence. 7B ships no verifier, so in this
 * module the answer is always "no". A stored `approved` status alone is never sufficient.
 *
 * Even a "yes" is advisory client logic. The smart account validates the signature and the
 * on-chain policy enforces limits; both can still refuse.
 */

export type AuthorizationVerdict = { valid: true } | { valid: false; reason: string };

export interface AuthorizationCheck {
  request: RequestPayload;
  /** Fingerprint of the request being released (a comparison aid, not the signed digest). */
  fingerprint: string;
  /** Opaque to 7B. 7C defines its shape (owner signature over the exact operation). */
  evidence: unknown;
  nowSeconds: number;
}

/**
 * Implemented by Module 7C. It must verify the owner's signature against the account's real
 * signature scheme and bind it to the exact operation, account, chain, nonce and expiry.
 */
export interface AuthorizationVerifier {
  verify(check: AuthorizationCheck): AuthorizationVerdict;
}

export type ReleaseBlockCode =
  | 'NOT_APPROVED'
  | 'EXPIRED'
  | 'PAYLOAD_CHANGED'
  | 'APPROVAL_FOR_DIFFERENT_PAYLOAD'
  | 'OWNER_MISMATCH'
  | 'EXECUTION_VALIDATION_FAILED'
  | 'NO_VERIFIER'
  | 'NO_EVIDENCE'
  | 'AUTHORIZATION_INVALID';

export interface ReleaseBlock {
  code: ReleaseBlockCode;
  message: string;
  /** Module 6 rejections, present for `EXECUTION_VALIDATION_FAILED`. */
  rejections?: Rejection[];
}

export type ReleaseDecision =
  | { allowed: true; operation: OperationRequest }
  | { allowed: false; blocks: ReleaseBlock[] };

export interface ReleaseContext {
  /** Connected owner address. */
  owner: string;
  /** Module 6 advisory context: chain, account, time, expected nonce, used nonces, agent, policy. */
  execution: ValidationContext;
}

export interface AuthorizationInput {
  verifier?: AuthorizationVerifier;
  evidence?: unknown;
}

export function evaluateRelease(
  record: RequestRecord,
  ctx: ReleaseContext,
  authorization: AuthorizationInput = {},
): ReleaseDecision {
  const blocks: ReleaseBlock[] = [];
  const block = (code: ReleaseBlockCode, message: string, rejections?: Rejection[]) =>
    blocks.push({ code, message, ...(rejections ? { rejections } : {}) });

  const now = ctx.execution.nowSeconds;
  const op = record.request.operation;

  if (record.status !== 'approved') {
    block('NOT_APPROVED', `The request is ${record.status}, not approved.`);
  }
  if (op.expiresAt <= now) block('EXPIRED', 'The request has expired.');
  if (record.request.owner.toLowerCase() !== ctx.owner.toLowerCase()) {
    block('OWNER_MISMATCH', 'The connected owner is not the owner this request was made for.');
  }
  if (requestFingerprint(record.request) !== record.fingerprint) {
    block('PAYLOAD_CHANGED', 'The stored request no longer matches its recorded fingerprint.');
  }
  if (record.status === 'approved' && record.approvedFingerprint !== record.fingerprint) {
    block(
      'APPROVAL_FOR_DIFFERENT_PAYLOAD',
      'The approval was recorded for a different payload than the current one.',
    );
  }

  const execution = validateOperation(op, ctx.execution);
  if (!execution.ok) {
    block(
      'EXECUTION_VALIDATION_FAILED',
      'Module 6 pre-submission validation failed.',
      execution.rejections,
    );
  }

  if (!authorization.verifier) {
    block('NO_VERIFIER', 'No cryptographic authorization verifier exists yet (Module 7C).');
  } else if (authorization.evidence === undefined) {
    block('NO_EVIDENCE', 'No owner signature evidence was provided.');
  } else {
    let verdict: AuthorizationVerdict;
    try {
      verdict = authorization.verifier.verify({
        request: record.request,
        fingerprint: record.fingerprint,
        evidence: authorization.evidence,
        nowSeconds: now,
      });
    } catch {
      verdict = { valid: false, reason: 'The verifier failed.' };
    }
    if (!verdict.valid) block('AUTHORIZATION_INVALID', verdict.reason);
  }

  return blocks.length === 0 ? { allowed: true, operation: op } : { allowed: false, blocks };
}
