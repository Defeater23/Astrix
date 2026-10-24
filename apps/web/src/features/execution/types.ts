/**
 * Module 06 domain types: what an agent operation looks like before submission, and what evidence
 * exists afterwards. Everything here is client-side bookkeeping. The smart account and the policy
 * contract decide whether an operation may execute; nothing in this folder is an authority.
 */

/** An agent operation to be executed by the smart account. Amounts and nonce are decimal strings. */
export interface OperationRequest {
  account: string;
  agent: string;
  chainId: number;
  nonce: string;
  /** Unix seconds after which the operation must not be executed. */
  expiresAt: number;
  target: string;
  /** Native value in wei, decimal string. */
  value: string;
  /** 0x-prefixed calldata, "0x" for a plain transfer. */
  data: string;
}

export type RejectionCode =
  | 'INVALID_ADDRESS'
  | 'INVALID_AMOUNT'
  | 'INVALID_NONCE'
  | 'INVALID_DATA'
  | 'WRONG_CHAIN'
  | 'WRONG_ACCOUNT'
  | 'EXPIRED'
  | 'NONCE_MISMATCH'
  | 'NONCE_REUSED'
  | 'AGENT_NOT_AUTHORIZED'
  | 'POLICY_PREVIEW_DENIED';

export interface Rejection {
  code: RejectionCode;
  message: string;
}

/** Evidence that the policy (not the client) refused the operation. */
export interface PolicyRejectionEvidence {
  /** `simulation`: an eth_call or bundler simulation reverted. `onchain`: a mined revert. */
  source: 'simulation' | 'onchain';
  reason: string;
  revertData?: string;
}

export interface SubmissionEvidence {
  attempted: boolean;
  userOpHash?: string;
  bundlerAccepted?: boolean;
  error?: string;
}

export interface InclusionEvidence {
  transactionHash: string;
  blockNumber: number;
  /** Status of the bundle transaction from its receipt. */
  txStatus: 'success' | 'reverted';
  /** `success` field of the UserOperationEvent for this operation, if it was decoded. */
  userOpSuccess?: boolean;
}

export interface ExecutionEvidence {
  clientRejections?: Rejection[];
  userRejectedSignature?: boolean;
  policyRejection?: PolicyRejectionEvidence;
  submission?: SubmissionEvidence;
  inclusion?: InclusionEvidence;
  unexpectedError?: string;
}

export type ExecutionStatus =
  | 'not_submitted'
  | 'validation_failed'
  | 'user_rejected'
  | 'policy_rejected'
  | 'submission_failed'
  | 'pending'
  | 'confirmed'
  | 'reverted'
  | 'error';
