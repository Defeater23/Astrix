import { PageHeader } from '../components/layout/PageHeader';
import { Button, EmptyState, Notice, Spinner, StatusLabel, useToast } from '../components/ui';
import { AgentRegistry } from '../features/agents/AgentRegistry';
import { useAgents } from '../features/agents/useAgents';
import { chainDisplayName } from '../features/wallet/chains';
import { shortAddress } from '../features/wallet/state';
import { useWallet } from '../features/wallet/useWallet';

/**
 * Agent registration and management (Module 4). Records are local to this browser and are NOT
 * enforced on-chain: the page says so wherever status is shown.
 */
export function AgentsPage() {
  const wallet = useWallet();
  const { state } = wallet;
  const registry = useAgents(state);
  const { notify } = useToast();

  return (
    <>
      <PageHeader
        title="Agents"
        description="Register agents and manage their lifecycle."
        actions={<StatusLabel tone="dashed">Local registry: not enforced on-chain</StatusLabel>}
      />

      <div className="space-y-6">
        <Notice tone="warning" title="Not enforced on-chain">
          Module 4 delivers registration and lifecycle management in this application only. Agent
          records are stored in this browser and nothing is written to the smart account. Pausing,
          revoking or letting an agent expire here does not remove any on-chain authority from its
          signer. Enforcement in the smart-account layer is not built yet.
        </Notice>

        {state.kind === 'connected-supported' ? (
          registry.agents ? (
            <>
              <p className="text-sm text-gray-600">
                Owner{' '}
                <span className="font-mono text-black" title={state.address}>
                  {shortAddress(state.address)}
                </span>{' '}
                on {chainDisplayName(state.chainId)} (chain ID {state.chainId}).
              </p>
              <AgentRegistry
                agents={registry.agents}
                nowSeconds={registry.nowSeconds}
                dropped={registry.dropped}
                corrupt={registry.corrupt}
                onRegister={registry.register}
                onTransition={registry.transition}
                onNotify={notify}
              />
            </>
          ) : (
            <Spinner label="Loading agents" />
          )
        ) : state.kind === 'connected-unsupported' ? (
          <EmptyState
            title="Unsupported network"
            description="Switch to Sepolia or a local Anvil chain to manage agents."
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
            description="Agents are listed per owner account and network. Connect MetaMask to see or register agents."
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
