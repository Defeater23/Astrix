import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createContext, useContext, useMemo, useState } from 'react';
import type { Config } from 'wagmi';
import { WagmiProvider } from 'wagmi';
import { hasInjectedProvider } from './state';
import { createWagmiConfig } from './wagmiConfig';

interface WalletEnvironment {
  /** Returns whether an injected provider is available right now. */
  hasProvider: () => boolean;
}

const WalletEnvironmentContext = createContext<WalletEnvironment>({
  hasProvider: hasInjectedProvider,
});

export function useWalletEnvironment(): WalletEnvironment {
  return useContext(WalletEnvironmentContext);
}

export interface WalletProviderProps {
  children: ReactNode;
  config?: Config;
  hasProvider?: () => boolean;
  reconnectOnMount?: boolean;
}

export function WalletProvider({
  children,
  config,
  hasProvider,
  reconnectOnMount = true,
}: WalletProviderProps) {
  const [queryClient] = useState(() => new QueryClient());
  const [defaultConfig] = useState(() => (config ? undefined : createWagmiConfig()));
  const activeConfig = config ?? defaultConfig;

  const environment = useMemo<WalletEnvironment>(
    () => ({ hasProvider: hasProvider ?? hasInjectedProvider }),
    [hasProvider],
  );

  if (!activeConfig) throw new Error('Wallet configuration is missing.');

  return (
    <WagmiProvider config={activeConfig} reconnectOnMount={reconnectOnMount}>
      <QueryClientProvider client={queryClient}>
        <WalletEnvironmentContext.Provider value={environment}>
          {children}
        </WalletEnvironmentContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
