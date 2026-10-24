import type { FormEvent } from 'react';
import { useId, useState } from 'react';
import type { StatusTone, TableColumn } from '../../components/ui';
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  Notice,
  StatusLabel,
  Table,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { countByStatus, effectiveStatus, unavailableReason } from './lifecycle';
import type { AgentAction, AgentRecord, AgentStatus } from './types';
import type { RegisterOutcome } from './useAgents';
import type { RegistrationErrors, RegistrationInput } from './validation';
import { DESCRIPTION_MAX, NAME_MAX, formatUtc } from './validation';

const STATUS_LABEL: Record<AgentStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  expired: 'Expired',
  revoked: 'Revoked',
};

const STATUS_TONE: Record<AgentStatus, StatusTone> = {
  active: 'solid',
  paused: 'outline',
  expired: 'muted',
  revoked: 'dashed',
};

const ACTION_LABEL: Record<AgentAction, string> = {
  pause: 'Pause',
  resume: 'Resume',
  revoke: 'Revoke',
};

const STATUS_PAST: Record<AgentAction, string> = {
  pause: 'paused',
  resume: 'resumed',
  revoke: 'revoked',
};

const LOCAL_ONLY_NOTE =
  'This changes the local record in this browser only. It does not change what the agent signer can do on-chain.';

const CONFIRM_TEXT: Record<AgentAction, (name: string) => string> = {
  pause: (name) => `Mark ${name} as paused. You can resume it later.`,
  resume: (name) => `Mark ${name} as active again.`,
  revoke: (name) =>
    `Revoke ${name}. Revocation is permanent: the agent cannot be resumed and its signer cannot be registered again here.`,
};

export interface AgentRegistryProps {
  agents: readonly AgentRecord[];
  nowSeconds: number;
  /** Records ignored because they failed validation when loaded. */
  dropped: number;
  corrupt: boolean;
  onRegister: (input: RegistrationInput) => RegisterOutcome;
  /** Returns an error message, or undefined on success. */
  onTransition: (action: AgentAction, id: string) => string | undefined;
  onNotify: (title: string, description?: string) => void;
}

const EMPTY_INPUT: RegistrationInput = { name: '', description: '', signer: '', expiry: '' };

interface RegisterFormProps {
  formId: string;
  onRegister: (input: RegistrationInput) => RegisterOutcome;
  onRegistered: (agent: AgentRecord) => void;
}

