import { describe, expect, it } from 'vitest';
import { describeOperation } from '../approvals/decode';
import { buildDemoRequests } from '../approvals/demoData';
import {
  CLOCK_SKEW_SECONDS,
  MAX_TTL_SECONDS,
  deriveTyped,
  parseRequest,
  requestFingerprint,
  TEXT_MAX_LENGTH,
} from './schema';
import {
  ACCOUNT,
  CONTRACT,
  CTX,
  NOW,
  OWNER,
  RECIPIENT,
  SPENDER,
  TOKEN,
  encodeCall,
  rawRequest,
  validated,
} from './fixtures';
import type { ValidationCode } from './types';

function codes(raw: unknown, ctx = CTX): ValidationCode[] {
  const result = parseRequest(raw, ctx);
  return result.ok ? [] : result.issues.map((i) => i.code);
}

const ZERO = `0x${'0'.repeat(40)}`;

describe('parseRequest: valid requests', () => {
  it('accepts an ERC-20 transfer and normalizes addresses to lowercase', () => {
    const upper = '0x00000000000000000000000000000000000D0E01';
    const raw = rawRequest(
      { owner: '0x00000000000000000000000000000000000A0001' },
      {},
      { kind: 'erc20_transfer', token: TOKEN, recipient: upper, amountBaseUnits: '25000000' },
    );
    const result = parseRequest(raw, CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.request.owner).toBe(OWNER);
      expect(result.value.request.typed).toMatchObject({
        kind: 'erc20_transfer',
        recipient: RECIPIENT,
      });
      expect(result.value.warnings).toEqual([]);
    }
  });

  it('accepts a native transfer', () => {
    const raw = rawRequest(
      { tokenMeta: undefined },
      { target: RECIPIENT, value: '1000', data: '0x' },
      { kind: 'native_transfer', recipient: RECIPIENT, amountWei: '1000' },
    );
    expect(codes(raw)).toEqual([]);
  });

  it('accepts an ERC-20 approve and warns on an unlimited allowance', () => {
    const max = (1n << 256n) - 1n;
    const raw = rawRequest(
      {},
      { data: encodeCall('0x095ea8b0', SPENDER, max) },
      { kind: 'erc20_approve', token: TOKEN, spender: SPENDER, amountBaseUnits: max.toString() },
    );
    const result = parseRequest(raw, CTX);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.warnings.map((w) => w.code)).toEqual(['UNLIMITED_ALLOWANCE']);
  });

  it('allows approving zero (revoking an allowance)', () => {
    const raw = rawRequest(
      {},
      { data: encodeCall('0x095ea8b0', SPENDER, 0n) },
      { kind: 'erc20_approve', token: TOKEN, spender: SPENDER, amountBaseUnits: '0' },
    );
    expect(codes(raw)).toEqual([]);
  });

  it('accepts an undecoded contract call with a warning', () => {
    const data = `0x12345678${'0'.repeat(63)}1`;
    const raw = rawRequest(
      { tokenMeta: undefined },
      { target: CONTRACT, data, value: '5' },
      { kind: 'contract_call', target: CONTRACT, selector: '0x12345678', valueWei: '5' },
    );
    const result = parseRequest(raw, CTX);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warnings.map((w) => w.code)).toEqual(['UNDECODED_CALLDATA']);
  });

  it('works without tokenMeta', () => {
    expect(codes(rawRequest({ tokenMeta: undefined }))).toEqual([]);
  });
});

