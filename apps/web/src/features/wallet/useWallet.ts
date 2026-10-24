import { useCallback, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { env } from '../../config/env';
import { chainDisplayName, resolveDefaultChain } from './chains';
import type { WalletErrorKind } from './errors';
import { classifyWalletError, describeWalletError } from './errors';
import type { WalletState } from './state';
import { deriveWalletState } from './state';
import { useWalletEnvironment } from './WalletProvider';

export interface WalletError {
  kind: WalletErrorKind;
  message: string;
}

export interface UseWallet {
  state: WalletState;
  error: WalletError | undefined;
  isSwitching: boolean;
  defaultChainId: number;
  defaultChainName: string;
  connect: () => void;
  disconnect: () => void;
  switchToDefaultChain: () => void;
  dismissError: () => void;
}

const defaultChain = resolveDefaultChain(env.defaultChainId);

/**
 * Wallet connection facade. State is derived from what wagmi/MetaMask report; account and
 * network changes made inside MetaMask flow through automatically because wagmi subscribes to
 * the provider's accountsChanged and chainChanged events.
 */
export function useWallet(): UseWallet {
  const { hasProvider } = useWalletEnvironment();
  const account = useAccount();
  const { connectors, connect, error: connectError, reset: resetConnect } = useConnect();
  const { disconnect } = useDisconnect();
  const {
    switchChain,
    isPending: isSwitching,
    error: switchError,
    reset: resetSwitch,
  } = useSwitchChain();
  const [localError, setLocalError] = useState<WalletError | undefined>(undefined);

  const state = deriveWalletState({
    hasProvider: hasProvider(),
    status: account.status,
    address: account.address,
    chainId: account.chainId,
    defaultChainId: defaultChain.id,
  });

  const rawError = connectError ?? switchError;
  const error: WalletError | undefined =
    localError ??
    (rawError
      ? (() => {
          const kind = classifyWalletError(rawError);
          return { kind, message: describeWalletError(kind) };
        })()
      : undefined);

  const dismissError = useCallback(() => {
    setLocalError(undefined);
    resetConnect();
    resetSwitch();
  }, [resetConnect, resetSwitch]);

  const connectWallet = useCallback(() => {
    setLocalError(undefined);
    const connector = connectors[0];
    if (!connector) {
      setLocalError({ kind: 'no-provider', message: describeWalletError('no-provider') });
      return;
    }
    connect({ connector });
  }, [connect, connectors]);

  const disconnectWallet = useCallback(() => {
    setLocalError(undefined);
    resetConnect();
    resetSwitch();
    disconnect();
  }, [disconnect, resetConnect, resetSwitch]);

  const switchToDefaultChain = useCallback(() => {
    setLocalError(undefined);
    switchChain({ chainId: defaultChain.id });
  }, [switchChain]);

  return {
    state,
    error,
    isSwitching,
    defaultChainId: defaultChain.id,
    defaultChainName: chainDisplayName(defaultChain.id),
    connect: connectWallet,
    disconnect: disconnectWallet,
    switchToDefaultChain,
    dismissError,
  };
}
