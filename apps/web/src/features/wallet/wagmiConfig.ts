import { foundry, sepolia } from 'viem/chains';
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { SUPPORTED_CHAINS } from './chains';

/**
 * wagmi configuration for MetaMask only.
 *
 * - Only the injected MetaMask connector is registered. EIP-6963 discovery is disabled so
 *   the set of wallets is deterministic.
 * - The app never requests or stores seed phrases or private keys. wagmi persists only the
 *   id of the last connector so it can reconnect after a reload.
 * - No signing or sending happens in this module.
 */
export function createWagmiConfig() {
  return createConfig({
    chains: SUPPORTED_CHAINS,
    connectors: [injected({ target: 'metaMask' })],
    transports: {
      [sepolia.id]: http(),
      [foundry.id]: http(),
    },
    multiInjectedProviderDiscovery: false,
  });
}

export type AppWagmiConfig = ReturnType<typeof createWagmiConfig>;
