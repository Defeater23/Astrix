import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONTEXT, ACCOUNT, EVIL, RECIPIENT, USDC } from './fixtures.js';
import { interpretModelOutput } from './modelOutput.js';
import type { InterpretedOutput } from './modelOutput.js';

const MAX = 8_000;
const run = (output: unknown): InterpretedOutput =>
  interpretModelOutput(typeof output === 'string' ? output : JSON.stringify(output), CONTEXT, MAX);

const nativeOutput = {
  outcome: 'proposal',
  operation: 'native_transfer',
  asset: 'ETH',
  recipient: RECIPIENT,
  amount: '0.5',
  purpose: 'Pay the invoice',
};
const tokenOutput = {
  outcome: 'proposal',
  operation: 'erc20_transfer',
  asset: 'USDC',
  recipient: RECIPIENT,
  amount: '25.5',
  purpose: 'Pay the invoice',
};
const approveOutput = {
  outcome: 'proposal',
  operation: 'erc20_approve',
  asset: 'USDC',
  spender: RECIPIENT,
  amount: '100',
  purpose: 'Allow the exchange',
};

function codes(result: InterpretedOutput): string[] {
  return result.messages.map((message) => message.code);
}

describe('valid model output', () => {
  it('builds a native transfer in exact wei', () => {
    const result = run(nativeOutput);
    assert.equal(result.status, 'proposed');
    if (result.status !== 'proposed') return;
    assert.deepEqual(result.operation, { kind: 'native_transfer', recipient: RECIPIENT, amountWei: '500000000000000000' });
    assert.deepEqual(result.asset, { type: 'native', symbol: 'ETH', decimals: 18 });
    assert.equal(result.purpose, 'Pay the invoice');
  });

  it('builds a token transfer using the TRUSTED address and decimals', () => {
    const result = run(tokenOutput);
    assert.equal(result.status, 'proposed');
    if (result.status !== 'proposed') return;
    assert.deepEqual(result.operation, { kind: 'erc20_transfer', token: USDC, recipient: RECIPIENT, amountBaseUnits: '25500000' });
    assert.deepEqual(result.asset, { type: 'erc20', symbol: 'USDC', decimals: 6, address: USDC });
  });

  it('builds a token allowance', () => {
    const result = run(approveOutput);
    assert.equal(result.status, 'proposed');
    if (result.status !== 'proposed') return;
    assert.deepEqual(result.operation, { kind: 'erc20_approve', token: USDC, spender: RECIPIENT, amountBaseUnits: '100000000' });
  });

  it('normalises addresses to lowercase', () => {
    const mixed = '0x' + 'AbCdEf'.repeat(6) + 'abcd';
    const result = run({ ...nativeOutput, recipient: mixed });
    assert.equal(result.status, 'proposed');
    if (result.status === 'proposed' && result.operation.kind === 'native_transfer') {
      assert.equal(result.operation.recipient, mixed.toLowerCase());
    }
  });

  it('accepts a single fenced JSON block, and a matching echoed chain and token address', () => {
    const fenced = '```json\n' + JSON.stringify({ ...tokenOutput, chainId: CONTEXT.chainId, tokenAddress: USDC.toUpperCase().replace('0X', '0x') }) + '\n```';
    assert.equal(run(fenced).status, 'proposed');
  });

  it('warns about an unlimited allowance but still proposes it', () => {
    const whole = (2n ** 256n - 1n).toString();
    const exact = `${whole.slice(0, -6)}.${whole.slice(-6)}`; // 6 decimals: max uint256 base units
    const result = run({ ...approveOutput, amount: exact });
    assert.equal(result.status, 'proposed');
    assert.ok(codes(result).includes('UNLIMITED_ALLOWANCE'));
  });
});

