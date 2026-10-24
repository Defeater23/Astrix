import { Button, Notice, StatusLabel } from '../../components/ui';
import { chainDisplayName } from './chains';
import type { WalletError } from './useWallet';
import type { WalletState } from './state';
import { shortAddress } from './state';

export interface WalletStatusViewProps {
  state: WalletState;
  error: WalletError | undefined;
  isSwitching: boolean;
  defaultChainId: number;
  defaultChainName: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onSwitch: () => void;
  onDismissError: () => void;
}

/** Presentational wallet status for the top bar. Shows only facts reported by the wallet. */
export function WalletStatusView({
  state,
  error,
  isSwitching,
  defaultChainId,
  defaultChainName,
  onConnect,
  onDisconnect,
  onSwitch,
  onDismissError,
}: WalletStatusViewProps) {
  const switchButton = (
    <Button size="sm" variant="secondary" loading={isSwitching} onClick={onSwitch}>
      Switch to {defaultChainName}
    </Button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {state.kind === 'no-provider' ? (
          <>
            <StatusLabel tone="muted">Wallet: MetaMask not detected</StatusLabel>
            <Button
              size="sm"
              disabledReason="MetaMask was not detected in this browser. Install or enable the extension, then reload."
            >
              Connect wallet
            </Button>
          </>
        ) : null}

        {state.kind === 'disconnected' ? (
          <>
            <StatusLabel tone="muted">Wallet: not connected</StatusLabel>
            <Button size="sm" onClick={onConnect}>
              Connect wallet
            </Button>
          </>
        ) : null}

        {state.kind === 'connecting' ? (
          <>
            <StatusLabel tone="dashed">Wallet: connecting…</StatusLabel>
            <Button size="sm" loading>
              Connecting
            </Button>
          </>
        ) : null}

        {state.kind === 'connected-supported' ? (
          <>
            <StatusLabel tone="solid">Wallet: connected</StatusLabel>
            <StatusLabel tone="outline">{shortAddress(state.address)}</StatusLabel>
            <StatusLabel tone="outline">
              {chainDisplayName(state.chainId)}, chain ID {state.chainId}
            </StatusLabel>
            {!state.isDefaultChain ? switchButton : null}
            <Button size="sm" variant="secondary" onClick={onDisconnect}>
              Disconnect
            </Button>
          </>
        ) : null}

        {state.kind === 'connected-unsupported' ? (
          <>
            <StatusLabel tone="solid">Wallet: connected</StatusLabel>
            <StatusLabel tone="outline">{shortAddress(state.address)}</StatusLabel>
            <StatusLabel tone="dashed">
              Unsupported network
              {state.chainId !== undefined ? `, chain ID ${state.chainId}` : ''}
            </StatusLabel>
            {switchButton}
            <Button size="sm" variant="secondary" onClick={onDisconnect}>
              Disconnect
            </Button>
          </>
        ) : null}

        <StatusLabel tone="muted">Default chain ID: {defaultChainId}</StatusLabel>
      </div>

      {error ? (
        <div className="w-full">
          <Notice tone="error" title="Wallet request failed">
            <p>{error.message}</p>
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={onDismissError}>
                Dismiss
              </Button>
            </div>
          </Notice>
        </div>
      ) : null}
    </>
  );
}
