import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button, EmptyState, Notice, Spinner, StatusLabel, useToast } from '../components/ui';
import { useAgents } from '../features/agents/useAgents';
import { PolicyWorkspace } from '../features/policies/PolicyWorkspace';
import { usePolicies } from '../features/policies/usePolicies';
import { chainDisplayName } from '../features/wallet/chains';
import { shortAddress } from '../features/wallet/state';
import { useWallet } from '../features/wallet/useWallet';

/**
 * Spending policies (Module 5). Policies are drafts kept in this browser and are NOT enforced
 * on-chain. The page says so, and the on-chain submit control stays disabled with a reason.
 */
export function PoliciesPage() {
  const wallet = useWallet();
  const { state } = wallet;
  const registry = useAgents(state);
  const drafts = usePolicies(state);
  const { notify } = useToast();

  return (
    <>
      <PageHeader
        title="Policies"
        description="Configure limits and allowlists for each agent."
        actions={<StatusLabel tone="dashed">Drafts only: not enforced on-chain</StatusLabel>}
      />

      <div className="space-y-6">
        <Notice tone="warning" title="Drafts are not enforced">
          Module 5 delivers policy configuration and a rules preview in this application only.
          Nothing here is submitted to or held by the smart account, so a saved policy does not
          limit what any agent key can do on-chain. A form edit alone never means a policy is
          enforced.
        </Notice>

        {state.kind === 'connected-supported' ? (
          registry.agents && drafts.policies ? (
            registry.agents.length > 0 ? (
              <>
                <p className="text-sm text-gray-600">
                  Owner{' '}
                  <span className="font-mono text-black" title={state.address}>
                    {shortAddress(state.address)}
                  </span>{' '}
                  on {chainDisplayName(state.chainId)} (chain ID {state.chainId}).
                </p>
                <PolicyWorkspace
                  agents={registry.agents}
                  policies={drafts.policies}
                  nowSeconds={registry.nowSeconds}
                  dropped={drafts.dropped}
                  corrupt={drafts.corrupt}
                  onSave={drafts.saveDraft}
                  onNotify={notify}
                />
              </>
            ) : (
              <EmptyState
                title="No agents to configure"
                description="Register an agent first. Each policy belongs to one agent."
                action={
                  <Link to="/agents" className="underline">
                    Go to Agents
                  </Link>
                }
              />
            )
          ) : (
            <Spinner label="Loading policies" />
          )
        ) : state.kind === 'connected-unsupported' ? (
          <EmptyState
            title="Unsupported network"
            description="Switch to Sepolia or a local Anvil chain to configure policies."
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
            description="Policies are kept per owner account and network. Connect MetaMask to configure them."
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
