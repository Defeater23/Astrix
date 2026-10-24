import type { FormEvent } from 'react';
import { useId, useState } from 'react';
import { formatEther, getAddress, isAddress } from 'viem';
import {
  Button,
  Card,
  Notice,
  SelectField,
  StatusLabel,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { effectiveStatus } from '../agents/lifecycle';
import type { AgentRecord } from '../agents/types';
import type { Evaluation } from './evaluate';
import { evaluateProposal } from './evaluate';
import type { PolicyRecord, Proposal, ProposalKind } from './types';
import type { SavePolicyOutcome } from './usePolicies';
import type { PolicyErrors, PolicyInput } from './validation';
import { parseAmountWei } from './validation';

function toInput(policy: PolicyRecord | undefined): PolicyInput {
  if (!policy) {
    return {
      perTxLimit: '',
      dailyLimit: '',
      recipients: '',
      tokens: '',
      contracts: '',
      selectors: '',
    };
  }
  return {
    perTxLimit: formatEther(BigInt(policy.perTxLimitWei)),
    dailyLimit: formatEther(BigInt(policy.dailyLimitWei)),
    recipients: policy.recipients.join('\n'),
    tokens: policy.tokens.join('\n'),
    contracts: policy.contracts.join('\n'),
    selectors: policy.selectors.join('\n'),
  };
}

interface EditorProps {
  agent: AgentRecord;
  policy: PolicyRecord | undefined;
  revoked: boolean;
  onSave: (agentId: string, input: PolicyInput) => SavePolicyOutcome;
  onSaved: () => void;
}

function PolicyEditor({ agent, policy, revoked, onSave, onSaved }: EditorProps) {
  const [input, setInput] = useState<PolicyInput>(() => toInput(policy));
  const [errors, setErrors] = useState<PolicyErrors>({});

  function update(field: keyof PolicyInput, value: string) {
    setInput((previous) => ({ ...previous, [field]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = onSave(agent.id, input);
    if (outcome.ok) {
      setErrors({});
      onSaved();
    } else {
      setErrors(outcome.errors);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {errors.form ? (
        <Notice tone="error" title="Draft not saved">
          {errors.form}
        </Notice>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Per-transaction limit (ETH)"
          value={input.perTxLimit}
          onChange={(event) => update('perTxLimit', event.target.value)}
          error={errors.perTxLimit}
          hint="Native value only. Token amounts are not limited."
          inputMode="decimal"
          autoComplete="off"
        />
        <TextField
          label="Daily cumulative limit (ETH)"
          value={input.dailyLimit}
          onChange={(event) => update('dailyLimit', event.target.value)}
          error={errors.dailyLimit}
          hint="Per UTC calendar day, native value only."
          inputMode="decimal"
          autoComplete="off"
        />
      </div>
      <TextAreaField
        label="Allowed recipients"
        value={input.recipients}
        onChange={(event) => update('recipients', event.target.value)}
        error={errors.recipients}
        hint="One address per line. Empty means no recipient is allowed."
        className="font-mono"
        spellCheck={false}
      />
      <TextAreaField
        label="Allowed tokens"
        value={input.tokens}
        onChange={(event) => update('tokens', event.target.value)}
        error={errors.tokens}
        hint="Token contract addresses. Empty means no token transfer is allowed."
        className="font-mono"
        spellCheck={false}
      />
      <TextAreaField
        label="Allowed contracts"
        value={input.contracts}
        onChange={(event) => update('contracts', event.target.value)}
        error={errors.contracts}
        hint="Contracts the agent may call. Empty means no contract call is allowed."
        className="font-mono"
        spellCheck={false}
      />
      <TextAreaField
        label="Allowed function selectors"
        value={input.selectors}
        onChange={(event) => update('selectors', event.target.value)}
        error={errors.selectors}
        hint="4-byte selectors such as 0xa9059cbb. Empty means no function is allowed."
        className="font-mono"
        spellCheck={false}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabledReason={revoked ? 'Revoked agents cannot be changed.' : undefined}
        >
          Save draft
        </Button>
        <Button
          variant="secondary"
          disabledReason="Submitting on-chain needs the account-layer policy contracts, which are not built yet."
        >
          Submit on-chain
        </Button>
      </div>
    </form>
  );
}

interface SimulatorProps {
  policy: PolicyRecord;
  agent: AgentRecord;
  nowSeconds: number;
}

const KIND_LABEL: Record<ProposalKind, string> = {
  native: 'Native transfer',
  token: 'Token transfer',
  call: 'Contract call',
};

function PolicySimulator({ policy, agent, nowSeconds }: SimulatorProps) {
  const [kind, setKind] = useState<ProposalKind>('native');
  const [to, setTo] = useState('');
  const [value, setValue] = useState('');
  const [token, setToken] = useState('');
  const [selector, setSelector] = useState('');
  const [spent, setSpent] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<Evaluation | undefined>(undefined);

  function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(undefined);
    const toText = to.trim();
    if (!isAddress(toText)) {
      setError(
        kind === 'call' ? 'Enter a valid contract address.' : 'Enter a valid recipient address.',
      );
      return;
    }
    const valueWei = parseAmountWei(value);
    const spentWei = parseAmountWei(spent);
    if (valueWei === undefined || spentWei === undefined) {
      setError('Enter amounts as plain decimal ETH values with at most 18 decimals.');
      return;
    }
    const proposal: Proposal = { kind, to: getAddress(toText), valueWei };
    if (kind === 'token') {
      if (!isAddress(token.trim())) {
        setError('Enter a valid token address.');
        return;
      }
      proposal.token = getAddress(token.trim());
      proposal.valueWei = 0n;
    }
    if (kind === 'call') {
      if (!/^0x[0-9a-fA-F]{8}$/.test(selector.trim())) {
        setError('Enter a 4-byte selector such as 0xa9059cbb.');
        return;
      }
      proposal.selector = selector.trim().toLowerCase() as `0x${string}`;
    }
    setError(undefined);
    setResult(
      evaluateProposal(policy, proposal, {
        agentStatus: effectiveStatus(agent, nowSeconds),
        spentTodayWei: spentWei,
      }),
    );
  }

  return (
    <Card
      title="Preview a proposal against this draft"
      description="A local check of the draft rules. It does not enforce anything."
    >
      <form onSubmit={run} noValidate className="space-y-4">
        <SelectField
          label="Proposal type"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as ProposalKind);
            setResult(undefined);
          }}
        >
          {(Object.keys(KIND_LABEL) as ProposalKind[]).map((option) => (
            <option key={option} value={option}>
              {KIND_LABEL[option]}
            </option>
          ))}
        </SelectField>
        <TextField
          label={kind === 'call' ? 'Target contract' : 'Recipient'}
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        {kind === 'token' ? (
          <TextField
            label="Token contract"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        ) : null}
        {kind === 'call' ? (
          <TextField
            label="Function selector"
            value={selector}
            onChange={(event) => setSelector(event.target.value)}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        ) : null}
        {kind !== 'token' ? (
          <TextField
            label="Native value (ETH)"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            hint="Empty means zero."
            inputMode="decimal"
            autoComplete="off"
          />
        ) : null}
        <TextField
          label="Already spent today (ETH)"
          value={spent}
          onChange={(event) => setSpent(event.target.value)}
          hint="You enter this by hand; spending is not tracked until later modules. Empty means zero."
          inputMode="decimal"
          autoComplete="off"
        />
        {error ? (
          <Notice tone="error" title="Cannot evaluate">
            {error}
          </Notice>
        ) : null}
        <Button type="submit" variant="secondary">
          Evaluate
        </Button>
      </form>

      {result ? (
        <div className="mt-4 space-y-3" aria-live="polite">
          <p className="text-sm font-semibold text-black">
            {result.allowed ? 'Would be allowed by this draft' : 'Would be denied by this draft'}
          </p>
          <ul className="space-y-1 text-sm text-charcoal">
            {result.checks.map((check) => (
              <li key={check.name}>
                <span className="font-medium text-black">
                  {check.passed ? 'Pass' : 'Fail'}: {check.name}.
                </span>{' '}
                {check.detail}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-600">
            Preview only. The smart account does not hold this policy, so it would not stop or allow
            a real transaction.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

export interface PolicyWorkspaceProps {
  agents: readonly AgentRecord[];
  policies: readonly PolicyRecord[];
  nowSeconds: number;
  dropped: number;
  corrupt: boolean;
  onSave: (agentId: string, input: PolicyInput) => SavePolicyOutcome;
  onNotify: (title: string, description?: string) => void;
}

export function PolicyWorkspace({
  agents,
  policies,
  nowSeconds,
  dropped,
  corrupt,
  onSave,
  onNotify,
}: PolicyWorkspaceProps) {
  const selectId = useId();
  const [selectedId, setSelectedId] = useState<string | undefined>(agents[0]?.id);
  const agent = agents.find((candidate) => candidate.id === selectedId) ?? agents[0];

  if (!agent) return null;
  const policy = policies.find((candidate) => candidate.agentId === agent.id);
  const status = effectiveStatus(agent, nowSeconds);

  return (
    <div className="space-y-6">
      {corrupt ? (
        <Notice tone="warning" title="Stored policies could not be read">
          The saved policy data in this browser is unreadable and was ignored. Saving a draft will
          replace it.
        </Notice>
      ) : null}
      {dropped > 0 ? (
        <Notice tone="warning" title="Some records were ignored">
          {dropped} stored record{dropped === 1 ? ' was' : 's were'} invalid and not loaded.
        </Notice>
      ) : null}

      <Card title="Agent" description="Each agent has its own draft policy.">
        <SelectField
          id={selectId}
          label="Agent"
          value={agent.id}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {agents.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({effectiveStatus(candidate, nowSeconds)})
            </option>
          ))}
        </SelectField>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-600">Policy state:</span>
          <StatusLabel tone={policy ? 'solid' : 'muted'}>
            {policy ? 'Draft' : 'No policy'}
          </StatusLabel>
          <StatusLabel tone="dashed">Submitted: unavailable</StatusLabel>
          <StatusLabel tone="dashed">Confirmed on-chain: unavailable</StatusLabel>
        </div>
        {status !== 'active' ? (
          <p className="mt-3 text-sm text-gray-600">
            This agent is {status}. A preview will deny everything for it.
          </p>
        ) : null}
      </Card>

      <Card
        title="Policy draft"
        description="Saved in this browser only. A saved draft is not an enforced policy."
      >
        <PolicyEditor
          key={`${agent.id}:${policy?.updatedAt ?? 'none'}`}
          agent={agent}
          policy={policy}
          revoked={status === 'revoked'}
          onSave={onSave}
          onSaved={() => onNotify(`Draft saved for ${agent.name}`, 'Not enforced on-chain.')}
        />
      </Card>

      {policy ? (
        <PolicySimulator key={agent.id} policy={policy} agent={agent} nowSeconds={nowSeconds} />
      ) : null}
    </div>
  );
}
