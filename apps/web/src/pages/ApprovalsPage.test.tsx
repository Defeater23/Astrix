import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import type { ApprovalRequestSource } from '../features/approvals/types';
import { TestWalletProvider } from '../test/walletTestUtils';
import { ApprovalsPage } from './ApprovalsPage';

function renderPage(source?: ApprovalRequestSource, hasProvider = true) {
  return render(
    <TestWalletProvider hasProvider={hasProvider}>
      <MemoryRouter>
        <ToastProvider>{source ? <ApprovalsPage source={source} /> : <ApprovalsPage />}</ToastProvider>
      </MemoryRouter>
    </TestWalletProvider>,
  );
}

async function connect() {
  await userEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
}

afterEach(() => {
  window.localStorage.clear();
});

describe('Approvals page', () => {
  it('always labels the data as demo and the decisions as UI-only', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Approvals' })).toBeInTheDocument();
    expect(screen.getByText('Demo data: no cryptographic approval yet')).toBeInTheDocument();
    expect(screen.getByText(/Demo data, UI decisions only/)).toBeInTheDocument();
  });

  it('shows no requests while disconnected', () => {
    renderPage();
    expect(screen.getByText('No wallet connected')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('explains when MetaMask is missing', () => {
    renderPage(undefined, false);
    expect(screen.getByText('MetaMask not detected')).toBeInTheDocument();
  });

  it('shows the queue after connecting, then records a UI-only approval that survives a reload', async () => {
    const first = renderPage();
    await connect();
    const table = await screen.findByRole('table', { name: 'Approval requests' });
    expect(within(table).getByText('demo-001')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Review request demo-001' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record approval' }));
    expect(await screen.findByText('Approval recorded (UI only)')).toBeInTheDocument();

    first.unmount();
    renderPage();
    await connect();
    await screen.findByRole('table', { name: 'Approval requests' });
    await userEvent.click(screen.getByRole('button', { name: /^Decided \(1\)/ }));
    expect(screen.getByText('Approved (UI only, not signed)')).toBeInTheDocument();
  });

  it('shows a loading state while requests are being fetched', async () => {
    const source: ApprovalRequestSource = {
      kind: 'demo',
      label: 'Slow test source',
      list: () => new Promise(() => undefined),
    };
    renderPage(source);
    await connect();
    expect(await screen.findByText('Loading approval requests')).toBeInTheDocument();
  });

  it('shows an error with a working retry', async () => {
    const list = vi
      .fn<ApprovalRequestSource['list']>()
      .mockRejectedValueOnce(new Error('Source unavailable'))
      .mockResolvedValue([]);
    renderPage({ kind: 'demo', label: 'Failing test source', list });
    await connect();
    expect(await screen.findByRole('alert')).toHaveTextContent('Source unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No approval requests')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state when the source has no requests', async () => {
    renderPage({ kind: 'demo', label: 'Empty test source', list: () => Promise.resolve([]) });
    await connect();
    expect(await screen.findByText('No approval requests')).toBeInTheDocument();
  });

  it('hides malformed requests and says so rather than showing guessed values', async () => {
    renderPage({
      kind: 'demo',
      label: 'Malformed test source',
      list: () => Promise.resolve([{ id: 'bad', operation: { value: '1.5' } }]),
    });
    await connect();
    expect(await screen.findByText(/1 request had missing or malformed fields/)).toBeInTheDocument();
  });
});
