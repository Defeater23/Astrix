import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgentRegistry } from './AgentRegistry';
import type { AgentRecord } from './types';
import type { RegisterOutcome } from './useAgents';

const NOW = 1_800_000_000;

function agent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: 'a1',
    name: 'Research bot',
    description: 'Reads prices',
    signer: '0x00000000000000000000000000000000000000a1',
    expiresAt: null,
    status: 'active',
    createdAt: NOW - 100,
    updatedAt: NOW - 100,
    ...overrides,
  };
}

function setup(agents: AgentRecord[], overrides: { onRegister?: () => RegisterOutcome } = {}) {
  const onTransition = vi.fn<(action: string, id: string) => string | undefined>(() => undefined);
  const onNotify = vi.fn();
  const onRegister = vi.fn(
    overrides.onRegister ?? (() => ({ ok: false, errors: {} }) as RegisterOutcome),
  );
  render(
    <AgentRegistry
      agents={agents}
      nowSeconds={NOW}
      dropped={0}
      corrupt={false}
      onRegister={onRegister}
      onTransition={onTransition}
      onNotify={onNotify}
    />,
  );
  return { onTransition, onNotify, onRegister };
}

describe('AgentRegistry', () => {
  it('shows an empty state with zero counts', () => {
    setup([]);
    expect(screen.getByText('No agents registered yet.')).toBeInTheDocument();
  });

  it('shows the full signer address and a status label with text', () => {
    setup([agent({ status: 'paused' }), agent({ id: 'a2', expiresAt: NOW - 1, name: 'Old bot' })]);
    expect(screen.getAllByText('0x00000000000000000000000000000000000000a1')).toHaveLength(2);
    const table = screen.getByRole('table', { name: 'Registered agents' });
    expect(within(table).getByText('Paused')).toBeInTheDocument();
    expect(within(table).getByText('Expired')).toBeInTheDocument();
  });

  it('disables unavailable actions with a reason', () => {
    setup([agent()]);
    const resume = screen.getByRole('button', { name: 'Resume Research bot' });
    expect(resume).toBeDisabled();
    expect(resume).toHaveAttribute('title', expect.stringContaining('not paused'));
    expect(screen.getByRole('button', { name: 'Pause Research bot' })).toBeEnabled();
  });

  it('requires confirmation before pausing and can be cancelled', async () => {
    const { onTransition } = setup([agent()]);
    await userEvent.click(screen.getByRole('button', { name: 'Pause Research bot' }));
    const dialog = screen.getByRole('dialog', { name: 'Pause agent' });
    expect(within(dialog).getByText(/local record in this browser only/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onTransition).not.toHaveBeenCalled();
  });

  it('applies a confirmed revoke and says it is permanent', async () => {
    const { onTransition, onNotify } = setup([agent()]);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke Research bot' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke agent' });
    expect(within(dialog).getByText(/permanent/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(onTransition).toHaveBeenCalledWith('revoke', 'a1');
    expect(onNotify).toHaveBeenCalled();
  });

  it('shows an error and no success toast when a transition is refused', async () => {
    const { onTransition, onNotify } = setup([agent()]);
    onTransition.mockReturnValueOnce('Could not save.');
    await userEvent.click(screen.getByRole('button', { name: 'Pause Research bot' }));
    const dialog = screen.getByRole('dialog', { name: 'Pause agent' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    expect(screen.getByText('Could not save.')).toBeInTheDocument();
    expect(onNotify).not.toHaveBeenCalled();
  });

  it('shows field errors from registration and keeps the dialog open', async () => {
    setup([], {
      onRegister: () => ({ ok: false, errors: { name: 'Enter a name for the agent.' } }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Register agent' }));
    const dialog = screen.getByRole('dialog', { name: 'Register agent' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    expect(within(dialog).getByText(/Enter a name for the agent/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Register agent' })).toBeInTheDocument();
  });

  it('closes the dialog and notifies after a successful registration', async () => {
    const created = agent({ id: 'new', name: 'New bot' });
    const { onRegister, onNotify } = setup([], {
      onRegister: () => ({ ok: true, agent: created }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Register agent' }));
    const dialog = screen.getByRole('dialog', { name: 'Register agent' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'New bot');
    await userEvent.type(within(dialog).getByLabelText('Signer address'), '0xabc');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    expect(onRegister).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New bot', signer: '0xabc' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onNotify).toHaveBeenCalledWith(
      'Registered New bot',
      expect.stringContaining('Not enforced'),
    );
  });
});