function RegisterForm({ formId, onRegister, onRegistered }: RegisterFormProps) {
  const [input, setInput] = useState<RegistrationInput>(EMPTY_INPUT);
  const [errors, setErrors] = useState<RegistrationErrors>({});

  function update(field: keyof RegistrationInput, value: string) {
    setInput((previous) => ({ ...previous, [field]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = onRegister(input);
    if (outcome.ok) {
      setErrors({});
      onRegistered(outcome.agent);
    } else {
      setErrors(outcome.errors);
    }
  }

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4">
      {errors.form ? (
        <Notice tone="error" title="Not registered">
          {errors.form}
        </Notice>
      ) : null}
      <TextField
        label="Name"
        value={input.name}
        onChange={(event) => update('name', event.target.value)}
        error={errors.name}
        maxLength={NAME_MAX + 20}
        autoComplete="off"
        required
      />
      <TextAreaField
        label="Description (optional)"
        value={input.description}
        onChange={(event) => update('description', event.target.value)}
        error={errors.description}
        hint={`What this agent is for. Up to ${DESCRIPTION_MAX} characters.`}
        maxLength={DESCRIPTION_MAX + 50}
      />
      <TextField
        label="Signer address"
        value={input.signer}
        onChange={(event) => update('signer', event.target.value)}
        error={errors.signer}
        hint="The agent's public address. Never enter a private key or seed phrase."
        className="font-mono"
        autoComplete="off"
        spellCheck={false}
        required
      />
      <TextField
        label="Expiry, UTC (optional)"
        type="datetime-local"
        value={input.expiry}
        onChange={(event) => update('expiry', event.target.value)}
        error={errors.expiry}
        hint="Interpreted as UTC. Leave empty for no expiry."
      />
    </form>
  );
}

export function AgentRegistry({
  agents,
  nowSeconds,
  dropped,
  corrupt,
  onRegister,
  onTransition,
  onNotify,
}: AgentRegistryProps) {
  const formId = useId();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [pending, setPending] = useState<{ action: AgentAction; agent: AgentRecord } | undefined>(
    undefined,
  );
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const counts = countByStatus(agents, nowSeconds);

  function confirmPending() {
    if (!pending) return;
    const message = onTransition(pending.action, pending.agent.id);
    if (message) {
      setActionError(message);
    } else {
      setActionError(undefined);
      onNotify(`${pending.agent.name}: ${STATUS_PAST[pending.action]}`, 'Local record only.');
    }
    setPending(undefined);
  }

  const columns: Array<TableColumn<AgentRecord>> = [
    {
      key: 'agent',
      header: 'Agent',
      render: (agent) => (
        <>
          <span className="font-medium text-black">{agent.name}</span>
          {agent.description ? (
            <span className="mt-0.5 block text-xs text-gray-600">{agent.description}</span>
          ) : null}
        </>
      ),
    },
    {
      key: 'signer',
      header: 'Signer',
      render: (agent) => <span className="break-all font-mono text-xs">{agent.signer}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (agent) => {
        const status = effectiveStatus(agent, nowSeconds);
        return <StatusLabel tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusLabel>;
      },
    },
    {
      key: 'expiry',
      header: 'Expires',
      render: (agent) => (agent.expiresAt === null ? 'No expiry' : formatUtc(agent.expiresAt)),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (agent) => {
        const status = effectiveStatus(agent, nowSeconds);
        return (
          <div className="flex flex-wrap gap-2">
            {(['pause', 'resume', 'revoke'] as const).map((action) => {
              const reason = unavailableReason(action, status);
              return (
                <Button
                  key={action}
                  size="sm"
                  variant={action === 'revoke' ? 'danger' : 'secondary'}
                  disabledReason={reason}
                  onClick={() => {
                    setActionError(undefined);
                    setPending({ action, agent });
                  }}
                  aria-label={`${ACTION_LABEL[action]} ${agent.name}`}
                >
                  {ACTION_LABEL[action]}
                </Button>
              );
            })}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {corrupt ? (
        <Notice tone="warning" title="Stored agents could not be read">
          The saved agent data in this browser is unreadable and was ignored. Registering a new
          agent will replace it.
        </Notice>
      ) : null}
      {dropped > 0 ? (
        <Notice tone="warning" title="Some records were ignored">
          {dropped} stored record{dropped === 1 ? ' was' : 's were'} invalid and not loaded.
        </Notice>
      ) : null}
      {actionError ? (
        <Notice tone="error" title="Action not applied">
          {actionError}
        </Notice>
      ) : null}

      <Card
        title="Registered agents"
        description="Agents registered for the connected owner on this network."
        actions={<Button onClick={() => setRegisterOpen(true)}>Register agent</Button>}
      >
        <dl className="mb-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          {(['active', 'paused', 'expired', 'revoked'] as const).map((status) => (
            <div key={status}>
              <dt className="text-gray-600">{STATUS_LABEL[status]}</dt>
              <dd className="mt-1 text-xl font-semibold text-black">{counts[status]}</dd>
            </div>
          ))}
        </dl>
        <Table
          caption="Registered agents"
          columns={columns}
          rows={[...agents]}
          rowKey={(agent) => agent.id}
          emptyMessage="No agents registered yet."
        />
      </Card>

      <Dialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        title="Register agent"
        description="Creates a local record. The agent receives no on-chain permission from this step."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRegisterOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId}>
              Register
            </Button>
          </>
        }
      >
        <RegisterForm
          formId={formId}
          onRegister={onRegister}
          onRegistered={(agent) => {
            setRegisterOpen(false);
            onNotify(`Registered ${agent.name}`, 'Local record only. Not enforced on-chain.');
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={pending !== undefined}
        title={pending ? `${ACTION_LABEL[pending.action]} agent` : 'Confirm'}
        description={pending ? CONFIRM_TEXT[pending.action](pending.agent.name) : ''}
        confirmLabel={pending ? ACTION_LABEL[pending.action] : 'Confirm'}
        tone={pending?.action === 'revoke' ? 'danger' : 'default'}
        onConfirm={confirmPending}
        onCancel={() => setPending(undefined)}
      >
        <p>{LOCAL_ONLY_NOTE}</p>
      </ConfirmDialog>
    </div>
  );
}
