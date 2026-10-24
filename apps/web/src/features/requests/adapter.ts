import type { ApprovalRequest, ApprovalRequestSource, ApprovalScope } from '../approvals/types';
import type { RequestRecord, RequestStore } from './types';

/** Maps a workflow record onto the shape the Module 7A review UI displays. */
export function toApprovalRequest(record: RequestRecord): ApprovalRequest {
  const { request } = record;
  return {
    id: request.requestId,
    operation: request.operation,
    purpose: request.purpose,
    reason: request.reason,
    createdAt: request.createdAt,
    ...(request.tokenMeta ? { tokenMeta: request.tokenMeta } : {}),
  };
}

/**
 * A 7A request source backed by the workflow store. Only active (pending or approved) requests are
 * listed. The 7A display guard still checks each item before it is shown. Not wired into the
 * Approvals page yet: no agent produces requests until Module 8.
 */
export function createWorkflowSource(options: {
  label: string;
  read: (scope: ApprovalScope) => RequestStore;
}): ApprovalRequestSource {
  return {
    kind: 'workflow',
    label: options.label,
    list: (scope) =>
      Promise.resolve(
        Object.values(options.read(scope))
          .filter((record) => record.status === 'pending' || record.status === 'approved')
          .map(toApprovalRequest),
      ),
  };
}
