import { PageHeader } from '../components/layout/PageHeader';
import { Button, EmptyState, Notice, Spinner, StatusLabel, useToast } from '../components/ui';
import { ApprovalWorkspace } from '../features/approvals/ApprovalWorkspace';
import { demoApprovalSource } from '../features/approvals/demoData';
import { buildRows } from '../features/approvals/rows';
import type { ApprovalRequestSource } from '../features/approvals/types';
import { useApprovals } from '../features/approvals/useApprovals';
import { SUPPORTED_CHAINS, chainDisplayName } from '../features/wallet/chains';
import { shortAddress } from '../features/wallet/state';
import { useWallet } from '../features/wallet/useWallet';

export interface ApprovalsPageProps {
  /** Request source. Defaults to the labelled deterministic demo source; tests inject others. */
  source?: ApprovalRequestSource;
}

/**
 * Owner approval queue and exact-operation review (Module 7A). Decisions are recorded in this
 * browser only. They are not signatures and authorize nothing on-chain.
 */
export function ApprovalsPage({ source = demoApprovalSource }: ApprovalsPageProps) {
  const wallet = useWallet();
  const { state } = wallet;
  const approvals = useApprovals(state, source);
  const { notify } = useToast();

  const nativeSymbol =
    state.kind === 'connected-supported'
      ? (SUPPORTED_CHAINS.find((chain) => chain.id === state.chainId)?.nativeCurrency.symbol ??
        'ETH')
      : 'ETH';

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Review the exact operation before you approve or reject it."
        actions={<StatusLabel tone="dashed">Demo data: no cryptographic approval yet</StatusLabel>}
      />

      <div className="space-y-6">
        <Notice tone="warning" title="Demo data, UI decisions only">
          The requests below come from {source.label.toLowerCase()} built into this application.
          They are not agent output and nothing here is submitted. Approve and Reject record a
          decision in this browser only; neither creates a signature or authorizes execution. Only
          the smart account and on-chain policy decide what may execute, and owner signing is
          delivered in a later stage.
        </Notice>

        {state.kind === 'connected-supported' ? (
          approvals.loadStatus === 'error' ? (
            <Notice tone="error" title="Could not load approval requests">
              <p>{approvals.error}</p>
              <div className="mt-3">
                <Button size="sm" variant="secondary" onClick={approvals.reload}>
                  Try again
                </Button>
              </div>
            </Notice>
          ) : approvals.loadStatus === 'ready' ? (
            <>
              <p className="text-sm text-gray-600">
                Owner{' '}
                <span className="font-mono text-black" title={state.address}>
                  {shortAddress(state.address)}
                </span>{' '}
                on {chainDisplayName(state.chainId)} (chain ID {state.chainId}).
              </p>
              <ApprovalWorkspace
                rows={buildRows(approvals.requests, approvals.decisions, approvals.nowSeconds, {
                  connectedChainId: state.chainId,
                  nativeSymbol,
                })}
                nowSeconds={approvals.nowSeconds}
                dropped={approvals.dropped}
                droppedDecisions={approvals.droppedDecisions}
                corruptDecisions={approvals.corruptDecisions}
                hasDecisions={approvals.decisions.length > 0}
                onDecide={approvals.decide}
                onReset={approvals.resetDecisions}
                onNotify={notify}
              />
            </>
          ) : (
            <Spinner label="Loading approval requests" />
          )
        ) : state.kind === 'connected-unsupported' ? (
          <EmptyState
            title="Unsupported network"
            description="Switch to Sepolia or a local Anvil chain to review approval requests."
            action={<Button onClick={wallet.switchToDefaultChain}>Switch network</Button>}
          />
        ) : (
          <EmptyState
            title={
              state.kind === 'no-provider'
                ? 'MetaMask not detected'
                : state.kind === 'connecting'
                  ? 'Connecting…'
                  : 'No wallet connected'
            }
            description="Approval requests are shown per owner account and network. Connect MetaMask to review them."
            action={
              state.kind === 'disconnected' ? (
                <Button onClick={wallet.connect}>Connect wallet</Button>
              ) : state.kind === 'no-provider' ? (
                <Button disabledReason="MetaMask was not detected in this browser.">
                  Connect wallet
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </>
  );
}
