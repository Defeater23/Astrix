import { describe, expect, it } from 'vitest';
import { buildDemoRequests, DEMO_TOKEN, encodeAddressUint } from './demoData';
import { describeOperation } from './decode';
import type { ApprovalRequest } from './types';

const CTX = { connectedChainId: 11155111, nativeSymbol: 'ETH' };
const NOW = 1_800_000_000;
const RECIPIENT = '0x00000000000000000000000000000000000d0e01';

function request(overrides: Partial<ApprovalRequest['operation']> = {}): ApprovalRequest {
  return {
    id: 'r1',
    createdAt: NOW,
    purpose: 'p',
    reason: 'r',
    operation: {
      account: '0x00000000000000000000000000000000000d0001',
      agent: '0x00000000000000000000000000000000000d0a01',
      chainId: 11155111,
      nonce: '1',
      expiresAt: NOW + 3_600,
      target: DEMO_TOKEN,
      value: '0',
      data: encodeAddressUint('0xa9059cbb', RECIPIENT, 25_000_000n),
      ...overrides,
    },
  };
}

describe('describeOperation', () => {
  it('decodes an ERC-20 transfer exactly and does not invent decimals', () => {
    const d = describeOperation(request(), CTX);
    expect(d.kind).toBe('erc20_transfer');
    expect(d.recipient).toBe(RECIPIENT);
    expect(d.token).toBe(DEMO_TOKEN);
    expect(d.amountBaseUnits).toBe('25000000');
    expect(d.amountDisplay).toBeUndefined();
    expect(d.amountNote).toMatch(/decimals are unknown/i);
    expect(d.functionName).toBe('transfer(address,uint256)');
  });

  it('formats with request metadata and says it is not verified on-chain', () => {
    const r = { ...request(), tokenMeta: { symbol: 'DEMO', decimals: 6 } };
    const d = describeOperation(r, CTX);
    expect(d.amountDisplay).toBe('25 DEMO');
    expect(d.amountBaseUnits).toBe('25000000');
    expect(d.amountNote).toMatch(/not verified on-chain/i);
  });

  it('describes a native transfer in wei', () => {
    const d = describeOperation(request({ data: '0x', value: '50000000000000000', target: RECIPIENT }), CTX);
    expect(d.kind).toBe('native_transfer');
    expect(d.recipient).toBe(RECIPIENT);
    expect(d.amountBaseUnits).toBe('50000000000000000');
    expect(d.amountDisplay).toBe('0.05 ETH');
  });

  it('flags a zero native transfer', () => {
    const d = describeOperation(request({ data: '0x', value: '0' }), CTX);
    expect(d.warnings.join(' ')).toMatch(/transfers nothing/i);
  });

  it('flags approve as an allowance grant', () => {
    const d = describeOperation(
      request({ data: encodeAddressUint('0x095ea8b0', RECIPIENT, 1n) }),
      CTX,
    );
    expect(d.kind).toBe('erc20_approve');
    expect(d.warnings.join(' ')).toMatch(/spending allowance/i);
  });

  it('shows unknown selectors as undecoded raw calls', () => {
    const d = describeOperation(request({ data: '0x12345678aabb' }), CTX);
    expect(d.kind).toBe('contract_call');
    expect(d.decoded).toBe(false);
    expect(d.selector).toBe('0x12345678');
    expect(d.calldataBytes).toBe(6);
  });

  it('rejects truncated known-selector calldata instead of repairing it', () => {
    const data = encodeAddressUint('0xa9059cbb', RECIPIENT, 5n).slice(0, 80);
    const d = describeOperation(request({ data }), CTX);
    expect(d.kind).toBe('malformed_call');
    expect(d.recipient).toBeUndefined();
    expect(d.amountBaseUnits).toBeUndefined();
  });

  it('rejects an address argument with dirty upper bytes', () => {
    const dirty = `0xa9059cbb${'11'.repeat(32)}${'00'.repeat(31)}01`;
    const d = describeOperation(request({ data: dirty }), CTX);
    expect(d.kind).toBe('malformed_call');
    expect(d.warnings.join(' ')).toMatch(/upper bytes/i);
  });

  it('treats calldata shorter than a selector as malformed', () => {
    expect(describeOperation(request({ data: '0x1234' }), CTX).kind).toBe('malformed_call');
  });

  it('warns on a chain mismatch, native value on a token call and self-targeting', () => {
    const mismatch = describeOperation(request({ chainId: 31337 }), CTX);
    expect(mismatch.warnings.join(' ')).toMatch(/chain ID 31337 but the wallet is on chain ID 11155111/);
    const value = describeOperation(request({ value: '1' }), CTX);
    expect(value.warnings.join(' ')).toMatch(/native value is attached/i);
    const self = describeOperation(
      request({ target: '0x00000000000000000000000000000000000D0001' }),
      CTX,
    );
    expect(self.warnings.join(' ')).toMatch(/smart account itself/i);
  });

  it('describes every demo fixture without throwing', () => {
    const requests = buildDemoRequests({ owner: '0x1', chainId: 11155111 }, NOW);
    expect(requests).toHaveLength(7);
    const kinds = requests.map((r) => describeOperation(r, CTX).kind);
    expect(kinds).toEqual([
      'erc20_transfer',
      'native_transfer',
      'contract_call',
      'erc20_approve',
      'native_transfer',
      'native_transfer',
      'malformed_call',
    ]);
  });
});
