import { describe, expect, it } from 'vitest';
import { evaluateProposal } from './evaluate';
import type { PolicyRecord, Proposal } from './types';

const RECIPIENT = '0x00000000000000000000000000000000000000A1';
const OTHER = '0x00000000000000000000000000000000000000b2';
const TOKEN = '0x00000000000000000000000000000000000000c3';
const CONTRACT = '0x00000000000000000000000000000000000000d4';
const ETH = 10n ** 18n;

const POLICY: PolicyRecord = {
  agentId: 'a1',
  perTxLimitWei: (ETH / 10n).toString(),
  dailyLimitWei: ETH.toString(),
  recipients: [RECIPIENT],
  tokens: [TOKEN],
  contracts: [CONTRACT],
  selectors: ['0xa9059cbb'],
  state: 'draft',
  updatedAt: 1,
};

const ACTIVE = { agentStatus: 'active' as const, spentTodayWei: 0n };

function native(to: string, valueWei: bigint): Proposal {
  return { kind: 'native', to: to as Proposal['to'], valueWei };
}

function failed(result: ReturnType<typeof evaluateProposal>): string[] {
  return result.checks.filter((check) => !check.passed).map((check) => check.name);
}

describe('evaluateProposal: native transfers', () => {
  it('allows an in-policy transfer', () => {
    expect(evaluateProposal(POLICY, native(RECIPIENT, ETH / 20n), ACTIVE).allowed).toBe(true);
  });

  it('matches recipients case-insensitively', () => {
    expect(evaluateProposal(POLICY, native(RECIPIENT.toLowerCase(), 1n), ACTIVE).allowed).toBe(
      true,
    );
  });

  it('denies an unlisted recipient', () => {
    const result = evaluateProposal(POLICY, native(OTHER, 1n), ACTIVE);
    expect(result.allowed).toBe(false);
    expect(failed(result)).toEqual(['Recipient allowlist']);
  });

  it('allows exactly the per-transaction limit and denies one wei more', () => {
    expect(evaluateProposal(POLICY, native(RECIPIENT, ETH / 10n), ACTIVE).allowed).toBe(true);
    const over = evaluateProposal(POLICY, native(RECIPIENT, ETH / 10n + 1n), ACTIVE);
    expect(failed(over)).toEqual(['Per-transaction limit']);
  });

  it('enforces the cumulative daily limit including what was already spent', () => {
    const nearly = { agentStatus: 'active' as const, spentTodayWei: ETH - 5n };
    expect(evaluateProposal(POLICY, native(RECIPIENT, 5n), nearly).allowed).toBe(true);
    const over = evaluateProposal(POLICY, native(RECIPIENT, 6n), nearly);
    expect(failed(over)).toEqual(['Daily cumulative limit']);
  });

  it('reports every failing check, not just the first', () => {
    const result = evaluateProposal(POLICY, native(OTHER, ETH), {
      agentStatus: 'active',
      spentTodayWei: ETH,
    });
    expect(failed(result)).toEqual([
      'Recipient allowlist',
      'Per-transaction limit',
      'Daily cumulative limit',
    ]);
  });
});

describe('evaluateProposal: agent status', () => {
  it('denies everything unless the agent is active', () => {
    for (const status of ['paused', 'expired', 'revoked'] as const) {
      const result = evaluateProposal(POLICY, native(RECIPIENT, 1n), {
        agentStatus: status,
        spentTodayWei: 0n,
      });
      expect(result.allowed).toBe(false);
      expect(failed(result)).toEqual(['Agent status']);
    }
  });
});

describe('evaluateProposal: tokens and calls', () => {
  it('requires both the token and the recipient to be allowed', () => {
    const ok: Proposal = { kind: 'token', to: RECIPIENT, valueWei: 0n, token: TOKEN };
    expect(evaluateProposal(POLICY, ok, ACTIVE).allowed).toBe(true);
    const badToken: Proposal = { ...ok, token: OTHER };
    expect(failed(evaluateProposal(POLICY, badToken, ACTIVE))).toEqual(['Token allowlist']);
    const noToken: Proposal = { kind: 'token', to: RECIPIENT, valueWei: 0n };
    expect(evaluateProposal(POLICY, noToken, ACTIVE).allowed).toBe(false);
  });

  it('requires the contract and selector to be allowed', () => {
    const ok: Proposal = { kind: 'call', to: CONTRACT, valueWei: 0n, selector: '0xa9059cbb' };
    expect(evaluateProposal(POLICY, ok, ACTIVE).allowed).toBe(true);
    const badSelector: Proposal = { ...ok, selector: '0xdeadbeef' };
    expect(failed(evaluateProposal(POLICY, badSelector, ACTIVE))).toEqual([
      'Function selector allowlist',
    ]);
    const noSelector: Proposal = { kind: 'call', to: CONTRACT, valueWei: 0n };
    expect(evaluateProposal(POLICY, noSelector, ACTIVE).allowed).toBe(false);
  });

  it('applies the value limits to contract calls that send value', () => {
    const call: Proposal = { kind: 'call', to: CONTRACT, valueWei: ETH, selector: '0xa9059cbb' };
    expect(failed(evaluateProposal(POLICY, call, ACTIVE))).toEqual(['Per-transaction limit']);
  });
});

describe('evaluateProposal: deny by default', () => {
  it('denies everything when allowlists are empty', () => {
    const empty: PolicyRecord = {
      ...POLICY,
      recipients: [],
      tokens: [],
      contracts: [],
      selectors: [],
    };
    expect(evaluateProposal(empty, native(RECIPIENT, 1n), ACTIVE).allowed).toBe(false);
    const call: Proposal = { kind: 'call', to: CONTRACT, valueWei: 0n, selector: '0xa9059cbb' };
    expect(evaluateProposal(empty, call, ACTIVE).allowed).toBe(false);
  });

  it('fails closed when a stored limit is malformed', () => {
    const broken: PolicyRecord = { ...POLICY, perTxLimitWei: 'abc', dailyLimitWei: '-1' };
    const result = evaluateProposal(broken, native(RECIPIENT, 1n), ACTIVE);
    expect(result.allowed).toBe(false);
    expect(failed(result)).toEqual(['Per-transaction limit', 'Daily cumulative limit']);
  });
});
