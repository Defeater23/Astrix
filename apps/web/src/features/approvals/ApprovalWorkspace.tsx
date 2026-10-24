import { useState } from 'react';
import { Button, ConfirmDialog, Dialog, EmptyState, Notice, StatusLabel, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { chainDisplayName } from '../wallet/chains';
import { describeExpiry } from './format';
import { OperationDetails, OperationSummary, statusTone } from './OperationDetails';
import type { ApprovalRow, QueueFilter } from './rows';
import { STATUS_LABEL, countByFilter, filterOf } from './rows';
import type { LocalDecision } from './types';

export interface ApprovalWorkspaceProps {
  rows: ApprovalRow[];
  nowSeconds: number;
  dropped: number;
  droppedDecisions: number;
  corruptDecisions: boolean;
  hasDecisions: boolean;
  /** Returns an error message, or undefined on success. */
  onDecide: (requestId: string, decision: LocalDecision) => string | undefined;
  onReset: () => string | undefined;
  onNotify: (title: string, description?: string) => void;
}

const FILTERS: Array<{ id: QueueFilter; label: string }> = [
  { id: 'pending', label: 'Pending' },
  { id: 'decided', label: 'Decided' },
  { id: 'expired', label: 'Expired' },
];

const EMPTY_MESSAGES: Record<QueueFilter, string> = {
  pending: 'No requests are waiting for review.',
  decided: 'No decisions recorded in this browser yet.',
  expired: 'No expired requests.',
};

/**
 * Queue, exact-operation review and Approve/Reject confirmation. A confirmed decision is stored
 * in this browser only. It is not a signature and does not authorize or submit anything.
 */
export function ApprovalWorkspace({
  rows,
  nowSeconds,
  dropped,
  droppedDecisions,
  corruptDecisions,
  hasDecisions,
  onDecide,
  onReset,
  onNotify,
}: ApprovalWorkspaceProps) {
  const [filter, setFilter] = useState<QueueFilter>('pending');
  const [reviewingId, setReviewingId] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<LocalDecision | undefined>(undefined);
  const [resetOpen, setResetOpen] = useState(false);

  const counts = countByFilter(rows);
  const visible = rows.filter((row) => filterOf(row.status) === filter);
  const reviewRow = reviewingId ? rows.find((row) => row.request.id === reviewingId) : undefined;

  function closeAll() {
    setConfirming(undefined);
    setReviewingId(undefined);
  }

  function confirm() {
    if (!reviewRow || !confirming) return;
    const decision = confirming;
    const message = onDecide(reviewRow.request.id, decision);
    if (message) {
      onNotify('Decision not recorded', message);
    } else if (decision === 'ui_approved') {
      onNotify('Approval recorded (UI only)', 'No signature was created and nothing was submitted.');
    } else {
      onNotify('Rejection recorded', 'Nothing was submitted.');
    }
    closeAll();
  }

  function confirmReset() {
    const message = onReset();
    onNotify(
      message ? 'Decisions not reset' : 'Local decisions cleared',
      message ?? 'Requests that are still valid are pending again.',
    );
    setResetOpen(false);
  }

  const columns: Array<TableColumn<ApprovalRow>> = [
    {
      key: 'request',
      header: 'Request',
      render: (row) => (
        <div className="max-w-[16rem]">
          <p className="font-mono text-xs">{row.request.id}</p>
          <p className="mt-0.5 text-gray-600">{row.request.purpose}</p>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Operation',
      render: (row) => (
        <div>
          <p className="font-medium">{row.description.title}</p>
          {row.description.amountDisplay ? <p>{row.description.amountDisplay}</p> : null}
          {row.description.amountBaseUnits !== undefined && !row.description.amountDisplay ? (
            <p className="font-mono text-xs">{row.description.amountBaseUnits} base units</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'network',
      header: 'Network',
      render: (row) => (
        <span>
          {chainDisplayName(row.request.operation.chainId)}
          <span className="block text-xs text-gray-600">
            chain ID {row.request.operation.chainId}
          </span>
        </span>
      ),
    },
    {
      key: 'expires',
      header: 'Expires',
      render: (row) => describeExpiry(row.request.operation.expiresAt, nowSeconds).text,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusLabel tone={statusTone(row.status)}>{STATUS_LABEL[row.status]}</StatusLabel>
      ),
    },
    {
      key: 'review',
      header: 'Review',
      render: (row) => (
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Review request ${row.request.id}`}
          onClick={() => setReviewingId(row.request.id)}
        >
          Review
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {dropped > 0 ? (
        <Notice tone="warning" title="Some requests were not shown">
          {dropped} request{dropped === 1 ? '' : 's'} had missing or malformed fields and{' '}
          {dropped === 1 ? 'was' : 'were'} hidden rather than displayed with guessed values.
        </Notice>
      ) : null}
      {corruptDecisions || droppedDecisions > 0 ? (
        <Notice tone="warning" title="Stored decisions were unreadable">
          Unreadable decision data in this browser was ignored. Affected requests are shown as
          not yet decided.
        </Notice>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No approval requests"
          description="There is nothing to review. Requests that need owner approval will appear here."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Filter requests" className="flex flex-wrap gap-2">
              {FILTERS.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={filter === item.id ? 'primary' : 'secondary'}
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label} ({counts[item.id]})
                </Button>
              ))}
            </div>
            {hasDecisions ? (
              <Button size="sm" variant="ghost" onClick={() => setResetOpen(true)}>
                Reset local decisions
              </Button>
            ) : null}
          </div>
          <Table
            caption="Approval requests"
            columns={columns}
            rows={visible}
            rowKey={(row) => row.request.id}
            emptyMessage={EMPTY_MESSAGES[filter]}
          />
        </>
      )}

      {reviewRow ? (
        <Dialog
          open={confirming === undefined}
          onClose={closeAll}
          size="lg"
          title="Review operation"
          description="Check every field. This is the exact operation the request describes."
          footer={
            <>
              <Button variant="secondary" onClick={closeAll}>
                Close
              </Button>
              <Button
                variant="danger"
                disabledReason={reviewRow.rejectBlockedReason}
                onClick={() => setConfirming('ui_rejected')}
              >
                Reject
              </Button>
              <Button
                disabledReason={reviewRow.approveBlockedReason}
                onClick={() => setConfirming('ui_approved')}
              >
                Approve
              </Button>
            </>
          }
        >
          <OperationDetails row={reviewRow} nowSeconds={nowSeconds} />
        </Dialog>
      ) : null}

      {reviewRow && confirming ? (
        <ConfirmDialog
          open
          tone={confirming === 'ui_rejected' ? 'danger' : 'default'}
          title={confirming === 'ui_approved' ? 'Record approval?' : 'Reject request?'}
          description={
            confirming === 'ui_approved'
              ? 'This records your decision for the exact operation below, in this browser only.'
              : 'This rejects the request below. Nothing will be submitted.'
          }
          confirmLabel={confirming === 'ui_approved' ? 'Record approval' : 'Reject request'}
          cancelLabel="Back to review"
          onConfirm={confirm}
          onCancel={() => setConfirming(undefined)}
        >
          <OperationSummary row={reviewRow} />
          {confirming === 'ui_approved' ? (
            <p className="mt-3 border-t border-gray-200 pt-3 text-gray-700">
              This is a local UI decision. It does not create a signature, does not authorize
              anything on-chain and does not submit a transaction. Cryptographic owner approval is
              delivered in a later stage.
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}

      <ConfirmDialog
        open={resetOpen}
        tone="danger"
        title="Reset local decisions?"
        description="This clears every approval and rejection recorded in this browser for this account and network. Requests that are still valid return to pending."
        confirmLabel="Reset decisions"
        onConfirm={confirmReset}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  );
}
