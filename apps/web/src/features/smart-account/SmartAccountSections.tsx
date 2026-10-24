import type { ReactNode } from 'react';
import { Button, Card, EmptyState, Notice, Spinner, StatusLabel } from '../../components/ui';
import { chainDisplayName } from '../wallet/chains';
import {
  DEPLOYMENT_DETAILS,
  DEPLOYMENT_LABELS,
  deriveDeployment,
  deriveInitialization,
  hasContractCode,
} from './accountState';
import { ENTRYPOINT_V07_ADDRESS, ENTRYPOINT_VERSION } from './entryPoint';
import { nativeSymbol, renderBalance } from './format';
import type { OverviewQuery } from './useSmartAccountOverview';
import { SMART_ACCOUNT_ENV_KEYS } from './smartAccountConfig';

/**
 * Presentational sections of the Wallet page. They render only what the query result contains
 * and label the network and chain ID next to every chain-derived value.
 */

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-gray-600">{label}</dt>
      <dd className="mt-1 text-black">{children}</dd>
    </div>
  );
}

/** Owner EOA native balance, shown inside the owner card's definition list. */
export function OwnerBalanceItem({ query }: { query: OverviewQuery }) {
  if (query.status === 'loading') {
    return (
      <Detail label="Native balance">
        <Spinner label="Reading balance" />
      </Detail>
    );
  }
  if (query.status === 'success' && query.data) {
    const { chainId } = query.data;
    const rendered = renderBalance(query.data.ownerBalance, chainId);
    return (
      <Detail label={`Native balance (${chainDisplayName(chainId)}, chain ID ${chainId})`}>
        <span className="font-mono">{rendered.text}</span>
      </Detail>
    );
  }
  return (
    <Detail label="Native balance">
      <span className="font-mono">Unavailable</span>
    </Detail>
  );
}

function RefreshFooter({ query }: { query: OverviewQuery }) {
  const chainId = query.data?.chainId;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4 text-xs text-gray-600">
      <p>
        {chainId !== undefined
          ? `Read from ${chainDisplayName(chainId)} (chain ID ${chainId}) via the connected wallet's RPC`
          : 'Read via the connected wallet'}
        {query.updatedAt !== undefined ? ` at ${new Date(query.updatedAt).toLocaleString()}.` : '.'}{' '}
        Values are not refreshed automatically.
      </p>
      <Button size="sm" variant="secondary" loading={query.isFetching} onClick={query.refetch}>
        Refresh
      </Button>
    </div>
  );
}

export function SmartAccountCard({ query }: { query: OverviewQuery }) {
  return (
    <Card
      title="Smart account (ERC-4337)"
      description="A separate contract address from the owner EOA."
    >
      {query.status === 'disabled' ? (
        <>
          <p className="text-xl font-semibold text-black">Unavailable</p>
          <p className="mt-2 text-sm text-gray-600">
            Connect MetaMask on Sepolia or local Anvil to read the smart account. No state or
            balance is shown without a chain read.
          </p>
        </>
      ) : null}

      {query.status === 'loading' ? <Spinner label="Reading smart account" /> : null}

      {query.status === 'error' ? (
        <Notice tone="error" title="Could not read chain data">
          {query.errorMessage ?? 'Unknown error.'}
        </Notice>
      ) : null}

      {query.status === 'success' && query.data ? <SmartAccountDetails query={query} /> : null}
    </Card>
  );
}

function SmartAccountDetails({ query }: { query: OverviewQuery }) {
  const data = query.data;
  if (!data) return null;
  const { chainId, account } = data;
  const envKey = SMART_ACCOUNT_ENV_KEYS[chainId] ?? 'VITE_SMART_ACCOUNT_ADDRESS_*';

  if (!account) {
    return (
      <>
        <EmptyState
          title="No smart account configured for this network"
          description={`Set ${envKey} in apps/web/.env.local to the address of your smart account on ${chainDisplayName(chainId)} (chain ID ${chainId}), then reload. See docs/SMART_ACCOUNT.md.`}
        />
        <div className="mt-4">
          <StatusLabel tone="dashed">{DEPLOYMENT_LABELS['not-configured']}</StatusLabel>
        </div>
        <RefreshFooter query={query} />
      </>
    );
  }

  const code = data.accountCode?.ok ? data.accountCode.value : undefined;
  const deployment = deriveDeployment(true, code);
  const initialization = deriveInitialization(deployment);
  const balance = renderBalance(data.accountBalance, chainId);
  const deposit = renderBalance(data.entryPointDeposit, chainId);

  return (
    <>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-gray-600">Smart-account address</dt>
          <dd className="mt-1 break-all font-mono text-black">{account}</dd>
          <dd className="mt-1 text-xs text-gray-600">
            Source: environment configuration. It is not derived from an account factory in this
            module.
          </dd>
        </div>
        <Detail label="Network">
          {chainDisplayName(chainId)}, chain ID {chainId}
        </Detail>
        <Detail label="Deployment state">
          <StatusLabel tone={deployment === 'deployed' ? 'solid' : 'outline'}>
            {DEPLOYMENT_LABELS[deployment]}
          </StatusLabel>
          <span className="mt-1 block text-xs text-gray-600">{DEPLOYMENT_DETAILS[deployment]}</span>
          {data.accountCode && !data.accountCode.ok ? (
            <span className="mt-1 block text-xs text-gray-600">
              Read error: {data.accountCode.error}
            </span>
          ) : null}
        </Detail>
        <Detail label="Initialization">
          {initialization.label}
          <span className="mt-1 block text-xs text-gray-600">{initialization.reason}</span>
        </Detail>
        <Detail label={`Native balance (${nativeSymbol(chainId)})`}>
          <span className="font-mono">{balance.text}</span>
        </Detail>
        <Detail label="EntryPoint deposit">
          <span className="font-mono">{deposit.text}</span>
        </Detail>
      </dl>
      <RefreshFooter query={query} />
    </>
  );
}

export function EntryPointCard({ query }: { query: OverviewQuery }) {
  const data = query.status === 'success' ? query.data : undefined;
  let presence = 'Unavailable until a wallet is connected on a supported network.';
  let present: boolean | undefined;
  if (data) {
    if (data.entryPointCode.ok) {
      present = hasContractCode(data.entryPointCode.value);
      presence = present
        ? 'Contract code found at this address. The bytecode has not been compared with the canonical release.'
        : 'No contract found at this address on this network.';
    } else {
      presence = `Unavailable: ${data.entryPointCode.error}`;
    }
  }

  return (
    <Card
      title={`EntryPoint v${ENTRYPOINT_VERSION}`}
      description="The singleton contract that processes UserOperations for ERC-4337 accounts."
    >
      <dl className="grid gap-4 text-sm">
        <div>
          <dt className="text-gray-600">Address</dt>
          <dd className="mt-1 break-all font-mono text-black">{ENTRYPOINT_V07_ADDRESS}</dd>
        </div>
        <Detail label="On this network">{presence}</Detail>
      </dl>
      {present === false && data?.chainId === 31337 ? (
        <Notice tone="warning" title="Local Anvil has no EntryPoint by default" className="mt-4">
          A fresh Anvil chain does not include EntryPoint v0.7. Deploy it to the canonical address
          before using a smart account locally. See docs/SMART_ACCOUNT.md.
        </Notice>
      ) : null}
    </Card>
  );
}
