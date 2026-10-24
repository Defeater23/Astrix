import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalWorkspace } from './ApprovalWorkspace';
import { buildDemoRequests } from './demoData';
import { withDecision } from './decisions';
import type { ApprovalRow } from './rows';
import { buildRows } from './rows';
import type { DecisionRecord, LocalDecision } from './types';

const NOW = 1_800_000_000;
const CTX = { connectedChainId: 11155111, nativeSymbol: 'ETH' };
const requests = buildDemoRequests({ owner: '0x1', chainId: 11155111 }, NOW);

function rowsWith(decisions: DecisionRecord[] = []): ApprovalRow[] {
  return buildRows(requests, decisions, NOW, CTX);
}

interface SetupOptions {
  rows?: ApprovalRow[];
  dropped?: number;
  hasDecisions?: boolean;
  onDecide?: (id: string, decision: LocalDecision) => string | undefined;
}

function setup({ rows = rowsWith(), dropped = 0, hasDecisions = false, onDecide }: SetupOptions = {}) {
  const decide = vi.fn(onDecide ?? (() => undefined));
  const reset = vi.fn(() => undefined);
  const notify = vi.fn();
  render(
    <ApprovalWorkspace
      rows={rows}
      nowSeconds={NOW}
      dropped={dropped}
      droppedDecisions={0}
      corruptDecisions={false}
      hasDecisions={hasDecisions}
      onDecide={decide}
      onReset={reset}
      onNotify={notify}
    />,
  );
  return { decide, reset, notify };
}

async function openReview(id: string) {
  await userEvent.click(screen.getByRole('button', { name: `Review request ${id}` }));
  return screen.getByRole('dialog', { name: 'Review operation' });
}

