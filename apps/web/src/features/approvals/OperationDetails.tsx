import type { ReactNode } from 'react';
import { Notice, StatusLabel } from '../../components/ui';
import { chainDisplayName } from '../wallet/chains';
import { describeExpiry } from './format';
import type { ApprovalRow } from './rows';
import { STATUS_LABEL } from './rows';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-gray-200 py-2 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-gray-600">{label}</dt>
      <dd className="min-w-0 break-words text-black">{children}</dd>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="break-all font-mono text-xs">{children}</span>;
}

export function statusTone(status: ApprovalRow['status']) {
  return status === 'pending' ? 'outline' : status === 'expired' ? 'dashed' : 'solid';
}

export interface OperationDetailsProps {
  row: ApprovalRow;
  nowSeconds: number;
}

/**
 * Every field of the exact operation under review. Addresses and calldata are shown in full:
 * nothing is shortened, rounded or inferred.
 */
export function OperationDetails({ row, nowSeconds }: OperationDetailsProps) {
  const { request, description: d } = row;
  const op = request.operation;
  const expiry = describeExpiry(op.expiresAt, nowSeconds);

  return (
    <div>
      {d.warnings.length > 0 ? (
        <Notice tone="warning" title="Review notes" className="mb-3">
          <ul className="list-disc space-y-1 pl-5">
            {d.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {row.changedSinceDecision ? (
        <Notice tone="warning" title="Changed since your earlier decision" className="mb-3">
          This request no longer matches the payload you decided on, so that decision does not
          apply. It needs a fresh review.
        </Notice>
      ) : null}
      <dl className="text-sm">
        <Field label="Request ID">
          <Mono>{request.id}</Mono>
        </Field>
        <Field label="Status">
          <StatusLabel tone={statusTone(row.status)}>{STATUS_LABEL[row.status]}</StatusLabel>
        </Field>
        <Field label="Action">
          {d.title} {d.decoded ? null : <StatusLabel tone="dashed">Not decoded</StatusLabel>}
        </Field>
        {d.recipient ? (
          <Field label={d.kind === 'erc20_approve' ? 'Spender' : 'Recipient'}>
            <Mono>{d.recipient}</Mono>
          </Field>
        ) : null}
        {d.token ? (
          <Field label="Token contract">
            <Mono>{d.token}</Mono>
          </Field>
        ) : null}
        {d.amountBaseUnits !== undefined ? (
          <Field label="Amount">
            {d.amountDisplay ? <p className="font-medium">{d.amountDisplay}</p> : null}
            <p>
              Exact base units: <Mono>{d.amountBaseUnits}</Mono>
            </p>
            {d.amountNote ? <p className="mt-1 text-xs text-gray-600">{d.amountNote}</p> : null}
          </Field>
        ) : null}
        <Field label="Native value">
          {d.nativeValueDisplay} (<Mono>{d.nativeValueWei}</Mono> wei)
        </Field>
        <Field label="Network">
          {chainDisplayName(op.chainId)}, chain ID {op.chainId}
        </Field>
        <Field label="Smart account">
          <Mono>{op.account}</Mono>
        </Field>
        <Field label="Agent signer">
          <Mono>{op.agent}</Mono>
        </Field>
        <Field label="Target">
          <Mono>{op.target}</Mono>
        </Field>
        <Field label="Function">
          {d.functionName ? (
            <>
              {d.functionName} (<Mono>{d.selector}</Mono>)
            </>
          ) : d.selector ? (
            <>
              Unknown selector <Mono>{d.selector}</Mono>
            </>
          ) : (
            'None (plain value transfer)'
          )}
        </Field>
        <Field label="Calldata">
          <p>{d.calldataBytes} bytes</p>
          <textarea
            readOnly
            aria-label="Raw calldata"
            rows={3}
            value={op.data}
            className="mt-1 w-full resize-y rounded border border-gray-200 bg-gray-50 p-2 font-mono text-xs"
          />
        </Field>
        <Field label="Nonce">
          <Mono>{op.nonce}</Mono>
        </Field>
        <Field label="Expires">{expiry.text}</Field>
        <Field label="Purpose (from agent)">{request.purpose || 'Not provided'}</Field>
        <Field label="Reason for review">{request.reason || 'Not provided'}</Field>
      </dl>
    </div>
  );
}

/** Compact restatement of the operation, shown inside the confirmation dialog. */
export function OperationSummary({ row }: { row: ApprovalRow }) {
  const { request, description: d } = row;
  const op = request.operation;
  return (
    <dl className="text-sm">
      <Field label="Request ID">
        <Mono>{request.id}</Mono>
      </Field>
      <Field label="Action">{d.title}</Field>
      {d.recipient ? (
        <Field label={d.kind === 'erc20_approve' ? 'Spender' : 'Recipient'}>
          <Mono>{d.recipient}</Mono>
        </Field>
      ) : (
        <Field label="Target">
          <Mono>{op.target}</Mono>
        </Field>
      )}
      {d.token ? (
        <Field label="Token contract">
          <Mono>{d.token}</Mono>
        </Field>
      ) : null}
      {d.amountBaseUnits !== undefined ? (
        <Field label="Exact base units">
          <Mono>{d.amountBaseUnits}</Mono>
          {d.amountDisplay ? ` (${d.amountDisplay})` : null}
        </Field>
      ) : null}
      <Field label="Network">
        {chainDisplayName(op.chainId)}, chain ID {op.chainId}
      </Field>
    </dl>
  );
}
