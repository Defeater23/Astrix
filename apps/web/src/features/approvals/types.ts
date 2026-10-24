import type { OperationRequest } from '../execution/types';

/**
 * Module 7A types: what the owner reviews. Everything here is display and local bookkeeping.
 * A decision recorded in this folder is NOT a signature and authorizes nothing on-chain; the
 * smart account and the on-chain policy remain the only authority (see docs/APPROVAL_UI.md).
 */

/** Token display metadata supplied WITH the request. It is not verified on-chain. */
export interface TokenMetadata {
  symbol: string;
  /** Integer 0 to 36. Used for display only; amounts always stay exact base units. */
  decimals: number;
}

/** An operation awaiting owner review, built on the Module 6 OperationRequest. */
export interface ApprovalRequest {
  id: string;
  operation: OperationRequest;
  /** What the agent says it is paying for. Agent-supplied text, shown as such. */
  purpose: string;
  /** Why the request needs owner approval. */
  reason: string;
  /** Unix seconds (UTC). */
  createdAt: number;
  tokenMeta?: TokenMetadata;
}

/** Local UI decisions. Neither value is a cryptographic approval. */
export type LocalDecision = 'ui_approved' | 'ui_rejected';

export interface DecisionRecord {
  requestId: string;
  decision: LocalDecision;
  /** Unix seconds (UTC). */
  decidedAt: number;
  /** Canonical string of the exact payload that was reviewed. */
  fingerprint: string;
}

export type ApprovalStatus = 'pending' | 'ui_approved' | 'ui_rejected' | 'expired';

export interface ApprovalScope {
  owner: string;
  chainId: number;
}

/**
 * Where requests come from. 7A ships a labelled deterministic demo source; 7B adds a workflow-store
 * source (`features/requests/adapter.ts`) that the page does not use yet.
 */
export interface ApprovalRequestSource {
  kind: 'demo' | 'workflow';
  label: string;
  /** Resolves unvalidated values; every item is checked before it can be displayed. */
  list: (scope: ApprovalScope, nowSeconds: number) => Promise<unknown[]>;
}
