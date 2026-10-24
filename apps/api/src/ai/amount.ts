import { MAX_UINT256 } from './types.js';

/**
 * Exact decimal-string to integer-base-unit conversion. No floating point is ever involved.
 * Anything that is not a plain non-negative decimal string is rejected rather than "repaired":
 * numbers, exponents, signs, whitespace, leading zeros, a bare ".5" or "5.".
 */

const DECIMAL_AMOUNT = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export type AmountErrorCode =
  | 'AMOUNT_INVALID'
  | 'AMOUNT_ZERO'
  | 'AMOUNT_PRECISION'
  | 'AMOUNT_TOO_LARGE';

export type AmountResult =
  | { ok: true; baseUnits: bigint }
  | { ok: false; code: AmountErrorCode; message: string };

export function parseDecimalAmount(input: unknown, decimals: number): AmountResult {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return { ok: false, code: 'AMOUNT_INVALID', message: 'Token decimals must be an integer from 0 to 36.' };
  }
  if (typeof input !== 'string') {
    return {
      ok: false,
      code: 'AMOUNT_INVALID',
      message: 'Amount must be a decimal string (for example "1.5"), not a JSON number.',
    };
  }
  if (input.length > 100 || !DECIMAL_AMOUNT.test(input)) {
    return {
      ok: false,
      code: 'AMOUNT_INVALID',
      message: 'Amount must be a plain decimal such as "25" or "0.5" (no sign, exponent, spaces or leading zeros).',
    };
  }
  const [whole = '0', fraction = ''] = input.split('.');
  if (fraction.length > decimals) {
    return {
      ok: false,
      code: 'AMOUNT_PRECISION',
      message: `Amount has ${fraction.length} decimal places but the asset allows ${decimals}. It is not rounded.`,
    };
  }
  const baseUnits = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (baseUnits === 0n) {
    return { ok: false, code: 'AMOUNT_ZERO', message: 'Amount must be greater than zero.' };
  }
  if (baseUnits > MAX_UINT256) {
    return { ok: false, code: 'AMOUNT_TOO_LARGE', message: 'Amount does not fit in a uint256.' };
  }
  return { ok: true, baseUnits };
}
