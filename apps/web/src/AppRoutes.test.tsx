import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './AppRoutes';
import { ToastProvider } from './components/ui';
import { NAV_ITEMS } from './config/navigation';
import { TestWalletProvider } from './test/walletTestUtils';

function renderAt(path: string, hasProvider = true) {
  return render(
    <TestWalletProvider hasProvider={hasProvider}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </MemoryRouter>
    </TestWalletProvider>,
  );
}

describe('routes', () => {
  it('renders the landing page', () => {
    renderAt('/');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Letting AI agents pay safely.' }),
    ).toBeInTheDocument();
  });

  it.each(NAV_ITEMS.map((item) => [item.path, item.label] as const))(
    'renders %s with a single h1 "%s"',
    (path, label) => {
      renderAt(path);
      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent(label);
    },
  );

  it('renders the design system page', () => {
    renderAt('/design-system');
    expect(screen.getByRole('heading', { level: 1, name: 'Design system' })).toBeInTheDocument();
  });

  it('renders a not-found page for unknown routes', () => {
    renderAt('/does-not-exist');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('redirects /app to the dashboard', () => {
    renderAt('/app');
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });
});

describe('truthfulness of placeholders', () => {
  it('shows metrics as Unavailable and never as numbers', () => {
    renderAt('/dashboard');
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(screen.queryByText(/\d+(\.\d+)?\s*(ETH|USDC|USD)/i)).not.toBeInTheDocument();
  });

  it('reports the wallet as not connected and offers an enabled connect control', () => {
    renderAt('/dashboard');
    expect(screen.getByText('Wallet: not connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect wallet/ })).toBeEnabled();
  });

  it('disables connect with a reason when MetaMask is not detected', () => {
    renderAt('/dashboard', false);
    expect(screen.getByText('Wallet: MetaMask not detected')).toBeInTheDocument();
    const connect = screen.getByRole('button', { name: /Connect wallet/ });
    expect(connect).toBeDisabled();
    expect(connect).toHaveAttribute('title', expect.stringContaining('not detected'));
  });

  it('labels every placeholder with the module that delivers it', () => {
    // Wallet (Module 3), Agents (Module 4), Policies (Module 5) and Approvals (Module 7A) are
    // implemented and are not placeholders.
    const implemented = ['/wallet', '/agents', '/policies', '/approvals'];
    for (const item of NAV_ITEMS.filter((nav) => !implemented.includes(nav.path))) {
      const { unmount } = renderAt(item.path);
      expect(screen.getByText(`Planned: Module ${item.module}`)).toBeInTheDocument();
      unmount();
    }
  });
});

describe('wallet page (Module 3)', () => {
  it('shows the smart account as unavailable, with no balances, while disconnected', () => {
    renderAt('/wallet');
    expect(screen.getByText('Read-only: Module 3')).toBeInTheDocument();
    expect(screen.getByText('Smart account (ERC-4337)')).toBeInTheDocument();
    expect(
      screen.getByText(/No state or\s+balance is shown without a chain read/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\d+(\.\d+)?\s*ETH/)).not.toBeInTheDocument();
  });

  it('always shows the pinned EntryPoint version and address', () => {
    renderAt('/wallet');
    expect(screen.getByText('EntryPoint v0.7')).toBeInTheDocument();
    expect(screen.getByText('0x0000000071727De22E5E9d8BAf0edAc6f37da032')).toBeInTheDocument();
  });
});

describe('agents page (Module 4)', () => {
  it('states that records are local and not enforced on-chain, with no agent data while disconnected', () => {
    renderAt('/agents');
    expect(screen.getByText('Local registry: not enforced on-chain')).toBeInTheDocument();
    expect(screen.getAllByText(/not enforced on-chain/i).length).toBeGreaterThan(1);
    expect(screen.getByText('No wallet connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register agent' })).not.toBeInTheDocument();
  });
});

describe('policies page (Module 5)', () => {
  it('states that drafts are not enforced and shows no policy data while disconnected', () => {
    renderAt('/policies');
    expect(screen.getByText('Drafts only: not enforced on-chain')).toBeInTheDocument();
    expect(screen.getByText('No wallet connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });
});

describe('approvals page (Module 7A)', () => {
  it('is no longer a placeholder, labels demo data and shows no requests while disconnected', () => {
    renderAt('/approvals');
    expect(screen.getByText('Demo data: no cryptographic approval yet')).toBeInTheDocument();
    expect(screen.getByText('No wallet connected')).toBeInTheDocument();
    expect(screen.queryByText('Planned: Module 7')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('links to every page from the sidebar', () => {
    renderAt('/dashboard');
    const nav = screen.getAllByRole('navigation', { name: 'Primary' })[0];
    expect(nav).toBeDefined();
    for (const item of NAV_ITEMS) {
      expect(
        screen.getAllByRole('link', { name: new RegExp(`^${item.label}`) }).length,
      ).toBeGreaterThan(0);
    }
  });

  it('opens and closes the mobile drawer from the menu button', async () => {
    renderAt('/dashboard');
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });
});
