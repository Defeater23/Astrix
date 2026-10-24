import type { AgentAction, AgentRecord, AgentStatus } from './types';
import type { ValidRegistration } from './validation';

/**
 * Pure agent lifecycle rules. Status is derived, never trusted from a flag alone:
 * revoked is terminal and wins; an elapsed expiry makes an agent expired regardless of
 * whether it was active or paused.
 */

export function effectiveStatus(agent: AgentRecord, nowSeconds: number): AgentStatus {
  if (agent.status === 'revoked') return 'revoked';
  if (agent.expiresAt !== null && agent.expiresAt <= nowSeconds) return 'expired';
  return agent.status;
}

/** Why an action is unavailable for a status, or undefined when it is allowed. */
export function unavailableReason(action: AgentAction, status: AgentStatus): string | undefined {
  if (status === 'revoked') return 'Revoked agents cannot be changed. Revocation is permanent.';
  switch (action) {
    case 'pause':
      if (status === 'paused') return 'The agent is already paused.';
      if (status === 'expired') return 'The agent has expired.';
      return undefined;
    case 'resume':
      if (status === 'active') return 'The agent is not paused.';
      if (status === 'expired') return 'Expired agents cannot be resumed. Register a new agent.';
      return undefined;
    case 'revoke':
      return undefined;
  }
}

export type TransitionResult = { ok: true; agent: AgentRecord } | { ok: false; reason: string };

export function createAgent(
  value: ValidRegistration,
  options: { id: string; nowSeconds: number },
): AgentRecord {
  return {
    id: options.id,
    name: value.name,
    description: value.description,
    signer: value.signer,
    expiresAt: value.expiresAt,
    status: 'active',
    createdAt: options.nowSeconds,
    updatedAt: options.nowSeconds,
  };
}

export function transitionAgent(
  agent: AgentRecord,
  action: AgentAction,
  nowSeconds: number,
): TransitionResult {
  const reason = unavailableReason(action, effectiveStatus(agent, nowSeconds));
  if (reason !== undefined) return { ok: false, reason };
  const status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'revoked';
  return { ok: true, agent: { ...agent, status, updatedAt: nowSeconds } };
}

export function countByStatus(
  agents: readonly AgentRecord[],
  nowSeconds: number,
): Record<AgentStatus, number> {
  const counts: Record<AgentStatus, number> = { active: 0, paused: 0, expired: 0, revoked: 0 };
  for (const agent of agents) counts[effectiveStatus(agent, nowSeconds)] += 1;
  return counts;
}
