import { useWallet } from './useWallet';
import { WalletStatusView } from './WalletStatusView';

/** Top-bar wallet status wired to the live wallet connection. */
export function WalletStatus() {
  const wallet = useWallet();
  return (
    <WalletStatusView
      state={wallet.state}
      error={wallet.error}
      isSwitching={wallet.isSwitching}
      defaultChainId={wallet.defaultChainId}
      defaultChainName={wallet.defaultChainName}
      onConnect={wallet.connect}
      onDisconnect={wallet.disconnect}
      onSwitch={wallet.switchToDefaultChain}
      onDismissError={wallet.dismissError}
    />
  );
}
