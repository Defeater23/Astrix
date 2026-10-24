import type { ParseContext } from './schema';
import { parseRequest } from './schema';
import type { RequestRecord, RequestStore, ValidatedRequest } from './types';
import { submit } from './registry';

/** Test fixtures for Module 7B. Addresses are synthetic and exist on no chain. */

export const NOW = 1_800_000_000;
export const CHAIN = 11155111;
export const OWNER = '0x00000000000000000000000000000000000a0001';
export const ACCOUNT = '0x00000000000000000000000000000000000d0001';
export const AGENT = '0x00000000000000000000000000000000000d0a01';
export const TOKEN = '0x00000000000000000000000000000000000d0c01';
export const RECIPIENT = '0x00000000000000000000000000000000000d0e01';
export const SPENDER = '0x00000000000000000000000000000000000d0e03';
export const CONTRACT = '0x00000000000000000000000000000000000d0f01';

export const CTX: ParseContext = { nowSeconds: NOW, supportedChainIds: [11155111, 31337] };

function word(hex: string): string {
  return hex.toLowerCase().padStart(64, '0');
}

export function encodeCall(selector: string, address: string, amount: bigint): string {
  return `${selector}${word(address.slice(2))}${word(amount.toString(16))}`;
}

type Raw = Record<string, unknown>;

/** A valid ERC-20 transfer request as an untrusted object. Override any field, including nested. */
export function rawRequest(overrides: Raw = {}, operation: Raw = {}, typed?: Raw): Raw {
  return {
    schemaVersion: 1,
    requestId: 'req-1',
    owner: OWNER,
    createdAt: NOW - 60,
    purpose: 'Pay invoice #1042.',
    reason: 'Recipient is not on the approved list.',
    tokenMeta: { symbol: 'DEMO', decimals: 6 },
    typed: typed ?? {
      kind: 'erc20_transfer',
      token: TOKEN,
      recipient: RECIPIENT,
      amountBaseUnits: '25000000',
    },
    operation: {
      account: ACCOUNT,
      agent: AGENT,
      chainId: CHAIN,
      nonce: '7',
      expiresAt: NOW + 3_600,
      target: TOKEN,
      value: '0',
      data: encodeCall('0xa9059cbb', RECIPIENT, 25_000_000n),
      ...operation,
    },
    ...overrides,
  };
}

export function validated(raw: Raw = rawRequest(), ctx: ParseContext = CTX): ValidatedRequest {
  const result = parseRequest(raw, ctx);
  if (!result.ok) {
    throw new Error(
      `fixture invalid: ${result.issues.map((i) => `${i.code}@${i.path}`).join(', ')}`,
    );
  }
  return result.value;
}

/** Valid request with a distinct id and nonce. */
export function numbered(n: number, operation: Raw = {}): ValidatedRequest {
  return validated(rawRequest({ requestId: `req-${n}` }, { nonce: String(n), ...operation }));
}

export function storeWith(...requests: ValidatedRequest[]): RequestStore {
  let store: RequestStore = {};
  for (const request of requests) {
    const result = submit(store, request, NOW);
    if (result.kind !== 'created') throw new Error(`fixture not created: ${result.kind}`);
    store = result.store;
  }
  return store;
}

export function recordOf(store: RequestStore, id: string): RequestRecord {
  const record = store[id];
  if (!record) throw new Error(`no record ${id}`);
  return record;
}
