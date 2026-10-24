import { describe, expect, it } from 'vitest';
import { buildDemoRequests } from './demoData';
import {
  decisionStorageKey,
  deriveStatus,
  isDecisionRecord,
  loadDecisions,
  requestFingerprint,
  saveDecisions,
  withDecision,
} from './decisions';
import type { ApprovalRequest } from './types';

const NOW = 1_800_000_000;
const SCOPE = { owner: '0xAbC', chainId: 11155111 };

function pending(): ApprovalRequest {
  const request = buildDemoRequests(SCOPE, NOW)[0];
  if (!request) throw new Error('fixture missing');
  return request;
}

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set('k', initial);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe('storage key', () => {
  it('is scoped by chain and lowercased owner', () => {
    expect(decisionStorageKey(11155111, '0xAbC')).toBe(
      'sentinel-wallet:approval-decisions:v1:11155111:0xabc',
    );
  });
});

describe('deriveStatus', () => {
  it('is pending for a valid undecided request', () => {
    expect(deriveStatus(pending(), [], NOW)).toEqual({
      status: 'pending',
      changedSinceDecision: false,
    });
  });

  it('is expired at or after the expiry time', () => {
    const request = pending();
    const at = request.operation.expiresAt;
    expect(deriveStatus(request, [], at).status).toBe('expired');
    expect(deriveStatus(request, [], at - 1).status).toBe('pending');
  });

  it('applies a decision only while the payload is unchanged', () => {
    const request = pending();
    const decisions = withDecision([], request, 'ui_approved', NOW);
    expect(deriveStatus(request, decisions, NOW).status).toBe('ui_approved');
  });

  it.each([
    ['target', (r: ApprovalRequest) => ({ ...r, operation: { ...r.operation, target: '0x00000000000000000000000000000000000d0ff1' } })],
    ['value', (r: ApprovalRequest) => ({ ...r, operation: { ...r.operation, value: '1' } })],
    ['calldata', (r: ApprovalRequest) => ({ ...r, operation: { ...r.operation, data: `${r.operation.data}00` } })],
    ['nonce', (r: ApprovalRequest) => ({ ...r, operation: { ...r.operation, nonce: '999' } })],
    ['expiry', (r: ApprovalRequest) => ({ ...r, operation: { ...r.operation, expiresAt: r.operation.expiresAt + 1 } })],
    ['chain', (r: ApprovalRequest) => ({ ...r, operation: { ...r.operation, chainId: 31337 } })],
    ['account', (r: ApprovalRequest) => ({ ...r, operation: { ...r.operation, account: '0x00000000000000000000000000000000000d0002' } })],
    ['purpose', (r: ApprovalRequest) => ({ ...r, purpose: 'something else' })],
  ])('a changed %s voids the decision and requires a fresh review', (_name, mutate) => {
    const request = pending();
    const decisions = withDecision([], request, 'ui_approved', NOW);
    const derived = deriveStatus(mutate(request), decisions, NOW);
    expect(derived.status).toBe('pending');
    expect(derived.changedSinceDecision).toBe(true);
  });

  it('keeps a matching decision after expiry', () => {
    const request = pending();
    const decisions = withDecision([], request, 'ui_rejected', NOW);
    expect(deriveStatus(request, decisions, request.operation.expiresAt + 10).status).toBe(
      'ui_rejected',
    );
  });
});

describe('fingerprint', () => {
  it('is case-insensitive for addresses and hex but sensitive to content', () => {
    const request = pending();
    const upper = {
      ...request,
      operation: {
        ...request.operation,
        target: request.operation.target.toUpperCase().replace('0X', '0x'),
        data: request.operation.data.toUpperCase().replace('0X', '0x'),
      },
    };
    expect(requestFingerprint(upper)).toBe(requestFingerprint(request));
    expect(requestFingerprint({ ...request, reason: 'x' })).not.toBe(requestFingerprint(request));
  });
});

describe('withDecision', () => {
  it('keeps one record per request', () => {
    const request = pending();
    const once = withDecision([], request, 'ui_approved', NOW);
    const twice = withDecision(once, request, 'ui_rejected', NOW + 1);
    expect(twice).toHaveLength(1);
    expect(twice[0]?.decision).toBe('ui_rejected');
  });
});

describe('persistence', () => {
  it('round-trips decisions', () => {
    const storage = memoryStorage();
    const decisions = withDecision([], pending(), 'ui_approved', NOW);
    expect(saveDecisions(storage, 'k', decisions)).toBe(true);
    expect(loadDecisions(storage, 'k')).toEqual({ decisions, dropped: 0, corrupt: false });
  });

  it('returns empty when nothing is stored and when storage is unavailable', () => {
    expect(loadDecisions(memoryStorage(), 'k')).toEqual({ decisions: [], dropped: 0, corrupt: false });
    expect(loadDecisions(undefined, 'k').decisions).toEqual([]);
    expect(saveDecisions(undefined, 'k', [])).toBe(false);
  });

  it('flags corrupt or wrong-version data', () => {
    expect(loadDecisions(memoryStorage('not json'), 'k').corrupt).toBe(true);
    expect(loadDecisions(memoryStorage('{"version":2,"decisions":[]}'), 'k').corrupt).toBe(true);
    expect(loadDecisions(memoryStorage('{"version":1}'), 'k').corrupt).toBe(true);
  });

  it('drops malformed and duplicate records instead of trusting them', () => {
    const good = withDecision([], pending(), 'ui_approved', NOW)[0];
    const raw = JSON.stringify({
      version: 1,
      decisions: [good, good, { requestId: 'x', decision: 'executed', decidedAt: 1, fingerprint: 'f' }, 7],
    });
    const result = loadDecisions(memoryStorage(raw), 'k');
    expect(result.decisions).toHaveLength(1);
    expect(result.dropped).toBe(3);
  });

  it('never accepts a decision value that would claim execution or signing', () => {
    for (const decision of ['approved', 'signed', 'executed', 'confirmed']) {
      expect(
        isDecisionRecord({ requestId: 'a', decision, decidedAt: 1, fingerprint: 'f' }),
      ).toBe(false);
    }
  });

  it('reports a failed write', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(saveDecisions(storage, 'k', [])).toBe(false);
  });
});
