import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { NAV_ITEMS } from './config/navigation';
import { AgentsPage } from './pages/AgentsPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { DesignSystemPage } from './pages/DesignSystemPage';
import { LandingPage } from './pages/LandingPage';
import { ModulePlaceholderPage } from './pages/ModulePlaceholderPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PoliciesPage } from './pages/PoliciesPage';
import { WalletPage } from './pages/WalletPage';

function routeElement(path: string) {
  switch (path) {
    case '/wallet':
      return <WalletPage />;
    case '/agents':
      return <AgentsPage />;
    case '/policies':
      return <PoliciesPage />;
    case '/approvals':
      return <ApprovalsPage />;
    default:
      return <ModulePlaceholderPage path={path} />;
  }
}

/** Route table. Router context (BrowserRouter / MemoryRouter) is supplied by the caller. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route element={<AppShell />}>
        {NAV_ITEMS.map((item) => (
          <Route key={item.path} path={item.path} element={routeElement(item.path)} />
        ))}
        <Route path="/design-system" element={<DesignSystemPage />} />
      </Route>
      <Route path="/app" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
