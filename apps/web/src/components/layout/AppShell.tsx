import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { CURRENT_MODULE, TOTAL_MODULES } from '../../config/navigation';
import { Button } from '../ui/Button';
import { StatusLabel } from '../ui/StatusLabel';
import { BrandMark } from './BrandMark';
import { WalletStatus } from '../../features/wallet/WalletStatus';
import { SidebarNav } from './SidebarNav';

/**
 * Responsive application shell: fixed sidebar on large screens, slide-in drawer on small
 * screens. The top bar shows wallet and network facts exactly as reported by MetaMask.
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Allow Escape to close the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-gray-200 bg-white lg:block">
        <div className="sticky top-0 flex max-h-screen flex-col gap-6 overflow-y-auto p-4">
          <BrandMark />
          <SidebarNav />
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            role="presentation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            id="mobile-drawer"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col gap-6 overflow-y-auto border-r border-gray-200 bg-white p-4"
          >
            <div className="flex items-center justify-between">
              <BrandMark />
              <Button size="sm" variant="secondary" onClick={() => setDrawerOpen(false)}>
                Close
              </Button>
            </div>
            <SidebarNav onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <Button
            size="sm"
            variant="secondary"
            className="lg:hidden"
            aria-expanded={drawerOpen}
            aria-controls="mobile-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            Menu
          </Button>
          <div className="min-w-0 flex-1 lg:hidden">
            <BrandMark />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <StatusLabel tone="dashed">Test networks only</StatusLabel>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <WalletStatus />
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-content flex-1 px-4 py-6 sm:px-6"
        >
          <Outlet />
        </main>

        <footer className="border-t border-gray-200 bg-white px-4 py-3 text-xs text-gray-600">
          Module {CURRENT_MODULE} of {TOTAL_MODULES}: wallet connection, a read-only smart-account
          overview, a local agent registry and local policy drafts. Nothing is enforced on-chain,
          and no transaction functionality exists yet. Use test networks and test funds only.{' '}
          <Link to="/" className="underline">
            Back to landing page
          </Link>
        </footer>
      </div>
    </div>
  );
}
