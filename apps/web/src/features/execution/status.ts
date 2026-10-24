import type { ExecutionEvidence, ExecutionStatus } from './types';

/**
 * Derives the displayed status from evidence only. There is no optimistic state: `confirmed`
 * requires a successful bundle receipt AND a successful UserOperationEvent for this operation.
 */
export function deriveStatus(evidence: ExecutionEvidence): ExecutionStatus {
  const { inclusion, submission } = evidence;

  if (inclusion) {
    if (inclusion.txStatus === 'reverted' || inclusion.userOpSuccess === false) {
      return evidence.policyRejection?.source === 'onchain' ? 'policy_rejected' : 'reverted';
    }
    if (inclusion.userOpSuccess === true) return 'confirmed';
    // Included, but the operation's own outcome has not been decoded: do not claim success.
    return 'pending';
  }

  if (submission?.bundlerAccepted === true && submission.userOpHash) return 'pending';
  if (evidence.policyRejection) return 'policy_rejected';
  if (evidence.userRejectedSignature) return 'user_rejected';
  if (evidence.clientRejections && evidence.clientRejections.length > 0) return 'validation_failed';
  if (evidence.unexpectedError) return 'error';
  if (submission && submission.attempted) return 'submission_failed';
  return 'not_submitted';
}

export const STATUS_LABELS: Record<ExecutionStatus, string> = {
  not_submitted: 'Not submitted',
  validation_failed: 'Blocked before submission',
  user_rejected: 'Rejected by user',
  policy_rejected: 'Rejected by policy',
  submission_failed: 'Submission failed',
  pending: 'Pending',
  confirmed: 'Confirmed',
  reverted: 'Reverted',
  error: 'Error',
};

/** Statuses that further evidence must never silently overwrite (chain-final, modulo reorgs). */
export function isFinal(status: ExecutionStatus): boolean {
  return status === 'confirmed' || status === 'reverted';
}