describe('parseRequest: structure', () => {
  it.each([null, undefined, 5, 'x', [], true])('rejects non-object %p', (value) => {
    expect(codes(value)).toEqual(['MALFORMED']);
  });

  it('rejects unknown fields at every level', () => {
    expect(codes(rawRequest({ extra: 1 }))).toContain('UNKNOWN_FIELD');
    expect(codes(rawRequest({}, { extra: 1 }))).toContain('UNKNOWN_FIELD');
    expect(codes(rawRequest({ tokenMeta: { symbol: 'D', decimals: 1, x: 1 } }))).toContain(
      'UNKNOWN_FIELD',
    );
    expect(
      codes(
        rawRequest(
          {},
          {},
          {
            kind: 'erc20_transfer',
            token: TOKEN,
            recipient: RECIPIENT,
            amountBaseUnits: '25000000',
            memo: 'x',
          },
        ),
      ),
    ).toContain('UNKNOWN_FIELD');
  });

  it('rejects a missing or wrong schema version', () => {
    expect(codes(rawRequest({ schemaVersion: 2 }))).toContain('UNSUPPORTED_SCHEMA_VERSION');
    expect(codes(rawRequest({ schemaVersion: undefined }))).toContain('UNSUPPORTED_SCHEMA_VERSION');
  });

  it.each(['', ' a', 'a b', '-a', 'a'.repeat(65), 'a/b', 'ä'])('rejects request id %p', (id) => {
    expect(codes(rawRequest({ requestId: id }))).toContain('INVALID_REQUEST_ID');
  });

  it('accepts a 64-character request id', () => {
    expect(codes(rawRequest({ requestId: 'a'.repeat(64) }))).toEqual([]);
  });

  it('reports every problem at once', () => {
    const result = parseRequest(rawRequest({ owner: 'x', requestId: '' }, { nonce: '-1' }), CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe('parseRequest: addresses, numbers, chain', () => {
  it.each([['owner', 'INVALID_OWNER']] as const)('rejects a bad %s', (field, code) => {
    expect(codes(rawRequest({ [field]: '0x123' }))).toContain(code);
  });

  it('rejects bad account, agent and target', () => {
    expect(codes(rawRequest({}, { account: '0x12' }))).toContain('INVALID_ACCOUNT');
    expect(codes(rawRequest({}, { agent: 'nope' }))).toContain('INVALID_AGENT');
    expect(codes(rawRequest({}, { target: '0x' + 'g'.repeat(40) }))).toContain('INVALID_TARGET');
  });

  it.each(['', '-1', '01', '1.5', '1e3', ' 1', '0x1', (1n << 256n).toString()])(
    'rejects nonce %p',
    (nonce) => {
      expect(codes(rawRequest({}, { nonce }))).toContain('INVALID_NONCE');
    },
  );

  it('accepts the largest uint256 nonce', () => {
    expect(codes(rawRequest({}, { nonce: ((1n << 256n) - 1n).toString() }))).toEqual([]);
  });

  it('rejects a numeric (non-string) nonce or value', () => {
    expect(codes(rawRequest({}, { nonce: 7 }))).toContain('INVALID_NONCE');
    expect(codes(rawRequest({}, { value: 0 }))).toContain('INVALID_VALUE');
  });

  it.each([0, -1, 1.5, 1, 1337, Number.NaN, '11155111'])(
    'rejects unsupported chain %p',
    (chainId) => {
      expect(codes(rawRequest({}, { chainId }))).toContain('UNSUPPORTED_CHAIN');
    },
  );

  it('accepts the other supported chain', () => {
    expect(codes(rawRequest({}, { chainId: 31337 }))).toEqual([]);
  });

  it.each(['0x1', '0xabc', 'abcd', '0xzz', 5, null])('rejects calldata %p', (data) => {
    expect(codes(rawRequest({}, { data }))).toContain('INVALID_CALLDATA');
  });

  it('rejects calldata shorter than a selector', () => {
    const raw = rawRequest(
      {},
      { data: '0x1234', value: '0' },
      {
        kind: 'contract_call',
        target: TOKEN,
        selector: '0x12340000',
        valueWei: '0',
      },
    );
    expect(codes(raw)).toContain('INVALID_CALLDATA');
  });

  it('rejects truncated or dirty ERC-20 calldata instead of guessing', () => {
    const good = encodeCall('0xa9059cbb', RECIPIENT, 5n);
    expect(codes(rawRequest({}, { data: good.slice(0, 80) }))).toContain('INVALID_CALLDATA');
    const dirty = `0xa9059cbb${'f'.repeat(24)}${RECIPIENT.slice(2)}${'0'.repeat(63)}5`;
    expect(codes(rawRequest({}, { data: dirty }))).toContain('INVALID_CALLDATA');
  });
});

describe('parseRequest: time', () => {
  it('rejects an expired request, and only when time is checked', () => {
    const raw = rawRequest({}, { expiresAt: NOW });
    expect(codes(raw)).toContain('EXPIRED');
    expect(codes(raw, { ...CTX, checkTime: false })).not.toContain('EXPIRED');
  });

  it('rejects expiry at or before creation', () => {
    expect(
      codes(rawRequest({ createdAt: NOW - 10 }, { expiresAt: NOW - 10 }), {
        ...CTX,
        checkTime: false,
      }),
    ).toContain('EXPIRES_BEFORE_CREATION');
    expect(
      codes(rawRequest({ createdAt: NOW - 10 }, { expiresAt: NOW - 20 }), {
        ...CTX,
        checkTime: false,
      }),
    ).toContain('EXPIRES_BEFORE_CREATION');
  });

  it('enforces the maximum time to live, even when time is not checked', () => {
    const created = NOW - 10;
    expect(
      codes(rawRequest({ createdAt: created }, { expiresAt: created + MAX_TTL_SECONDS })),
    ).toEqual([]);
    const over = rawRequest({ createdAt: created }, { expiresAt: created + MAX_TTL_SECONDS + 1 });
    expect(codes(over)).toContain('TTL_TOO_LONG');
    expect(codes(over, { ...CTX, checkTime: false })).toContain('TTL_TOO_LONG');
  });

  it('rejects creation times in the future beyond the skew allowance', () => {
    expect(
      codes(rawRequest({ createdAt: NOW + CLOCK_SKEW_SECONDS }, { expiresAt: NOW + 4_000 })),
    ).toEqual([]);
    expect(
      codes(rawRequest({ createdAt: NOW + CLOCK_SKEW_SECONDS + 1 }, { expiresAt: NOW + 4_000 })),
    ).toContain('CREATED_IN_FUTURE');
  });

  it.each([-1, 1.5, '5', null, Number.MAX_SAFE_INTEGER + 2])('rejects timestamp %p', (value) => {
    expect(codes(rawRequest({ createdAt: value }))).toContain('INVALID_TIMESTAMP');
    expect(codes(rawRequest({}, { expiresAt: value }))).toContain('INVALID_TIMESTAMP');
  });
});

describe('parseRequest: text and token metadata', () => {
  it('limits text length', () => {
    expect(codes(rawRequest({ purpose: 'a'.repeat(TEXT_MAX_LENGTH) }))).toEqual([]);
    expect(codes(rawRequest({ purpose: 'a'.repeat(TEXT_MAX_LENGTH + 1) }))).toContain(
      'INVALID_TEXT',
    );
    expect(codes(rawRequest({ reason: 5 }))).toContain('INVALID_TEXT');
  });

  it('rejects control and direction-override characters', () => {
    expect(codes(rawRequest({ purpose: 'line\nbreak' }))).toContain('INVALID_TEXT');
    expect(codes(rawRequest({ reason: 'a‮b' }))).toContain('INVALID_TEXT');
    expect(codes(rawRequest({ reason: 'a⁦b' }))).toContain('INVALID_TEXT');
    expect(codes(rawRequest({ purpose: 'a\u0000b' }))).toContain('INVALID_TEXT');
  });

  it('accepts ordinary Unicode text', () => {
    expect(codes(rawRequest({ purpose: 'Zahlung für Rechnung 5 – danke' }))).toEqual([]);
  });

  it('validates token metadata', () => {
    for (const meta of [
      null,
      {},
      { symbol: '', decimals: 6 },
      { symbol: 'X'.repeat(21), decimals: 6 },
      { symbol: 'D', decimals: -1 },
      { symbol: 'D', decimals: 37 },
      { symbol: 'D', decimals: 1.5 },
      { symbol: 'D\n', decimals: 6 },
    ]) {
      expect(codes(rawRequest({ tokenMeta: meta }))).toContain('INVALID_TOKEN_META');
    }
  });
});

describe('parseRequest: prohibited operations', () => {
  it('rejects zero addresses', () => {
    expect(codes(rawRequest({ owner: ZERO }))).toContain('PROHIBITED_ZERO_ADDRESS');
    expect(codes(rawRequest({}, { account: ZERO }))).toContain('PROHIBITED_ZERO_ADDRESS');
    expect(codes(rawRequest({}, { agent: ZERO }))).toContain('PROHIBITED_ZERO_ADDRESS');
    expect(codes(rawRequest({}, { target: ZERO }))).toContain('PROHIBITED_ZERO_ADDRESS');
  });

  it('rejects a token transfer to the zero address', () => {
    const raw = rawRequest(
      {},
      { data: encodeCall('0xa9059cbb', ZERO, 5n) },
      { kind: 'erc20_transfer', token: TOKEN, recipient: ZERO, amountBaseUnits: '5' },
    );
    expect(codes(raw)).toContain('PROHIBITED_ZERO_ADDRESS');
  });

  it('rejects a zero-address spender', () => {
    const raw = rawRequest(
      {},
      { data: encodeCall('0x095ea8b0', ZERO, 5n) },
      { kind: 'erc20_approve', token: TOKEN, spender: ZERO, amountBaseUnits: '5' },
    );
    expect(codes(raw)).toContain('PROHIBITED_ZERO_ADDRESS');
  });

  it('rejects an operation targeting the smart account itself', () => {
    const raw = rawRequest(
      { tokenMeta: undefined },
      { target: ACCOUNT, data: '0x', value: '1' },
      { kind: 'native_transfer', recipient: ACCOUNT, amountWei: '1' },
    );
    expect(codes(raw)).toContain('PROHIBITED_SELF_TARGET');
  });

  it('rejects native value attached to a token call', () => {
    expect(codes(rawRequest({}, { value: '1' }))).toContain('PROHIBITED_TOKEN_CALL_WITH_VALUE');
  });

  it('rejects zero-amount transfers', () => {
    const token = rawRequest(
      {},
      { data: encodeCall('0xa9059cbb', RECIPIENT, 0n) },
      { kind: 'erc20_transfer', token: TOKEN, recipient: RECIPIENT, amountBaseUnits: '0' },
    );
    expect(codes(token)).toContain('PROHIBITED_ZERO_AMOUNT');
    const native = rawRequest(
      { tokenMeta: undefined },
      { target: RECIPIENT, data: '0x', value: '0' },
      { kind: 'native_transfer', recipient: RECIPIENT, amountWei: '0' },
    );
    expect(codes(native)).toContain('PROHIBITED_ZERO_AMOUNT');
  });
});

describe('parseRequest: typed description must match the exact payload', () => {
  it('rejects a declared amount that differs from the calldata', () => {
    const raw = rawRequest(
      {},
      {},
      {
        kind: 'erc20_transfer',
        token: TOKEN,
        recipient: RECIPIENT,
        amountBaseUnits: '1',
      },
    );
    const result = parseRequest(raw, CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.path)).toContain('typed.amountBaseUnits');
    }
  });

  it('rejects a declared recipient that differs from the calldata', () => {
    const raw = rawRequest(
      {},
      {},
      {
        kind: 'erc20_transfer',
        token: TOKEN,
        recipient: SPENDER,
        amountBaseUnits: '25000000',
      },
    );
    expect(codes(raw)).toContain('KIND_MISMATCH');
  });

  it('rejects a declared token that differs from the target', () => {
    const raw = rawRequest(
      {},
      {},
      {
        kind: 'erc20_transfer',
        token: CONTRACT,
        recipient: RECIPIENT,
        amountBaseUnits: '25000000',
      },
    );
    expect(codes(raw)).toContain('KIND_MISMATCH');
  });

  it('rejects a kind that the calldata does not encode', () => {
    expect(
      codes(
        rawRequest(
          {},
          {},
          { kind: 'erc20_approve', token: TOKEN, spender: RECIPIENT, amountBaseUnits: '25000000' },
        ),
      ),
    ).toContain('KIND_MISMATCH');
    expect(
      codes(rawRequest({}, {}, { kind: 'native_transfer', recipient: TOKEN, amountWei: '0' })),
    ).toContain('KIND_MISMATCH');
  });

  it('rejects a token call disguised as a generic contract call', () => {
    const raw = rawRequest(
      {},
      {},
      {
        kind: 'contract_call',
        target: TOKEN,
        selector: '0xa9059cbb',
        valueWei: '0',
      },
    );
    expect(codes(raw)).toContain('KIND_MISMATCH');
  });

  it('rejects a native transfer declared for calldata-carrying operations and vice versa', () => {
    const raw = rawRequest(
      { tokenMeta: undefined },
      { target: CONTRACT, data: '0x12345678', value: '0' },
      { kind: 'native_transfer', recipient: CONTRACT, amountWei: '0' },
    );
    expect(codes(raw)).toContain('KIND_MISMATCH');
  });

  it('rejects a contract call selector that differs from the calldata', () => {
    const raw = rawRequest(
      { tokenMeta: undefined },
      { target: CONTRACT, data: '0x12345678', value: '0' },
      { kind: 'contract_call', target: CONTRACT, selector: '0x87654321', valueWei: '0' },
    );
    expect(codes(raw)).toContain('KIND_MISMATCH');
  });

  it('rejects malformed typed objects', () => {
    for (const typed of [
      null,
      {},
      { kind: 'swap' },
      { kind: 'erc20_transfer', token: 'x', recipient: RECIPIENT, amountBaseUnits: '1' },
      { kind: 'erc20_transfer', token: TOKEN, recipient: RECIPIENT, amountBaseUnits: 1 },
      { kind: 'contract_call', target: CONTRACT, selector: '0x12', valueWei: '0' },
    ]) {
      expect(codes(rawRequest({ typed }))).toContain('INVALID_TYPED_OPERATION');
    }
  });

  it('rejects when typed is absent', () => {
    expect(codes(rawRequest({ typed: undefined }))).toContain('INVALID_TYPED_OPERATION');
  });
});

describe('requestFingerprint', () => {
  const base = validated().request;

  it('is stable and case-insensitive for addresses and hex', () => {
    const shouting = {
      ...base,
      owner: base.owner.toUpperCase().replace('0X', '0x'),
      operation: { ...base.operation, data: base.operation.data.toUpperCase().replace('0X', '0x') },
    };
    expect(requestFingerprint(shouting)).toBe(requestFingerprint(base));
  });

  it('changes when any material field changes', () => {
    const variants = [
      { ...base, requestId: 'other' },
      { ...base, owner: SPENDER },
      { ...base, createdAt: base.createdAt + 1 },
      { ...base, purpose: 'different' },
      { ...base, reason: 'different' },
      { ...base, tokenMeta: { symbol: 'DEMO', decimals: 18 } },
      { ...base, tokenMeta: undefined },
      { ...base, operation: { ...base.operation, account: SPENDER } },
      { ...base, operation: { ...base.operation, agent: SPENDER } },
      { ...base, operation: { ...base.operation, chainId: 31337 } },
      { ...base, operation: { ...base.operation, nonce: '8' } },
      { ...base, operation: { ...base.operation, expiresAt: base.operation.expiresAt + 1 } },
      { ...base, operation: { ...base.operation, target: SPENDER } },
      { ...base, operation: { ...base.operation, value: '1' } },
      {
        ...base,
        operation: { ...base.operation, data: encodeCall('0xa9059cbb', RECIPIENT, 25_000_001n) },
      },
    ];
    const seen = new Set([requestFingerprint(base)]);
    for (const variant of variants) seen.add(requestFingerprint(variant));
    expect(seen.size).toBe(variants.length + 1);
  });
});

describe('deriveTyped agrees with the 7A review decoder', () => {
  it('matches describeOperation for every displayable demo request', () => {
    const demo = buildDemoRequests({ owner: OWNER, chainId: 11155111 }, NOW);
    let compared = 0;
    for (const request of demo) {
      const described = describeOperation(request, {
        connectedChainId: 11155111,
        nativeSymbol: 'ETH',
      });
      const derived = deriveTyped(request.operation);
      if (described.kind === 'malformed_call') {
        expect(derived.ok).toBe(false);
        continue;
      }
      expect(derived.ok).toBe(true);
      if (derived.ok) {
        expect(derived.typed.kind).toBe(described.kind);
        if (derived.typed.kind === 'erc20_transfer' || derived.typed.kind === 'erc20_approve') {
          expect(derived.typed.amountBaseUnits).toBe(described.amountBaseUnits);
        }
      }
      compared += 1;
    }
    expect(compared).toBeGreaterThanOrEqual(5);
  });
});
