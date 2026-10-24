import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WalletStatusViewProps } from './WalletStatusView';
import { WalletStatusView } from './WalletStatusView';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

function setup(overrides: Partial<WalletStatusViewProps> = {}) {
  const props: WalletStatusViewProps = {
    state: { kind: 'disconnected' },
    error: undefined,
    isSwitching: false,
    defaultChainId: 11155111,
    defaultChainName: 'Sepolia',
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onSwitch: vi.fn(),
    onDismissError: vi.fn(),
    ...overrides,
  };
  render(<WalletStatusView {...props} />);
  return props;
}

describe('WalletStatusView', () => {
  it('shows a disconnected wallet and calls onConnect', async () => {
    const props = setup();
    expect(screen.getByText('Wallet: not connected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
    expect(props.onConnect).toHaveBeenCalledTimes(1);
  });

  it('disables connect with a reason when no provider is present', () => {
    setup({ state: { kind: 'no-provider' } });
    expect(screen.getByRole('button', { name: /Connect wallet/ })).toBeDisabled();
  });

  it('shows a connecting state without a usable connect button', () => {
    setup({ state: { kind: 'connecting' } });
    expect(screen.getByText('Wallet: connecting…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connecting/ })).toBeDisabled();
  });

  it('shows address and chain for a supported default network, with no switch button', async () => {
    const props = setup({
      state: {
        kind: 'connected-supported',
        address: ADDRESS,
        chainId: 11155111,
        isDefaultChain: true,
      },
    });
    expect(screen.getByText('0x1234…5678')).toBeInTheDocument();
    expect(screen.getByText('Sepolia, chain ID 11155111')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch to/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(props.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('offers a switch to the default chain from a supported non-default network', async () => {
    const props = setup({
      state: {
        kind: 'connected-supported',
        address: ADDRESS,
        chainId: 31337,
        isDefaultChain: false,
      },
    });
    expect(screen.getByText('Local Anvil, chain ID 31337')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Sepolia' }));
    expect(props.onSwitch).toHaveBeenCalledTimes(1);
  });

  it('flags an unsupported network and offers a switch', async () => {
    const props = setup({
      state: { kind: 'connected-unsupported', address: ADDRESS, chainId: 1 },
    });
    expect(screen.getByText('Unsupported network, chain ID 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Sepolia' }));
    expect(props.onSwitch).toHaveBeenCalledTimes(1);
  });

  it('shows a dismissible error alert', async () => {
    const props = setup({ error: { kind: 'user-rejected', message: 'The request was rejected.' } });
    expect(screen.getByRole('alert')).toHaveTextContent('The request was rejected.');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismissError).toHaveBeenCalledTimes(1);
  });
});