describe('ApprovalWorkspace queue', () => {
  it('lists pending requests first with filter counts and hides expired ones', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Pending (6)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Decided (0)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expired (1)' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Approval requests' });
    expect(within(table).getByText('demo-001')).toBeInTheDocument();
    expect(within(table).queryByText('demo-005')).not.toBeInTheDocument();
  });

  it('shows expired requests under the Expired filter', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Expired (1)' }));
    expect(screen.getByText('demo-005')).toBeInTheDocument();
    expect(screen.getByText('Expired', { selector: 'span' })).toBeInTheDocument();
  });

  it('shows a per-filter empty message', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Decided (0)' }));
    expect(screen.getByText('No decisions recorded in this browser yet.')).toBeInTheDocument();
  });

  it('shows an empty state when there are no requests at all', () => {
    setup({ rows: [] });
    expect(screen.getByText('No approval requests')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('reports requests that were hidden because they were malformed', () => {
    setup({ dropped: 2 });
    expect(screen.getByText(/2 requests had missing or malformed fields/)).toBeInTheDocument();
  });
});

describe('ApprovalWorkspace review', () => {
  it('shows the exact operation, in full', async () => {
    setup();
    const dialog = await openReview('demo-001');
    expect(within(dialog).getByText('Transfer tokens')).toBeInTheDocument();
    expect(within(dialog).getByText('25 DEMO')).toBeInTheDocument();
    expect(within(dialog).getByText('25000000')).toBeInTheDocument();
    expect(within(dialog).getByText(/not verified on-chain/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText('0x00000000000000000000000000000000000d0e01'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Sepolia, chain ID 11155111')).toBeInTheDocument();
    expect(within(dialog).getByText(/invoice #1042/i)).toBeInTheDocument();
    const calldata = within(dialog).getByRole('textbox', { name: 'Raw calldata' });
    expect(calldata).toHaveValue(requests[0]?.operation.data);
    expect(calldata).toHaveAttribute('readonly');
  });

  it('labels undecoded and malformed calldata instead of guessing', async () => {
    setup();
    const unknown = await openReview('demo-003');
    expect(within(unknown).getByText('Not decoded')).toBeInTheDocument();
    expect(within(unknown).getByText(/Unknown selector/)).toBeInTheDocument();
    await userEvent.click(within(unknown).getByRole('button', { name: 'Close' }));
    const malformed = await openReview('demo-007');
    expect(within(malformed).getByText('Malformed call')).toBeInTheDocument();
    expect(within(malformed).getByText(/unexpected length/i)).toBeInTheDocument();
  });

  it('warns about a request for another network and blocks approving it, but allows rejecting', async () => {
    setup();
    const dialog = await openReview('demo-006');
    expect(within(dialog).getByText(/chain ID 31337 but the wallet is on chain ID 11155111/)).toBeInTheDocument();
    const approve = within(dialog).getByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('title', expect.stringContaining('chain ID'));
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('blocks both decisions for an expired request', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Expired (1)' }));
    const dialog = await openReview('demo-005');
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toHaveAttribute(
      'title',
      expect.stringContaining('expired'),
    );
  });

  it('closes with the Close button without deciding', async () => {
    const { decide } = setup();
    const dialog = await openReview('demo-001');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();
  });
});

describe('ApprovalWorkspace decisions', () => {
  it('requires confirmation, states that approval is UI-only, and can be cancelled', async () => {
    const { decide } = setup();
    const review = await openReview('demo-001');
    await userEvent.click(within(review).getByRole('button', { name: 'Approve' }));
    const confirm = screen.getByRole('dialog', { name: 'Record approval?' });
    expect(within(confirm).getByText(/does not create a signature/i)).toBeInTheDocument();
    expect(within(confirm).getByText('25000000')).toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();

    await userEvent.click(within(confirm).getByRole('button', { name: 'Back to review' }));
    expect(screen.getByRole('dialog', { name: 'Review operation' })).toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();
  });

  it('records an approval only after confirmation and says nothing was submitted', async () => {
    const { decide, notify } = setup();
    const review = await openReview('demo-001');
    await userEvent.click(within(review).getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record approval' }));
    expect(decide).toHaveBeenCalledWith('demo-001', 'ui_approved');
    expect(notify).toHaveBeenCalledWith(
      'Approval recorded (UI only)',
      'No signature was created and nothing was submitted.',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('records a rejection only after confirmation', async () => {
    const { decide, notify } = setup();
    const review = await openReview('demo-002');
    await userEvent.click(within(review).getByRole('button', { name: 'Reject' }));
    const confirm = screen.getByRole('dialog', { name: 'Reject request?' });
    expect(within(confirm).getByText(/Nothing will be submitted/)).toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Reject request' }));
    expect(decide).toHaveBeenCalledWith('demo-002', 'ui_rejected');
    expect(notify).toHaveBeenCalledWith('Rejection recorded', 'Nothing was submitted.');
  });

  it('reports a refused decision instead of claiming success', async () => {
    const { notify } = setup({ onDecide: () => 'This request has expired.' });
    const review = await openReview('demo-001');
    await userEvent.click(within(review).getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record approval' }));
    expect(notify).toHaveBeenCalledWith('Decision not recorded', 'This request has expired.');
    expect(notify).not.toHaveBeenCalledWith('Approval recorded (UI only)', expect.anything());
  });

  it('shows decided requests as UI-only, not signed, with both controls disabled', async () => {
    const first = requests[0];
    if (!first) throw new Error('fixture missing');
    setup({ rows: rowsWith(withDecision([], first, 'ui_approved', NOW)), hasDecisions: true });
    await userEvent.click(screen.getByRole('button', { name: 'Decided (1)' }));
    expect(screen.getByText('Approved (UI only, not signed)')).toBeInTheDocument();
    const review = await openReview('demo-001');
    expect(within(review).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(review).getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  it('flags a request that changed after it was decided and treats it as pending', async () => {
    const first = requests[0];
    if (!first) throw new Error('fixture missing');
    const decisions = withDecision([], first, 'ui_approved', NOW);
    const changed = requests.map((r) =>
      r.id === first.id ? { ...r, operation: { ...r.operation, value: '1' } } : r,
    );
    setup({ rows: buildRows(changed, decisions, NOW, CTX), hasDecisions: true });
    const review = await openReview('demo-001');
    expect(within(review).getByText(/Changed since your earlier decision/)).toBeInTheDocument();
    expect(within(review).getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('resets local decisions only after confirmation', async () => {
    const first = requests[0];
    if (!first) throw new Error('fixture missing');
    const { reset } = setup({
      rows: rowsWith(withDecision([], first, 'ui_rejected', NOW)),
      hasDecisions: true,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Reset local decisions' }));
    expect(reset).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reset decisions' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