describe('malformed output', () => {
  it('rejects non-JSON, prose around JSON, arrays and non-objects', () => {
    for (const text of ['', 'hello', 'Sure! ' + JSON.stringify(nativeOutput), JSON.stringify(nativeOutput) + ' hope this helps', '[1,2]', '"x"', '42', 'null', '{not json}', '{"a":1', '```\n{"a":1}\n``` extra']) {
      const result = run(text);
      assert.equal(result.status, 'invalid', `expected invalid for ${JSON.stringify(text)}`);
    }
    assert.deepEqual(codes(run('hello')), ['OUTPUT_NOT_JSON']);
  });

  it('rejects non-string provider text', () => {
    for (const bad of [undefined, null, 7, {}]) {
      assert.equal(interpretModelOutput(bad, CONTEXT, MAX).status, 'invalid');
    }
  });

  it('rejects oversized output', () => {
    const result = interpretModelOutput(JSON.stringify({ ...nativeOutput, purpose: 'x'.repeat(9_000) }), CONTEXT, MAX);
    assert.deepEqual(codes(result), ['OUTPUT_TOO_LARGE']);
  });

  it('reports every missing field at once', () => {
    const result = run({ outcome: 'proposal', operation: 'native_transfer' });
    assert.equal(result.status, 'invalid');
    const missing = result.messages.filter((m) => m.code === 'OUTPUT_MISSING_FIELD').map((m) => m.path);
    assert.deepEqual(missing.sort(), ['amount', 'asset', 'purpose', 'recipient']);
  });

  it('rejects a missing or unknown outcome', () => {
    assert.equal(run({ operation: 'native_transfer' }).status, 'invalid');
    assert.equal(run({ outcome: 'maybe' }).status, 'invalid');
  });

  it('rejects wrong field types without coercing them', () => {
    assert.equal(run({ ...nativeOutput, amount: 0.5 }).status, 'invalid');
    assert.equal(run({ ...nativeOutput, recipient: 123 }).status, 'invalid');
    assert.equal(run({ ...nativeOutput, asset: ['ETH'] }).status, 'invalid');
    assert.equal(run({ ...nativeOutput, purpose: 5 }).status, 'invalid');
    assert.equal(run({ ...nativeOutput, operation: 5 }).status, 'invalid');
  });
});

