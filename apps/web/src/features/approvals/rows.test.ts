import { describe, expect, it } from 'vitest';
import { buildDemoRequests, utcDayStart } from './demoData';
import { withDecision } from './decisions';
import { buildRows, countByFilter, filterOf } from './rows';

const NOW = 1_800_000_000;
const CTX = { connectedChainId: 11155111, nativeSymbol: 'ETH' };
const SCOPE = { owner: '0x1', chainId: 11155111 };

describe('demo fixtures', () => {
  it('are deterministic for the same day and scope', () => {
    expect(buildDemoRequests(SCOPE, NOW)).toEqual(buildDemoRequests(SCOPE, NOW + 3_000));
  });

  it('roll over at 00:00 UTC', () => {
    const next = utcDayStart(NOW) + 86_400;
    expect(buildDemoRequests(SCOPE, next)[0]?.operation.expiresAt).toBe(
      (buildDemoRequests(SCOPE, NOW)[0]?.operation.expiresAt ?? 0) + 86_400,
    );
  });

  it('keep exactly one request expired and one on another chain', () => {
    const requests = buildDemoRequests(SCOPE, NOW);
    expect(requests.filter((r) => r.operation.expiresAt <= NOW)).toHaveLength(1);
    expect(requests.filter((r) => r.operation.chainId !== SCOPE.chainId)).toHaveLength(1);
  });

  it('always have valid pending requests, even at the last second of the day', () => {
    const lastSecond = utcDayStart(NOW) + 86_399;
    const live = buildDemoRequests(SCOPE, lastSecond).filter(
      (r) => r.operation.expiresAt > lastSecond,
    );
    expect(live).toHaveLength(6);
  });
});

describe('buildRows', () => {
  const requests = buildDemoRequests(SCOPE, NOW);

  it('orders by creation time and derives statuses', () => {
    const rows = buildRows(requests, [], NOW, CTX);
    expect(rows.map((r) => r.request.id)).toEqual(requests.map((r) => r.id));
    expect(rows.find((r) => r.request.id === 'demo-005')?.status).toBe('expired');
    expect(rows.find((r) => r.request.id === 'demo-001')?.status).toBe('pending');
  });

  it('blocks approving an expired request and a wrong-chain request, with reasons', () => {
    const rows = buildRows(requests, [], NOW, CTX);
    const expired = rows.find((r) => r.request.id === 'demo-005');
    expect(expired?.approveBlockedReason).toMatch(/expired/i);
    expect(expired?.rejectBlockedReason).toMatch(/expired/i);
    const wrong = rows.find((r) => r.request.id === 'demo-006');
    expect(wrong?.approveBlockedReason).toMatch(/chain ID/);
    expect(wrong?.rejectBlockedReason).toBeUndefined();
    expect(rows.find((r) => r.request.id === 'demo-001')?.approveBlockedReason).toBeUndefined();
  });

  it('blocks both controls once decided', () => {
    const first = requests[0];
    if (!first) throw new Error('fixture missing');
    const decisions = withDecision([], first, 'ui_approved', NOW);
    const row = buildRows(requests, decisions, NOW, CTX)[0];
    expect(row?.status).toBe('ui_approved');
    expect(row?.approveBlockedReason).toMatch(/already recorded/i);
    expect(row?.rejectBlockedReason).toMatch(/already recorded/i);
  });

  it('counts by filter', () => {
    const first = requests[0];
    if (!first) throw new Error('fixture missing');
    const decisions = withDecision([], first, 'ui_rejected', NOW);
    expect(countByFilter(buildRows(requests, decisions, NOW, CTX))).toEqual({
      pending: 5,
      decided: 1,
      expired: 1,
    });
    expect(filterOf('ui_approved')).toBe('decided');
  });
});
