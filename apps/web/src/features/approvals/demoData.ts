import type { ApprovalRequest, ApprovalRequestSource, ApprovalScope } from './types';

/**
 * Deterministic DEMO requests for Module 7A. They are fixtures, not agent output: no agent,
 * smart account or token below exists, and nothing derived from them is ever submitted. They are
 * anchored to the start of the current UTC day so expiries and fingerprints stay stable during a
 * day (a decision recorded today still matches after a reload) and roll over at 00:00 UTC.
 */

const DAY = 86_400;

export const DEMO_ACCOUNT = '0x00000000000000000000000000000000000d0001';
export const DEMO_AGENT = '0x00000000000000000000000000000000000d0a01';
export const DEMO_TOKEN = '0x00000000000000000000000000000000000d0c01';
const RECIPIENT_A = '0x00000000000000000000000000000000000d0e01';
const RECIPIENT_B = '0x00000000000000000000000000000000000d0e02';
const SPENDER = '0x00000000000000000000000000000000000d0e03';
const CONTRACT = '0x00000000000000000000000000000000000d0f01';

function word(hexWithout0x: string): string {
  return hexWithout0x.toLowerCase().padStart(64, '0');
}

/** ABI-encodes `selector(address,uint256)` calldata. */
export function encodeAddressUint(selector: string, address: string, amount: bigint): string {
  return `${selector}${word(address.slice(2))}${word(amount.toString(16))}`;
}

export function utcDayStart(nowSeconds: number): number {
  return Math.floor(nowSeconds / DAY) * DAY;
}

export function buildDemoRequests(scope: ApprovalScope, nowSeconds: number): ApprovalRequest[] {
  const day = utcDayStart(nowSeconds);
  const otherChain = scope.chainId === 11155111 ? 31337 : 11155111;
  const op = (nonce: string, expiresAt: number, target: string, value: string, data: string) => ({
    account: DEMO_ACCOUNT,
    agent: DEMO_AGENT,
    chainId: scope.chainId,
    nonce,
    expiresAt,
    target,
    value,
    data,
  });

  return [
    {
      id: 'demo-001',
      createdAt: day + 100,
      purpose: 'Pay invoice #1042 for data API usage.',
      reason: 'The recipient is not on this agent’s approved recipient list.',
      tokenMeta: { symbol: 'DEMO', decimals: 6 },
      operation: op(
        '17',
        day + DAY + 7_200,
        DEMO_TOKEN,
        '0',
        encodeAddressUint('0xa9059cbb', RECIPIENT_A, 25_000_000n),
      ),
    },
    {
      id: 'demo-002',
      createdAt: day + 200,
      purpose: 'Top up a testnet service wallet.',
      reason: 'The amount exceeds the per-transaction limit.',
      operation: op('18', day + DAY + 10_800, RECIPIENT_B, '50000000000000000', '0x'),
    },
    {
      id: 'demo-003',
      createdAt: day + 300,
      purpose: 'Call a contract function to renew a subscription.',
      reason: 'The function selector is not on the allowlist.',
      operation: op(
        '19',
        day + DAY + 14_400,
        CONTRACT,
        '0',
        `0x12345678${word('2a')}${word('01')}`,
      ),
    },
    {
      id: 'demo-004',
      createdAt: day + 400,
      purpose: 'Allow a payment processor to pull tokens.',
      reason: 'Token allowance grants require owner review.',
      tokenMeta: { symbol: 'DEMO', decimals: 6 },
      operation: op(
        '20',
        day + DAY + 18_000,
        DEMO_TOKEN,
        '0',
        encodeAddressUint('0x095ea8b0', SPENDER, 1_000_000_000n),
      ),
    },
    {
      id: 'demo-005',
      createdAt: day + 500,
      purpose: 'Pay a vendor (demo of an expired request).',
      reason: 'The recipient is not on this agent’s approved recipient list.',
      operation: op('21', day - 3_600, RECIPIENT_A, '1000000000000000', '0x'),
    },
    {
      id: 'demo-006',
      createdAt: day + 600,
      purpose: 'Transfer prepared for a different network.',
      reason: 'Demo of a request addressed to another chain.',
      operation: {
        ...op('22', day + DAY + 21_600, RECIPIENT_B, '2000000000000000', '0x'),
        chainId: otherChain,
      },
    },
    {
      id: 'demo-007',
      createdAt: day + 700,
      purpose: 'Token transfer with truncated calldata (demo of malformed input).',
      reason: 'Demo of calldata that cannot be decoded safely.',
      tokenMeta: { symbol: 'DEMO', decimals: 6 },
      operation: op(
        '23',
        day + DAY + 25_200,
        DEMO_TOKEN,
        '0',
        encodeAddressUint('0xa9059cbb', RECIPIENT_A, 5_000_000n).slice(0, 80),
      ),
    },
  ];
}

export const demoApprovalSource: ApprovalRequestSource = {
  kind: 'demo',
  label: 'Deterministic demo data',
  list: (scope, nowSeconds) => Promise.resolve(buildDemoRequests(scope, nowSeconds)),
};
