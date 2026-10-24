import type { AgentStatus } from '../agents/types';
import type { PolicyRecord, Proposal } from './types';
import { parseStoredWei } from './validation';

/**
 * Reference evaluator for the spending-policy rules. It is a pure function used to preview a
 * proposal against a DRAFT policy. It is NOT enforcement: nothing in this application stops a
 * transaction. It exists so the same rules can later be mirrored in the account layer and tested
 * against the same cases.
 *
 * Semantics (deny by default):
 * - An empty allowlist allows nothing of that kind.
 * - Limits apply to native value only. Token amounts are not limited in this module.
 * - The daily window is the UTC calendar day; the caller supplies what was already spent in it.
 * - Every failing check is reported; evaluation does not stop at the first failure.
 */

export interface PolicyCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface Evaluation {
  allowed: boolean;
  checks: PolicyCheck[];
}

export interface EvaluationContext {
  agentStatus: AgentStatus;
  /** Native value already spent in the current UTC day, in wei. */
  spentTodayWei: bigint;
}

function includesAddress(list: readonly string[], value: string): boolean {
  return list.some((entry) => entry.toLowerCase() === value.toLowerCase());
}

export function evaluateProposal(
  policy: PolicyRecord,
  proposal: Proposal,
  context: EvaluationContext,
): Evaluation {
  const checks: PolicyCheck[] = [];
  const add = (name: string, passed: boolean, detail: string) =>
    checks.push({ name, passed, detail });

  add(
    'Agent status',
    context.agentStatus === 'active',
    context.agentStatus === 'active'
      ? 'The agent is active.'
      : `The agent is ${context.agentStatus}, so nothing is allowed.`,
  );

  if (proposal.kind === 'native') {
    const ok = includesAddress(policy.recipients, proposal.to);
    add(
      'Recipient allowlist',
      ok,
      ok ? 'Recipient is allowed.' : 'Recipient is not on the allowlist.',
    );
  } else if (proposal.kind === 'token') {
    const tokenOk = proposal.token !== undefined && includesAddress(policy.tokens, proposal.token);
    add(
      'Token allowlist',
      tokenOk,
      tokenOk ? 'Token is allowed.' : 'Token is not on the allowlist.',
    );
    const ok = includesAddress(policy.recipients, proposal.to);
    add(
      'Recipient allowlist',
      ok,
      ok ? 'Recipient is allowed.' : 'Recipient is not on the allowlist.',
    );
  } else {
    const contractOk = includesAddress(policy.contracts, proposal.to);
    add(
      'Contract allowlist',
      contractOk,
      contractOk ? 'Contract is allowed.' : 'Contract is not on the allowlist.',
    );
    const selectorOk =
      proposal.selector !== undefined && includesAddress(policy.selectors, proposal.selector);
    add(
      'Function selector allowlist',
      selectorOk,
      selectorOk ? 'Selector is allowed.' : 'Selector is not on the allowlist.',
    );
  }

  const perTx = parseStoredWei(policy.perTxLimitWei);
  const daily = parseStoredWei(policy.dailyLimitWei);
  add(
    'Per-transaction limit',
    perTx !== undefined && proposal.valueWei <= perTx,
    perTx === undefined
      ? 'The stored limit is malformed, so the check fails.'
      : proposal.valueWei <= perTx
        ? 'Value is within the per-transaction limit.'
        : 'Value exceeds the per-transaction limit.',
  );
  const total = context.spentTodayWei + proposal.valueWei;
  add(
    'Daily cumulative limit',
    daily !== undefined && total <= daily,
    daily === undefined
      ? 'The stored limit is malformed, so the check fails.'
      : total <= daily
        ? 'Spent today plus this value is within the daily limit.'
        : 'Spent today plus this value exceeds the daily limit.',
  );

  return { allowed: checks.every((check) => check.passed), checks };
}
