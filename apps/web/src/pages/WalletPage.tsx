import { PageHeader } from '../components/layout/PageHeader';
import { Button, Card, EmptyState, Notice, StatusLabel } from '../components/ui';
import {
  EntryPointCard,
  OwnerBalanceItem,
  SmartAccountCard,
} from '../features/smart-account/SmartAccountSections';
import { useSmartAccountOverview } from '../features/smart-account/useSmartAccountOverview';
import { chainDisplayName } from '../features/wallet/chains';
import { useWallet } from '../features/wallet/useWallet';

/**
 * Wallet overview. Shows the connected owner EOA and network exactly as reported by MetaMask,
 * and, read from the selected chain, the owner balance, the configured smart account's
 * deployment state and balances, and EntryPoint presence. Every chain-derived value is labeled
 * with its network and chain ID; failed reads show as unavailable, never as a guess.
 */
export function WalletPage() {
  const wallet = useWallet();
  const { state } = wallet;
  const overview = useSmartAccountOverview(state);

  return (
    <>
      <PageHeader
        title="Wallet"
        description="Owner EOA and ERC-4337 smart account, shown separately."
        actions={<StatusLabel tone="outline">Read-only: Module 3</StatusLabel>}
      />

      <div className="space-y-6">
        <Card
          title="Owner account (EOA)"
          description="Your MetaMask account. It owns the smart account and holds owner authority."
        >
          {state.kind === 'connected-supported' || state.kind === 'connected-unsupported' ? (
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-gray-600">Address</dt>
                <dd className="mt-1 break-all font-mono text-black">{state.address}</dd>
              </div>
              <div>
                <dt className="text-gray-600">Network</dt>
                <dd className="mt-1 text-black">{chainDisplayName(state.chainId)}</dd>
              </div>
              <div>
                <dt className="text-gray-600">Chain ID</dt>
                <dd className="mt-1 font-mono text-black">{state.chainId ?? 'Unknown'}</dd>
              </div>
              <OwnerBalanceItem query={overview} />
            </dl>
          ) : (
            <EmptyState
              title={
                state.kind === 'no-provider'
                  ? 'MetaMask not detected'
                  : state.kind === 'connecting'
                    ? 'Connecting…'
                    : 'No wallet connected'
              }
              description={
                state.kind === 'no-provider'
                  ? 'Install or enable the MetaMask browser extension, then reload this page.'
                  : 'Connect MetaMask to see your owner account. Connecting only shares your public address.'
              }
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

          {state.kind === 'connected-unsupported' ? (
            <Notice tone="warning" title="Unsupported network" className="mt-4">
              The application supports Sepolia and a local Anvil chain only. Switch networks before
              using any feature.
            </Notice>
          ) : null}
        </Card>

        <SmartAccountCard query={overview} />

        <EntryPointCard query={overview} />

        <Notice title="What connecting does">
          Connecting shares your public address and chain ID with this page. It does not request
          signatures, send transactions or access keys. The application never asks for a seed phrase
          or private key. Balances and account state are read-only chain queries.
        </Notice>
      </div>
    </>
  );
}
