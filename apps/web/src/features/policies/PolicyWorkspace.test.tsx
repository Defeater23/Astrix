import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRecord } from '../agents/types';
import { PolicyWorkspace } from './PolicyWorkspace';
import type { PolicyRecord } from './types';
import type { SavePolicyOutcome } from './usePolicies';

const NOW = 1_800_000_000;
const RECIPIENT = '0x00000000000000000000000000000000000000A1';

const AGENT: AgentRecord = {
  id: 'a1',
  name: 'Research bot',
  description: '',
  signer: '0x00000000000000000000000000000000000000b2',
  expiresAt: null,
  status: 'active',
  createdAt: NOW - 100,
  updatedAt: NOW - 100,
};

const POLICY: PolicyRecord = {
  agentId: 'a1',
  perTxLimitWei: '100000000000000000',
  dailyLimitWei: '1000000000000000000',
  recipients: [RECIPIENT],
  tokens: [],
  contracts: [],
  selectors: [],
  state: 'draft',
  updatedAt: NOW,
};

function setup(
  options: { policies?: PolicyRecord[]; agent?: AgentRecord; save?: () => SavePolicyOutcome } = {},
) {
  const onSave = vi.fn(options.save ?? (() => ({ ok: true }) as SavePolicyOutcome));
  const onNotify = vi.fn();
  render(
    <PolicyWorkspace
      agents={[options.agent ?? AGENT]}
      policies={options.policies ?? []}
      nowSeconds={NOW}
      dropped={0}
      corrupt={false}
      onSave={onSave}
      onNotify={onNotify}
    />,
  );
  return { onSave, onNotify };
}

describe('PolicyWorkspace', () => {
  it('shows no policy and disables on-chain submission with a reason', () => {
    setup();
    expect(screen.getByText('No policy')).toBeInTheDocument();
    expect(screen.getByText('Confirmed on-chain: unavailable')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Submit on-chain' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('title', expect.stringContaining('not built'));
    expect(screen.queryByText('Preview a proposal against this draft')).not.toBeInTheDocument();
  });

  it('shows field errors from a refused save and does not notify', async () => {
    const { onNotify } = setup({
      save: () => ({ ok: false, errors: { perTxLimit: 'Enter a limit.' } }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText(/Enter a limit\./)).toBeInTheDocument();
    expect(onNotify).not.toHaveBeenCalled();
  });

  it('notifies that a saved draft is not enforced', async () => {
    const { onSave, onNotify } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(onSave).toHaveBeenCalledWith('a1', expect.objectContaining({ perTxLimit: '' }));
    expect(onNotify).toHaveBeenCalledWith('Draft saved for Research bot', 'Not enforced on-chain.');
  });

  it('loads an existing draft into the form in ETH', () => {
    setup({ policies: [POLICY] });
    expect(screen.getByLabelText('Per-transaction limit (ETH)')).toHaveValue('0.1');
    expect(screen.getByLabelText('Daily cumulative limit (ETH)')).toHaveValue('1');
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('previews a proposal as preview-only, allowed or denied', async () => {
    setup({ policies: [POLICY] });
    const panel = screen.getByText('Preview a proposal against this draft').closest('section');
    expect(panel).not.toBeNull();
    const view = within(panel as HTMLElement);
    await userEvent.type(view.getByLabelText('Recipient'), RECIPIENT);
    await userEvent.type(view.getByLabelText('Native value (ETH)'), '0.05');
    await userEvent.click(view.getByRole('button', { name: 'Evaluate' }));
    expect(view.getByText('Would be allowed by this draft')).toBeInTheDocument();
    expect(view.getByText(/Preview only/)).toBeInTheDocument();
    await userEvent.clear(view.getByLabelText('Native value (ETH)'));
    await userEvent.type(view.getByLabelText('Native value (ETH)'), '0.5');
    await userEvent.click(view.getByRole('button', { name: 'Evaluate' }));
    expect(view.getByText('Would be denied by this draft')).toBeInTheDocument();
    expect(view.getByText(/Fail: Per-transaction limit/)).toBeInTheDocument();
  });

  it('denies everything for a paused agent in the preview', async () => {
    setup({ policies: [POLICY], agent: { ...AGENT, status: 'paused' } });
    const view = within(
      screen.getByText('Preview a proposal against this draft').closest('section') as HTMLElement,
    );
    await userEvent.type(view.getByLabelText('Recipient'), RECIPIENT);
    await userEvent.click(view.getByRole('button', { name: 'Evaluate' }));
    expect(view.getByText('Would be denied by this draft')).toBeInTheDocument();
    expect(view.getByText(/Fail: Agent status/)).toBeInTheDocument();
  });

  it('disables saving for a revoked agent with a reason', () => {
    setup({ agent: { ...AGENT, status: 'revoked' } });
    const save = screen.getByRole('button', { name: 'Save draft' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('title', expect.stringContaining('Revoked'));
  });
});
