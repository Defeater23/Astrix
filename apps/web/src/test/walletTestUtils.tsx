import type { ReactNode } from 'react';
import { useState } from 'react';
import { foundry, sepolia } from 'viem/chains';
import type { Address } from 'viem';
import { createConfig, http } from 'wagmi';
import { mock } from 'wagmi/connectors';
import { WalletProvider } from '../features/wallet/WalletProvider';

export const TEST_ACCOUNT: Address = '0x1234567890abcdef1234567890abcdef12345678';

interface TestConfigOptions {
  /** Make connect() fail with this error (simulates a rejected MetaMask prompt). */
  connectError?: Error;
  /** Chain order matters: the mock wallet starts on the first chain. */
  chains?: 'sepolia-first' | 'anvil-first';
}

/** wagmi config with a mock wallet. Storage is disabled so tests never auto-reconnect. */
export function createTestWagmiConfig({
  connectError,
  chains = 'sepolia-first',
}: TestConfigOptions = {}) {
  const connector = mock({
    accounts: [TEST_ACCOUNT],
    features: connectError ? { connectError } : {},
  });
  const transports = { [sepolia.id]: http(), [foundry.id]: http() };

  return chains === 'sepolia-first'
    ? createConfig({
        chains: [sepolia, foundry],
        connectors: [connector],
        transports,
        storage: null,
      })
    : createConfig({
        chains: [foundry, sepolia],
        connectors: [connector],
        transports,
        storage: null,
      });
}

export function TestWalletProvider({
  children,
  hasProvider = true,
  ...options
}: TestConfigOptions & { children: ReactNode; hasProvider?: boolean }) {
  const [config] = useState(() => createTestWagmiConfig(options));
  return (
    <WalletProvider config={config} hasProvider={() => hasProvider} reconnectOnMount={false}>
      {children}
    </WalletProvider>
  );
}