describe('security-critical fields are never repaired or accepted from the model', () => {
  it('rejects fields the model must not set (account, nonce, expiry, calldata, owner)', () => {
    for (const extra of [
      { account: EVIL },
      { agent: EVIL },
      { owner: EVIL },
      { nonce: '0' },
      { expiresAt: 4_000_000_000 },
      { data: '0xdeadbeef' },
      { target: EVIL },
      { value: '1' },
      { decimals: 0 },
      { approved: true },
      { confidence: 0.99 },
    ]) {
      const result = run({ ...nativeOutput, ...extra });
      assert.equal(result.status, 'invalid', `expected rejection of ${Object.keys(extra)[0]}`);
      assert.ok(codes(result).includes('OUTPUT_UNKNOWN_FIELD'));
    }
  });

  it('rejects a __proto__ key instead of ignoring it', () => {
    const result = run('{"outcome":"proposal","operation":"native_transfer","asset":"ETH","recipient":"' + RECIPIENT + '","amount":"1","purpose":"x","__proto__":{"admin":true}}');
    assert.equal(result.status, 'invalid');
    assert.ok(codes(result).includes('OUTPUT_UNKNOWN_FIELD'));
  });

  it('rejects a chain that differs from the trusted chain', () => {
    const result = run({ ...nativeOutput, chainId: 1 });
    assert.equal(result.status, 'invalid');
    assert.ok(codes(result).includes('CHAIN_MISMATCH'));
    assert.equal(run({ ...nativeOutput, chainId: '11155111' }).status, 'invalid');
  });

  it('fails closed on assets outside the trusted registry', () => {
    const unknown = run({ ...tokenOutput, asset: 'SHIB' });
    assert.equal(unknown.status, 'invalid');
    assert.ok(codes(unknown).includes('ASSET_UNKNOWN'));
    assert.ok(codes(run({ ...tokenOutput, asset: 'usdc' })).includes('ASSET_UNKNOWN'));
  });

  it('rejects a token address that differs from the trusted one', () => {
    const result = run({ ...tokenOutput, tokenAddress: EVIL });
    assert.equal(result.status, 'invalid');
    assert.ok(codes(result).includes('TOKEN_ADDRESS_MISMATCH'));
    assert.ok(codes(run({ ...nativeOutput, tokenAddress: USDC })).includes('TOKEN_ADDRESS_MISMATCH'));
  });

  it('rejects operation and asset that disagree', () => {
    assert.ok(codes(run({ ...nativeOutput, asset: 'USDC' })).includes('ASSET_OPERATION_MISMATCH'));
    assert.ok(codes(run({ ...tokenOutput, asset: 'ETH' })).includes('ASSET_OPERATION_MISMATCH'));
  });

  it('rejects invalid, zero and self counterparties', () => {
    assert.ok(codes(run({ ...nativeOutput, recipient: 'vitalik.eth' })).includes('ADDRESS_INVALID'));
    assert.ok(codes(run({ ...nativeOutput, recipient: '0x1234' })).includes('ADDRESS_INVALID'));
    assert.ok(codes(run({ ...nativeOutput, recipient: '0x' + '0'.repeat(40) })).includes('PROHIBITED_ZERO_ADDRESS'));
    assert.ok(codes(run({ ...nativeOutput, recipient: ACCOUNT })).includes('PROHIBITED_SELF_RECIPIENT'));
    assert.ok(codes(run({ ...nativeOutput, recipient: ACCOUNT.toUpperCase().replace('0X', '0x') })).includes('PROHIBITED_SELF_RECIPIENT'));
  });

  it('requires recipient for transfers and spender for approvals, never both', () => {
    assert.ok(codes(run({ ...nativeOutput, spender: RECIPIENT })).includes('OUTPUT_UNKNOWN_FIELD'));
    assert.ok(codes(run({ ...approveOutput, recipient: RECIPIENT })).includes('OUTPUT_UNKNOWN_FIELD'));
    const noSpender = run({ outcome: 'proposal', operation: 'erc20_approve', asset: 'USDC', recipient: RECIPIENT, amount: '1', purpose: 'x' });
    assert.equal(noSpender.status, 'invalid');
  });

  it('rejects bad amounts with specific codes and uses trusted decimals', () => {
    assert.ok(codes(run({ ...nativeOutput, amount: 0.5 })).includes('AMOUNT_INVALID'));
    assert.ok(codes(run({ ...nativeOutput, amount: '0' })).includes('AMOUNT_ZERO'));
    assert.ok(codes(run({ ...tokenOutput, amount: '1.0000001' })).includes('AMOUNT_PRECISION'));
    assert.ok(codes(run({ ...nativeOutput, amount: '1e18' })).includes('AMOUNT_INVALID'));
    assert.ok(codes(run({ ...nativeOutput, amount: '9'.repeat(80) })).includes('AMOUNT_TOO_LARGE'));
    // The model cannot choose decimals: a "decimals" field is rejected, and USDC is always 6.
    assert.equal(run({ ...tokenOutput, decimals: 18 }).status, 'invalid');
  });

  it('validates the purpose as plain text without repairing it', () => {
    for (const purpose of ['', '   ', 'x'.repeat(501), 'line\nbreak', 'bell\u0007', 'rtl‮override']) {
      const result = run({ ...nativeOutput, purpose });
      assert.equal(result.status, 'invalid');
      assert.ok(codes(result).includes('PURPOSE_INVALID'));
    }
  });
});

describe('unsupported and declined requests', () => {
  it('fails closed on unsupported operation kinds, including contract_call', () => {
    for (const operation of ['contract_call', 'swap', 'delegatecall', 'native_transfer ', '']) {
      const result = run({ ...nativeOutput, operation });
      assert.equal(result.status, 'unsupported', `operation ${JSON.stringify(operation)}`);
      assert.ok(codes(result).includes('OPERATION_UNSUPPORTED'));
    }
  });

  it('turns an explicit model refusal into an unsupported result', () => {
    const result = run({ outcome: 'unsupported', reason: 'Swapping tokens is not supported.' });
    assert.equal(result.status, 'unsupported');
    assert.deepEqual(codes(result), ['MODEL_DECLINED']);
  });

  it('does not repeat an unsafe refusal reason', () => {
    const result = run({ outcome: 'unsupported', reason: 'bad‮text' });
    assert.equal(result.status, 'unsupported');
    assert.ok(!result.messages[0]?.message.includes('‮'));
  });

  it('rejects extra keys on a refusal', () => {
    assert.equal(run({ outcome: 'unsupported', reason: 'no', recipient: EVIL }).status, 'invalid');
  });
});
