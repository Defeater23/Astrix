import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserRejectedRequestError } from 'viem';
import { describe, expect, it } from 'vitest';
import { TestWalletProvider } from '../../test/walletTestUtils';
import { WalletStatus } from './WalletStatus';

/**
 * Integration tests against wagmi's mock connector. They exercise the real wagmi state
 * machine and our hook, but NOT a real MetaMask extension. MetaMask itself is verified
 * manually (see README, "Manual MetaMask checklist").
 */

describe('wallet integration (wagmi mock connector)', () => {
  it('connects and shows the account and chain reported by the wallet', async () => {
    render(
      <TestWalletProvider>
        <WalletStatus />
      </TestWalletProvider>,
    );
    expect(screen.getByText('Wallet: not connected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));

    expect(await screen.findByText('Wallet: connected')).toBeInTheDocument();
    expect(screen.getByText(/0x1234…5678/i)).toBeInTheDocument();
    expect(screen.getByText('Sepolia, chain ID 11155111')).toBeInTheDocument();
  });

  it('disconnects and returns to the not-connected state', async () => {
    render(
      <TestWalletProvider>
        <WalletStatus />
      </TestWalletProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    expect(await screen.findByText('Wallet: not connected')).toBeInTheDocument();
    expect(screen.queryByText(/0x1234/i)).not.toBeInTheDocument();
  });

  it('shows a rejection message and stays disconnected when the user rejects', async () => {
    render(
      <TestWalletProvider
        connectError={new UserRejectedRequestError(new Error('User rejected the request.'))}
      >
        <WalletStatus />
      </TestWalletProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/rejected/i);
    expect(screen.getByText('Wallet: not connected')).toBeInTheDocument();
  });

  it('offers to switch to Sepolia from the local chain and then reports Sepolia', async () => {
    render(
      <TestWalletProvider chains="anvil-first">
        <WalletStatus />
      </TestWalletProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
    expect(await screen.findByText('Local Anvil, chain ID 31337')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Switch to Sepolia' }));

    expect(await screen.findByText('Sepolia, chain ID 11155111')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to Sepolia' })).not.toBeInTheDocument();
  });
});
