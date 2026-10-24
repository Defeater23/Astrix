import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './AppRoutes';
import { ToastProvider } from './components/ui';
import { WalletProvider } from './features/wallet/WalletProvider';

export function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </BrowserRouter>
    </WalletProvider>
  );
}
