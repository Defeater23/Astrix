import { describe, expect, it } from 'vitest';
import {
  MAX_APPROVAL_LIFETIME_SECONDS,
  SINGLE_CALL_MODE,
  approvalDigest,
  approvalTypedData,
  buildApprovalMessage,
  digestOfMessage,
  encodeSingleExecution,
  executeCallData,
  executionHashOf,
  operationIdOf,
} from './typedData';
import {
  ACCOUNT,
  AGENT,
  NOW,
  RECIPIENT,
  TOKEN,
  encodeCall,
  numbered,
  rawRequest,
  validated,
} from '../requests/fixtures';

const CONTRACT = '0x00000000000000000000000000000000000d0b01';

function word(n: bigint): string {
  return `0x${n.toString(16).padStart(64, '0')}`;
}

describe('owner approval typed data', () => {
  it('known-answer digest (shared with contracts/test/SentinelOwnerApproval.t.sol)', () => {
    const digest = digestOfMessage(
      {
        account: ACCOUNT as `0x${string}`,
        agent: AGENT as `0x${string}`,
        operationId: word(0x1234n) as `0x${string}`,
        userOpNonce: 7n,
        executionHash: word(0xabcdefn) as `0x${string}`,
        expiry: 1_800_003_600n,
      },
      11155111,
      CONTRACT,
    );
    expect(digest).toBe('0x3905f6b2a64b9bad16a29dc729cc715d3759ebb0e6f5767e827df2066e54e3c1');
  });

  it('encodes the single call exactly as Kernel decodes it (target, value, data)', () => {
    const op = validated().request.operation;
    const packed = encodeSingleExecution(op);
    // 20 bytes target + 32 bytes value + calldata
    expect(packed.length).toBe(2 + 2 * (20 + 32 + (op.data.length - 2) / 2));
    expect(packed.startsWith(op.target)).toBe(true);
  });

  it('wraps it in execute(bytes32,bytes) with the all-zero single-call mode', () => {
    const op = validated().request.operation;
    const data = executeCallData(op);
    const selector = data.slice(0, 10);
    expect(selector).toBe('0xe9ae5c53'); // execute(bytes32,bytes)
    expect(data.slice(10, 10 + 64)).toBe('00'.repeat(32));
    expect(SINGLE_CALL_MODE).toBe(`0x${'00'.repeat(32)}`);
  });

  it('binds every material operation field into the execution hash', () => {
    const transfer = (token: string, amount: bigint) =>
      validated(
        rawRequest(
          {},
          { target: token, data: encodeCall('0xa9059cbb', RECIPIENT, amount) },
          {
            kind: 'erc20_transfer',
            token,
            recipient: RECIPIENT,
            amountBaseUnits: amount.toString(),
          },
        ),
      ).request.operation;
    const base = executionHashOf(transfer(TOKEN, 25_000_000n));
    expect(executionHashOf(transfer(TOKEN, 25_000_000n))).toBe(base);
    expect(executionHashOf(transfer(TOKEN, 25_000_001n))).not.toBe(base); // amount
    expect(executionHashOf(transfer('0x00000000000000000000000000000000000d0c02', 25_000_000n))).not.toBe(
      base,
    ); // target
  });

  it('binds native value into the execution hash', () => {
    const a = validated(
      rawRequest(
        {},
        { target: '0x00000000000000000000000000000000000d0e01', value: '1000', data: '0x' },
        { kind: 'native_transfer', recipient: '0x00000000000000000000000000000000000d0e01', amountWei: '1000' },
      ),
    ).request.operation;
    const b = { ...a, value: '1001' };
    expect(executionHashOf(a)).not.toBe(executionHashOf(b));
  });

  it('builds the message from the request, not from caller-supplied fields', () => {
    const request = validated().request;
    const m = buildApprovalMessage(request);
    expect(m.account).toBe(request.operation.account);
    expect(m.agent).toBe(request.operation.agent);
    expect(m.userOpNonce).toBe(7n);
    expect(m.expiry).toBe(BigInt(request.operation.expiresAt));
    expect(m.executionHash).toBe(executionHashOf(request.operation));
    expect(m.operationId).toBe(operationIdOf(request));
  });

  it('derives a distinct operationId per request, chain and account', () => {
    const a = numbered(1).request;
    const b = numbered(2).request;
    expect(operationIdOf(a)).not.toBe(operationIdOf(b));
    const otherChain = validated(rawRequest({}, { chainId: 31337 })).request;
    expect(operationIdOf(validated().request)).not.toBe(operationIdOf(otherChain));
  });

  it('puts the chain and verifying contract in the domain', () => {
    const typed = approvalTypedData(validated().request, CONTRACT);
    expect(typed.domain.chainId).toBe(11155111);
    expect(typed.domain.verifyingContract).toBe(CONTRACT);
    expect(typed.domain.name).toBe('SentinelOwnerApproval');
    expect(typed.domain.version).toBe('1');
  });

  it('changes the digest when any bound element changes', () => {
    const r = validated().request;
    const base = approvalDigest(r, CONTRACT);
    expect(approvalDigest(r, '0x00000000000000000000000000000000000d0b02')).not.toBe(base);
    const variants: Array<Record<string, unknown>> = [
      { nonce: '8' },
      { expiresAt: NOW + 7_200 },
      { chainId: 31337 },
      { agent: '0x00000000000000000000000000000000000d0a02' },
      { account: '0x00000000000000000000000000000000000d0002' },
    ];
    for (const v of variants) {
      const changed = validated(rawRequest({}, v)).request;
      expect(approvalDigest(changed, CONTRACT)).not.toBe(base);
    }
    expect(approvalDigest(validated(rawRequest({ requestId: 'req-2' })).request, CONTRACT)).not.toBe(
      base,
    );
  });

  it('matches the contract lifetime limit of seven days', () => {
    expect(MAX_APPROVAL_LIFETIME_SECONDS).toBe(604_800);
  });
});
