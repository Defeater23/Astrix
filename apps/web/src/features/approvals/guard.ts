import { isAddress } from '../execution/validate';
import type { ApprovalRequest } from './types';

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/;
const UINT256_MAX = (1n << 256n) - 1n;

function isUint256(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL.test(value) && BigInt(value) <= UINT256_MAX;
}

function isSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Display-safety guard. A request that fails is dropped and counted, never shown with guessed
 * values. This is not the Module 7B schema validation and authorizes nothing.
 */
export function isDisplayableRequest(value: unknown): value is ApprovalRequest {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  const op = r.operation;
  if (typeof op !== 'object' || op === null) return false;
  const o = op as Record<string, unknown>;
  const meta = r.tokenMeta;
  const metaOk =
    meta === undefined ||
    (typeof meta === 'object' &&
      meta !== null &&
      typeof (meta as Record<string, unknown>).symbol === 'string' &&
      ((meta as Record<string, unknown>).symbol as string).length > 0 &&
      Number.isInteger((meta as Record<string, unknown>).decimals) &&
      ((meta as Record<string, unknown>).decimals as number) >= 0 &&
      ((meta as Record<string, unknown>).decimals as number) <= 36);
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.purpose === 'string' &&
    typeof r.reason === 'string' &&
    isSeconds(r.createdAt) &&
    metaOk &&
    typeof o.account === 'string' &&
    isAddress(o.account) &&
    typeof o.agent === 'string' &&
    isAddress(o.agent) &&
    typeof o.target === 'string' &&
    isAddress(o.target) &&
    typeof o.chainId === 'number' &&
    Number.isSafeInteger(o.chainId) &&
    o.chainId > 0 &&
    isUint256(o.nonce) &&
    isSeconds(o.expiresAt) &&
    isUint256(o.value) &&
    typeof o.data === 'string' &&
    HEX_DATA.test(o.data)
  );
}
