import type { OperationRequest, Rejection } from './types';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/;
const UINT256_MAX = (1n << 256n) - 1n;

export interface ValidationContext {
  /** Chain the app is currently connected to and about to submit on. */
  chainId: number;
  /** Smart account the operation must be addressed to. */
  account: string;
  nowSeconds: number;
  /** Next nonce read from the chain (EntryPoint) for this account. */
  expectedNonce: string;
  /** Nonces already used by operations tracked locally. */
  usedNonces?: ReadonlySet<string>;
  /** Whether the agent is currently Active and unexpired according to chain data. */
  agentAuthorized: boolean;
  /** Result of the advisory policy preview. It never authorizes anything. */
  policyPreview?: { allowed: boolean; reason?: string };
}

export type ValidationResult = { ok: true } | { ok: false; rejections: Rejection[] };

export function isAddress(value: string): boolean {
  return ADDRESS.test(value);
}

function parseUint(value: string): bigint | null {
  if (!DECIMAL.test(value)) return null;
  const n = BigInt(value);
  return n <= UINT256_MAX ? n : null;
}

/**
 * Advisory pre-submission checks. A pass here does NOT mean the operation will execute: the
 * account's signature validation and the on-chain policy remain the only authority. A failure here
 * is evidence only that the client refused to submit.
 */
export function validateOperation(op: OperationRequest, ctx: ValidationContext): ValidationResult {
  const rejections: Rejection[] = [];
  const add = (code: Rejection['code'], message: string) => rejections.push({ code, message });

  if (!isAddress(op.account)) add('INVALID_ADDRESS', 'Account is not a valid address.');
  if (!isAddress(op.agent)) add('INVALID_ADDRESS', 'Agent is not a valid address.');
  if (!isAddress(op.target)) add('INVALID_ADDRESS', 'Target is not a valid address.');
  if (parseUint(op.value) === null) add('INVALID_AMOUNT', 'Value must be a non-negative integer in wei.');
  if (!HEX_DATA.test(op.data)) add('INVALID_DATA', 'Calldata must be 0x-prefixed hex with an even length.');

  if (!Number.isInteger(op.chainId) || op.chainId !== ctx.chainId) {
    add('WRONG_CHAIN', `Operation is for chain ${op.chainId}, but the connected chain is ${ctx.chainId}.`);
  }
  if (op.account.toLowerCase() !== ctx.account.toLowerCase()) {
    add('WRONG_ACCOUNT', 'Operation is addressed to a different smart account.');
  }
  if (!Number.isFinite(op.expiresAt) || op.expiresAt <= ctx.nowSeconds) {
    add('EXPIRED', 'Operation has expired.');
  }

  const nonce = parseUint(op.nonce);
  const expected = parseUint(ctx.expectedNonce);
  if (nonce === null || expected === null) {
    add('INVALID_NONCE', 'Nonce must be a non-negative integer.');
  } else if (ctx.usedNonces?.has(nonce.toString())) {
    add('NONCE_REUSED', 'This nonce was already used by a tracked operation.');
  } else if (nonce !== expected) {
    add('NONCE_MISMATCH', `Nonce ${nonce} does not match the account's next nonce ${expected}.`);
  }

  if (!ctx.agentAuthorized) {
    add('AGENT_NOT_AUTHORIZED', 'Agent is not currently authorized on chain.');
  }
  if (ctx.policyPreview && !ctx.policyPreview.allowed) {
    add(
      'POLICY_PREVIEW_DENIED',
      ctx.policyPreview.reason ?? 'The advisory policy preview denies this operation.',
    );
  }

  return rejections.length === 0 ? { ok: true } : { ok: false, rejections };
}

/**
 * Stable client-side identity of an operation, used only to de-duplicate submissions and retries.
 * It is NOT the signed digest and provides no security binding; the account signs its own digest.
 */
export function operationKey(op: OperationRequest): string {
  const norm = {
    v: 1,
    account: op.account.toLowerCase(),
    agent: op.agent.toLowerCase(),
    chainId: op.chainId,
    nonce: BigInt(op.nonce).toString(),
    expiresAt: op.expiresAt,
    target: op.target.toLowerCase(),
    value: BigInt(op.value).toString(),
    data: op.data.toLowerCase(),
  };
  return JSON.stringify(norm);
}
