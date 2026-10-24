import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDecimalAmount } from './amount.js';

describe('parseDecimalAmount', () => {
  it('converts exactly, with no floating point', () => {
    assert.deepEqual(parseDecimalAmount('1.5', 18), { ok: true, baseUnits: 1_500_000_000_000_000_000n });
    assert.deepEqual(parseDecimalAmount('25', 6), { ok: true, baseUnits: 25_000_000n });
    assert.deepEqual(parseDecimalAmount('0.000001', 6), { ok: true, baseUnits: 1n });
    assert.deepEqual(parseDecimalAmount('7', 0), { ok: true, baseUnits: 7n });
    // 0.1 + 0.2 style values stay exact.
    assert.deepEqual(parseDecimalAmount('0.3', 18), { ok: true, baseUnits: 300_000_000_000_000_000n });
    assert.deepEqual(parseDecimalAmount('123456789.123456789123456789', 18), {
      ok: true,
      baseUnits: 123_456_789_123_456_789_123_456_789n,
    });
  });

  it('rejects JSON numbers and other non-strings', () => {
    for (const bad of [1.5, 25, null, undefined, {}, [], true]) {
      const result = parseDecimalAmount(bad, 18);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'AMOUNT_INVALID');
    }
  });

  it('rejects malformed decimal strings instead of repairing them', () => {
    for (const bad of ['', ' 1', '1 ', '+1', '-1', '1e3', '1E3', '.5', '5.', '01', '00.5', '1,5', '0x10', 'one', 'NaN', 'Infinity', '1.5.2', '1_000']) {
      const result = parseDecimalAmount(bad, 18);
      assert.equal(result.ok, false, `expected "${bad}" to be rejected`);
      if (!result.ok) assert.equal(result.code, 'AMOUNT_INVALID');
    }
  });

  it('rejects more decimal places than the asset allows (never rounds)', () => {
    const result = parseDecimalAmount('0.0000001', 6);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'AMOUNT_PRECISION');
    const zeroDecimals = parseDecimalAmount('1.5', 0);
    assert.equal(zeroDecimals.ok, false);
  });

  it('rejects zero', () => {
    for (const zero of ['0', '0.0', '0.000000']) {
      const result = parseDecimalAmount(zero, 6);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'AMOUNT_ZERO');
    }
  });

  it('enforces the uint256 bound', () => {
    const max = (2n ** 256n - 1n).toString();
    assert.deepEqual(parseDecimalAmount(max, 0), { ok: true, baseUnits: 2n ** 256n - 1n });
    const over = parseDecimalAmount((2n ** 256n).toString(), 0);
    assert.equal(over.ok, false);
    if (!over.ok) assert.equal(over.code, 'AMOUNT_TOO_LARGE');
  });

  it('rejects absurdly long input and invalid decimals', () => {
    assert.equal(parseDecimalAmount('9'.repeat(101), 0).ok, false);
    assert.equal(parseDecimalAmount('1', -1).ok, false);
    assert.equal(parseDecimalAmount('1', 37).ok, false);
    assert.equal(parseDecimalAmount('1', 1.5).ok, false);
  });
});
