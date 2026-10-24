import { render, screen } from '@testing-library/react';
import type { Address } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { EntryPointCard, OwnerBalanceItem, SmartAccountCard } from './SmartAccountSections';
import type { SmartAccountOverview } from './overview';
import type { OverviewQuery } from './useSmartAccountOverview';

const OWNER = '0x1234567890abcdef1234567890abcdef12345678' as Address;
const ACCOUNT = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address;
const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address;

function overview(overrides: Partial<SmartAccountOverview> = {}): SmartAccountOverview {
  return {
    chainId: 11155111,
    owner: OWNER,
    account: ACCOUNT,
    entryPoint: ENTRY_POINT,
    ownerBalance: { ok: true, value: 1_000_000_000_000_000_000n },
    entryPointCode: { ok: true, value: '0x6080' },
    accountCode: { ok: true, value: '0x' },
    accountBalance: { ok: true, value: 250_000_000_000_000_000n },
    entryPointDeposit: { ok: true, value: 0n },
    ...overrides,
  };
}

function query(overrides: Partial<OverviewQuery> = {}): OverviewQuery {
  return {
    status: 'success',
    data: overview(),
    errorMessage: undefined,
    isFetching: false,
    updatedAt: Date.UTC(2026, 9, 24, 12, 0, 0),
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('SmartAccountCard', () => {
  it('is unavailable and shows no values when disabled', () => {
    render(<SmartAccountCard query={query({ status: 'disabled', data: undefined })} />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/ETH/)).not.toBeInTheDocument();
  });

  it('shows a loading state', () => {
    render(<SmartAccountCard query={query({ status: 'loading', data: undefined })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading smart account');
  });

  it('shows an error state with the message', () => {
    render(
      <SmartAccountCard
        query={query({ status: 'error', data: undefined, errorMessage: 'bad rpc' })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('bad rpc');
  });

  it('shows the not-configured state with the environment variable to set', () => {
    render(<SmartAccountCard query={query({ data: overview({ account: undefined }) })} />);
    expect(screen.getByText('No smart account configured for this network')).toBeInTheDocument();
    expect(screen.getByText(/VITE_SMART_ACCOUNT_ADDRESS_SEPOLIA/)).toBeInTheDocument();
  });

  it('shows a counterfactual account, separate network label and exact balances', () => {
    render(<SmartAccountCard query={query()} />);
    expect(screen.getByText(ACCOUNT)).toBeInTheDocument();
    expect(screen.getByText('Sepolia, chain ID 11155111')).toBeInTheDocument();
    expect(screen.getByText('Counterfactual (not deployed)')).toBeInTheDocument();
    expect(screen.getByText('Not applicable')).toBeInTheDocument();
    expect(screen.getByText('0.25 ETH')).toBeInTheDocument();
    expect(screen.getByText('0 ETH')).toBeInTheDocument();
  });

  it('shows a deployed account without claiming it is initialized', () => {
    render(
      <SmartAccountCard
        query={query({ data: overview({ accountCode: { ok: true, value: '0x6080604052' } }) })}
      />,
    );
    expect(screen.getByText('Deployed (code present)')).toBeInTheDocument();
    expect(screen.getByText('Not determined')).toBeInTheDocument();
    expect(screen.queryByText(/^Initialized$/)).not.toBeInTheDocument();
  });

  it('shows unknown deployment and the error when the code read failed', () => {
    render(
      <SmartAccountCard
        query={query({
          data: overview({
            accountCode: { ok: false, error: 'timeout' },
            accountBalance: { ok: false, error: 'timeout' },
          }),
        })}
      />,
    );
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText(/Read error: timeout/)).toBeInTheDocument();
    expect(screen.getByText('Unavailable: timeout')).toBeInTheDocument();
  });

  it('labels the account address as configuration, not derived', () => {
    render(<SmartAccountCard query={query()} />);
    expect(screen.getByText(/Source: environment configuration/)).toBeInTheDocument();
  });
});

describe('OwnerBalanceItem', () => {
  it('shows the balance labeled with network and chain ID', () => {
    render(
      <dl>
        <OwnerBalanceItem query={query()} />
      </dl>,
    );
    expect(screen.getByText('Native balance (Sepolia, chain ID 11155111)')).toBeInTheDocument();
    expect(screen.getByText('1 ETH')).toBeInTheDocument();
  });

  it('shows the error rather than a number when the read failed', () => {
    render(
      <dl>
        <OwnerBalanceItem
          query={query({ data: overview({ ownerBalance: { ok: false, error: 'nope' } }) })}
        />
      </dl>,
    );
    expect(screen.getByText('Unavailable: nope')).toBeInTheDocument();
  });

  it('shows Unavailable when disabled', () => {
    render(
      <dl>
        <OwnerBalanceItem query={query({ status: 'disabled', data: undefined })} />
      </dl>,
    );
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });
});

describe('EntryPointCard', () => {
  it('shows the pinned address and version even when no chain read exists', () => {
    render(<EntryPointCard query={query({ status: 'disabled', data: undefined })} />);
    expect(screen.getByText('EntryPoint v0.7')).toBeInTheDocument();
    expect(screen.getByText(ENTRY_POINT)).toBeInTheDocument();
    expect(screen.getByText(/Unavailable until a wallet is connected/)).toBeInTheDocument();
  });

  it('says the bytecode was not verified when code is present', () => {
    render(<EntryPointCard query={query()} />);
    expect(
      screen.getByText(/has not been compared with the canonical release/),
    ).toBeInTheDocument();
  });

  it('reports a missing EntryPoint and warns on local Anvil', () => {
    render(
      <EntryPointCard
        query={query({
          data: overview({ chainId: 31337, entryPointCode: { ok: true, value: '0x' } }),
        })}
      />,
    );
    expect(
      screen.getByText('No contract found at this address on this network.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Local Anvil has no EntryPoint by default/)).toBeInTheDocument();
  });

  it('shows the read error when the code could not be read', () => {
    render(
      <EntryPointCard
        query={query({ data: overview({ entryPointCode: { ok: false, error: 'rpc down' } }) })}
      />,
    );
    expect(screen.getByText('Unavailable: rpc down')).toBeInTheDocument();
  });
});
