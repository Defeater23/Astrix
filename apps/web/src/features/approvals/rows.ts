import type { DescribeContext, OperationDescription } from './decode';
import { describeOperation } from './decode';
import type { DerivedStatus } from './decisions';
import { deriveStatus } from './decisions';
import type { ApprovalRequest, ApprovalStatus, DecisionRecord } from './types';

export interface ApprovalRow {
  request: ApprovalRequest;
  description: OperationDescription;
  status: ApprovalStatus;
  changedSinceDecision: boolean;
  /** Reason the Approve control is unavailable, or undefined when it may be used. */
  approveBlockedReason: string | undefined;
  rejectBlockedReason: string | undefined;
}

export type QueueFilter = 'pending' | 'decided' | 'expired';

export function filterOf(status: ApprovalStatus): QueueFilter {
  if (status === 'pending') return 'pending';
  if (status === 'expired') return 'expired';
  return 'decided';
}

export const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: 'Pending review',
  ui_approved: 'Approved (UI only, not signed)',
  ui_rejected: 'Rejected (local)',
  expired: 'Expired',
};

/** Pure view model. Oldest request first so nothing is buried. */
export function buildRows(
  requests: readonly ApprovalRequest[],
  decisions: readonly DecisionRecord[],
  nowSeconds: number,
  ctx: DescribeContext,
): ApprovalRow[] {
  return [...requests]
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((request) => {
      const derived: DerivedStatus = deriveStatus(request, decisions, nowSeconds);
      const wrongChain = request.operation.chainId !== ctx.connectedChainId;
      let blocked: string | undefined;
      if (derived.status === 'ui_approved' || derived.status === 'ui_rejected') {
        blocked = 'A decision is already recorded in this browser.';
      } else if (derived.status === 'expired') {
        blocked = 'This request has expired.';
      }
      return {
        request,
        description: describeOperation(request, ctx),
        status: derived.status,
        changedSinceDecision: derived.changedSinceDecision,
        approveBlockedReason:
          blocked ??
          (wrongChain
            ? `Request is for chain ID ${request.operation.chainId}; the wallet is on ${ctx.connectedChainId}.`
            : undefined),
        rejectBlockedReason: blocked,
      };
    });
}

export function countByFilter(rows: readonly ApprovalRow[]): Record<QueueFilter, number> {
  const counts: Record<QueueFilter, number> = { pending: 0, decided: 0, expired: 0 };
  for (const row of rows) counts[filterOf(row.status)] += 1;
  return counts;
}
