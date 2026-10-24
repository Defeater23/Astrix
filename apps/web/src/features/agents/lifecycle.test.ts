import { describe, expect, it } from 'vitest';
import {
  countByStatus,
  createAgent,
  effectiveStatus,
  transitionAgent,
  unavailableReason,
} from './lifecycle';
import type { AgentRecord } from './types';

const NOW = 1_800_000_000;

function agent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return createAgentRecord(overrides);
}

function createAgentRecord(overrides: Partial<AgentRecord>): AgentRecord {
  return {
    ...createAgent(
      {
        name: 'Bot',
        description: '',
        signer: '0x00000000000000000000000000000000000000a1',
        expiresAt: null,
      },
      { id: 'a1', nowSeconds: NOW - 100 },
    ),
    ...overrides,
  };
}

describe('effectiveStatus', () => {
  it('is active for a new agent without expiry', () => {
    expect(effectiveStatus(agent(), NOW)).toBe('active');
  });

  it('becomes expired once the expiry time is reached, even when paused', () => {
    expect(effectiveStatus(agent({ expiresAt: NOW + 1 }), NOW)).toBe('active');
    expect(effectiveStatus(agent({ expiresAt: NOW }), NOW)).toBe('expired');
    expect(effectiveStatus(agent({ expiresAt: NOW - 5, status: 'paused' }), NOW)).toBe('expired');
  });

  it('keeps revoked as revoked regardless of expiry', () => {
    expect(effectiveStatus(agent({ status: 'revoked', expiresAt: NOW - 5 }), NOW)).toBe('revoked');
  });
});

describe('transitionAgent', () => {
  it('pauses an active agent and resumes a paused one', () => {
    const paused = transitionAgent(agent(), 'pause', NOW);
    expect(paused.ok).toBe(true);
    if (paused.ok) {
      expect(paused.agent.status).toBe('paused');
      expect(paused.agent.updatedAt).toBe(NOW);
      const resumed = transitionAgent(paused.agent, 'resume', NOW);
      expect(resumed.ok).toBe(true);
      if (resumed.ok) expect(resumed.agent.status).toBe('active');
    }
  });

  it('refuses to pause a paused agent or resume an active one', () => {
    expect(transitionAgent(agent({ status: 'paused' }), 'pause', NOW).ok).toBe(false);
    expect(transitionAgent(agent(), 'resume', NOW).ok).toBe(false);
  });

  it('refuses to resume or pause an expired agent', () => {
    const expired = agent({ expiresAt: NOW - 1, status: 'paused' });
    expect(transitionAgent(expired, 'resume', NOW).ok).toBe(false);
    expect(transitionAgent(expired, 'pause', NOW).ok).toBe(false);
  });

  it('allows revoking active, paused and expired agents', () => {
    expect(transitionAgent(agent(), 'revoke', NOW).ok).toBe(true);
    expect(transitionAgent(agent({ status: 'paused' }), 'revoke', NOW).ok).toBe(true);
    expect(transitionAgent(agent({ expiresAt: NOW - 1 }), 'revoke', NOW).ok).toBe(true);
  });

  it('treats revocation as terminal', () => {
    const revoked = agent({ status: 'revoked' });
    for (const action of ['pause', 'resume', 'revoke'] as const) {
      expect(transitionAgent(revoked, action, NOW).ok).toBe(false);
    }
  });

  it('does not mutate the input record', () => {
    const original = agent();
    transitionAgent(original, 'revoke', NOW);
    expect(original.status).toBe('active');
  });
});

describe('unavailableReason', () => {
  it('returns a reason exactly when the action is not allowed', () => {
    expect(unavailableReason('pause', 'active')).toBe(undefined);
    expect(unavailableReason('resume', 'paused')).toBe(undefined);
    expect(typeof unavailableReason('resume', 'expired')).toBe('string');
    expect(typeof unavailableReason('revoke', 'revoked')).toBe('string');
  });
});

describe('countByStatus', () => {
  it('counts derived statuses', () => {
    const counts = countByStatus(
      [
        agent({ id: '1' }),
        agent({ id: '2', status: 'paused' }),
        agent({ id: '3', expiresAt: NOW - 1 }),
        agent({ id: '4', status: 'revoked' }),
        agent({ id: '5' }),
      ],
      NOW,
    );
    expect(counts).toEqual({ active: 2, paused: 1, expired: 1, revoked: 1 });
  });
});
