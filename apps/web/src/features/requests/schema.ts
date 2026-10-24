import type { OperationRequest } from '../execution/types';
import { REQUEST_SCHEMA_VERSION } from './types';
import type {
  ParseResult,
  RequestPayload,
  RequestTokenMeta,
  TypedOperation,
  ValidationCode,
  ValidationIssue,
  ValidationSeverity,
} from './types';

/**
 * Module 7B schema validation. Strict by design: unknown fields are rejected, nothing is repaired
 * or guessed, and the typed description must agree with the exact calldata. Passing validation
 * means the request is well formed and internally consistent. It does NOT mean the operation is
 * allowed to execute; the smart account and the on-chain policy decide that.
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/;
const SELECTOR = /^0x[0-9a-fA-F]{8}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const UINT256_MAX = (1n << 256n) - 1n;

const SELECTOR_TRANSFER = '0xa9059cbb';
const SELECTOR_APPROVE = '0x095ea8b0';
/** selector (4 bytes) + two 32-byte words, as 0x-prefixed hex characters. */
const ERC20_CALL_LENGTH = 2 + 8 + 64 + 64;

export const TEXT_MAX_LENGTH = 500;
export const SYMBOL_MAX_LENGTH = 20;
/** A request may not stay open longer than this from creation to expiry. */
export const MAX_TTL_SECONDS = 7 * 86_400;
/** How far in the future a creation time may be before it is treated as invalid. */
export const CLOCK_SKEW_SECONDS = 300;

export interface ParseContext {
  nowSeconds: number;
  /** Chain IDs the application supports. Pass `SUPPORTED_CHAIN_IDS`. */
  supportedChainIds: readonly number[];
  /**
   * When false, the checks that depend on the current time (`EXPIRED`, `CREATED_IN_FUTURE`) are
   * skipped. Used when re-reading stored records. The TTL checks always run.
   */
  checkTime?: boolean;
}

const TOP_KEYS = [
  'schemaVersion',
  'requestId',
  'owner',
  'createdAt',
  'purpose',
  'reason',
  'tokenMeta',
  'typed',
  'operation',
] as const;
const OPERATION_KEYS = [
  'account',
  'agent',
  'chainId',
  'nonce',
  'expiresAt',
  'target',
  'value',
  'data',
] as const;
const TOKEN_META_KEYS = ['symbol', 'decimals'] as const;
const TYPED_KEYS: Record<TypedOperation['kind'], readonly string[]> = {
  native_transfer: ['kind', 'recipient', 'amountWei'],
  erc20_transfer: ['kind', 'token', 'recipient', 'amountBaseUnits'],
  erc20_approve: ['kind', 'token', 'spender', 'amountBaseUnits'],
  contract_call: ['kind', 'target', 'selector', 'valueWei'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAddress(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS.test(value);
}

function parseUint(value: unknown): bigint | null {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return null;
  const n = BigInt(value);
  return n <= UINT256_MAX ? n : null;
}

function isSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Control characters and bidirectional overrides can make displayed text lie about its content. */
function hasUnsafeChars(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (code >= 0x202a && code <= 0x202e) return true;
    if (code >= 0x2066 && code <= 0x2069) return true;
    if (code === 0x200e || code === 0x200f || code === 0x061c) return true;
  }
  return false;
}

/** Decodes calldata exactly as the review screen does, or reports why it cannot. */
export type DerivedOperation = { ok: true; typed: TypedOperation } | { ok: false; reason: string };

function word(hexData: string, index: number): string {
  return hexData.slice(index * 64, index * 64 + 64);
}

/**
 * Derives the typed description from the exact operation. Used to cross-check what the request
 * claims, and by agent-side code that needs to build a request. Calldata must be valid hex.
 */
export function deriveTyped(
  op: Pick<OperationRequest, 'target' | 'value' | 'data'>,
): DerivedOperation {
  const data = op.data.toLowerCase();
  const target = op.target.toLowerCase();
  if (data === '0x') {
    return {
      ok: true,
      typed: { kind: 'native_transfer', recipient: target, amountWei: op.value },
    };
  }
  if (data.length < 10) {
    return { ok: false, reason: 'Calldata is shorter than a 4-byte function selector.' };
  }
  const selector = data.slice(0, 10);
  if (selector === SELECTOR_TRANSFER || selector === SELECTOR_APPROVE) {
    if (data.length !== ERC20_CALL_LENGTH) {
      return { ok: false, reason: 'Token call calldata has an unexpected length.' };
    }
    const args = data.slice(10);
    const addressWord = word(args, 0);
    if (!/^0{24}/.test(addressWord)) {
      return { ok: false, reason: 'The address argument has non-zero upper bytes.' };
    }
    const counterparty = `0x${addressWord.slice(24)}`;
    const amount = BigInt(`0x${word(args, 1)}`).toString();
    return selector === SELECTOR_TRANSFER
      ? {
          ok: true,
          typed: {
            kind: 'erc20_transfer',
            token: target,
            recipient: counterparty,
            amountBaseUnits: amount,
          },
        }
      : {
          ok: true,
          typed: {
            kind: 'erc20_approve',
            token: target,
            spender: counterparty,
            amountBaseUnits: amount,
          },
        };
  }
  return {
    ok: true,
    typed: { kind: 'contract_call', target, selector, valueWei: op.value },
  };
}

/**
 * Canonical string over every material field. Addresses and hex are lowercased. Any change to
 * any field changes it, which is how a changed request is told apart from the one that was
 * reviewed. It is a comparison aid, NOT the digest the owner signs (Module 7C defines that).
 */
export function requestFingerprint(request: RequestPayload): string {
  const op = request.operation;
  return JSON.stringify([
    request.schemaVersion,
    request.requestId,
    request.owner.toLowerCase(),
    request.createdAt,
    request.purpose,
    request.reason,
    request.tokenMeta ? [request.tokenMeta.symbol, request.tokenMeta.decimals] : null,
    request.typed.kind,
    op.account.toLowerCase(),
    op.agent.toLowerCase(),
    op.chainId,
    op.nonce,
    op.expiresAt,
    op.target.toLowerCase(),
    op.value,
    op.data.toLowerCase(),
  ]);
}

class Collector {
  readonly issues: ValidationIssue[] = [];

  add(code: ValidationCode, path: string, message: string, severity: ValidationSeverity = 'error') {
    this.issues.push({ code, severity, path, message });
  }

  get hasErrors(): boolean {
    return this.issues.some((issue) => issue.severity === 'error');
  }
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  c: Collector,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      c.add(
        'UNKNOWN_FIELD',
        path ? `${path}.${key}` : key,
        `Unknown field "${key}" is not allowed.`,
      );
    }
  }
}

function readText(value: unknown, path: string, c: Collector): string | undefined {
  if (typeof value !== 'string') {
    c.add('INVALID_TEXT', path, 'Must be text.');
    return undefined;
  }
  if (value.length > TEXT_MAX_LENGTH) {
    c.add('INVALID_TEXT', path, `Must be at most ${TEXT_MAX_LENGTH} characters.`);
    return undefined;
  }
  if (hasUnsafeChars(value)) {
    c.add('INVALID_TEXT', path, 'Must not contain control or direction-override characters.');
    return undefined;
  }
  return value;
}

function readAddress(
  value: unknown,
  path: string,
  code: ValidationCode,
  c: Collector,
): string | undefined {
  if (!isAddress(value)) {
    c.add(code, path, 'Must be a 0x-prefixed 20-byte hex address.');
    return undefined;
  }
  return value.toLowerCase();
}

function readUint(
  value: unknown,
  path: string,
  code: ValidationCode,
  c: Collector,
): string | undefined {
  const n = parseUint(value);
  if (n === null) {
    c.add(code, path, 'Must be a canonical non-negative decimal integer string that fits uint256.');
    return undefined;
  }
  return n.toString();
}

function readTokenMeta(value: unknown, c: Collector): RequestTokenMeta | undefined {
  if (!isRecord(value)) {
    c.add('INVALID_TOKEN_META', 'tokenMeta', 'Must be an object with symbol and decimals.');
    return undefined;
  }
  checkKeys(value, TOKEN_META_KEYS, 'tokenMeta', c);
  const { symbol, decimals } = value;
  let ok = true;
  if (
    typeof symbol !== 'string' ||
    symbol.length === 0 ||
    symbol.length > SYMBOL_MAX_LENGTH ||
    hasUnsafeChars(symbol)
  ) {
    c.add('INVALID_TOKEN_META', 'tokenMeta.symbol', 'Must be 1 to 20 printable characters.');
    ok = false;
  }
  if (
    typeof decimals !== 'number' ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36
  ) {
    c.add('INVALID_TOKEN_META', 'tokenMeta.decimals', 'Must be an integer from 0 to 36.');
    ok = false;
  }
  return ok ? { symbol: symbol as string, decimals: decimals as number } : undefined;
}

function readOperation(
  value: unknown,
  ctx: ParseContext,
  createdAt: number | undefined,
  c: Collector,
): OperationRequest | undefined {
  if (!isRecord(value)) {
    c.add('MALFORMED', 'operation', 'Must be an object.');
    return undefined;
  }
  checkKeys(value, OPERATION_KEYS, 'operation', c);
  const before = c.issues.length;

  const account = readAddress(value.account, 'operation.account', 'INVALID_ACCOUNT', c);
  const agent = readAddress(value.agent, 'operation.agent', 'INVALID_AGENT', c);
  const target = readAddress(value.target, 'operation.target', 'INVALID_TARGET', c);
  const nonce = readUint(value.nonce, 'operation.nonce', 'INVALID_NONCE', c);
  const amount = readUint(value.value, 'operation.value', 'INVALID_VALUE', c);

  let chainId: number | undefined;
  if (
    typeof value.chainId !== 'number' ||
    !Number.isSafeInteger(value.chainId) ||
    !ctx.supportedChainIds.includes(value.chainId)
  ) {
    c.add(
      'UNSUPPORTED_CHAIN',
      'operation.chainId',
      `Chain ID must be one of: ${ctx.supportedChainIds.join(', ')}.`,
    );
  } else {
    chainId = value.chainId;
  }

  let data: string | undefined;
  if (typeof value.data !== 'string' || !HEX_DATA.test(value.data)) {
    c.add('INVALID_CALLDATA', 'operation.data', 'Must be 0x-prefixed hex with an even length.');
  } else {
    data = value.data.toLowerCase();
  }

  let expiresAt: number | undefined;
  if (!isSeconds(value.expiresAt)) {
    c.add(
      'INVALID_TIMESTAMP',
      'operation.expiresAt',
      'Must be a non-negative integer in Unix seconds.',
    );
  } else {
    expiresAt = value.expiresAt;
    if (createdAt !== undefined) {
      if (expiresAt <= createdAt) {
        c.add(
          'EXPIRES_BEFORE_CREATION',
          'operation.expiresAt',
          'Expiry must be after creation time.',
        );
      } else if (expiresAt - createdAt > MAX_TTL_SECONDS) {
        c.add(
          'TTL_TOO_LONG',
          'operation.expiresAt',
          `A request may stay open for at most ${MAX_TTL_SECONDS / 86_400} days.`,
        );
      }
    }
    if (ctx.checkTime !== false && expiresAt <= ctx.nowSeconds) {
      c.add('EXPIRED', 'operation.expiresAt', 'The request has already expired.');
    }
  }

  if (account === ZERO_ADDRESS) {
    c.add(
      'PROHIBITED_ZERO_ADDRESS',
      'operation.account',
      'The zero address is not a valid account.',
    );
  }
  if (agent === ZERO_ADDRESS) {
    c.add('PROHIBITED_ZERO_ADDRESS', 'operation.agent', 'The zero address is not a valid agent.');
  }
  if (target === ZERO_ADDRESS) {
    c.add('PROHIBITED_ZERO_ADDRESS', 'operation.target', 'The zero address is not a valid target.');
  }
  if (account !== undefined && target !== undefined && account === target) {
    c.add(
      'PROHIBITED_SELF_TARGET',
      'operation.target',
      'An approval request may not target the smart account itself (configuration changes).',
    );
  }

  if (c.issues.length > before && c.issues.slice(before).some((i) => i.severity === 'error')) {
    return undefined;
  }
  if (
    account === undefined ||
    agent === undefined ||
    target === undefined ||
    nonce === undefined ||
    amount === undefined ||
    chainId === undefined ||
    data === undefined ||
    expiresAt === undefined
  ) {
    return undefined;
  }
  return { account, agent, chainId, nonce, expiresAt, target, value: amount, data };
}

function readTyped(value: unknown, c: Collector): TypedOperation | undefined {
  if (!isRecord(value)) {
    c.add('INVALID_TYPED_OPERATION', 'typed', 'Must be an object with a supported kind.');
    return undefined;
  }
  const kind = value.kind;
  if (
    kind !== 'native_transfer' &&
    kind !== 'erc20_transfer' &&
    kind !== 'erc20_approve' &&
    kind !== 'contract_call'
  ) {
    c.add('INVALID_TYPED_OPERATION', 'typed.kind', 'Unsupported operation kind.');
    return undefined;
  }
  checkKeys(value, TYPED_KEYS[kind], 'typed', c);
  const before = c.issues.length;
  const bad = () => c.issues.length > before;
  const addr = (v: unknown, name: string) => {
    if (!isAddress(v)) {
      c.add(
        'INVALID_TYPED_OPERATION',
        `typed.${name}`,
        'Must be a 0x-prefixed 20-byte hex address.',
      );
      return '';
    }
    return v.toLowerCase();
  };
  const uint = (v: unknown, name: string) => {
    const n = parseUint(v);
    if (n === null) {
      c.add(
        'INVALID_TYPED_OPERATION',
        `typed.${name}`,
        'Must be a canonical decimal integer string.',
      );
      return '';
    }
    return n.toString();
  };

  switch (kind) {
    case 'native_transfer': {
      const typed: TypedOperation = {
        kind,
        recipient: addr(value.recipient, 'recipient'),
        amountWei: uint(value.amountWei, 'amountWei'),
      };
      return bad() ? undefined : typed;
    }
    case 'erc20_transfer': {
      const typed: TypedOperation = {
        kind,
        token: addr(value.token, 'token'),
        recipient: addr(value.recipient, 'recipient'),
        amountBaseUnits: uint(value.amountBaseUnits, 'amountBaseUnits'),
      };
      return bad() ? undefined : typed;
    }
    case 'erc20_approve': {
      const typed: TypedOperation = {
        kind,
        token: addr(value.token, 'token'),
        spender: addr(value.spender, 'spender'),
        amountBaseUnits: uint(value.amountBaseUnits, 'amountBaseUnits'),
      };
      return bad() ? undefined : typed;
    }
    case 'contract_call': {
      let selector = '';
      if (typeof value.selector !== 'string' || !SELECTOR.test(value.selector)) {
        c.add(
          'INVALID_TYPED_OPERATION',
          'typed.selector',
          'Must be a 4-byte 0x-prefixed hex selector.',
        );
      } else {
        selector = value.selector.toLowerCase();
      }
      const typed: TypedOperation = {
        kind,
        target: addr(value.target, 'target'),
        selector,
        valueWei: uint(value.valueWei, 'valueWei'),
      };
      return bad() ? undefined : typed;
    }
  }
}

function sameTyped(declared: TypedOperation, derived: TypedOperation, c: Collector): void {
  if (declared.kind !== derived.kind) {
    c.add(
      'KIND_MISMATCH',
      'typed.kind',
      `Declared kind "${declared.kind}" does not match the calldata, which encodes "${derived.kind}".`,
    );
    return;
  }
  const a = declared as unknown as Record<string, unknown>;
  const b = derived as unknown as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (a[key] !== b[key]) {
      c.add(
        'KIND_MISMATCH',
        `typed.${key}`,
        `Declared ${key} does not match the exact calldata and value.`,
      );
    }
  }
}

/** Safety rules on the exact operation, applied to what the calldata really encodes. */
function applyOperationRules(derived: TypedOperation, op: OperationRequest, c: Collector): void {
  switch (derived.kind) {
    case 'native_transfer':
      if (BigInt(derived.amountWei) === 0n) {
        c.add(
          'PROHIBITED_ZERO_AMOUNT',
          'operation.value',
          'A transfer of zero value does nothing.',
        );
      }
      if (derived.recipient === ZERO_ADDRESS) {
        c.add(
          'PROHIBITED_ZERO_ADDRESS',
          'operation.target',
          'Sending to the zero address burns funds.',
        );
      }
      return;
    case 'erc20_transfer':
    case 'erc20_approve': {
      if (BigInt(op.value) > 0n) {
        c.add(
          'PROHIBITED_TOKEN_CALL_WITH_VALUE',
          'operation.value',
          'Native value must be zero on a token call.',
        );
      }
      const counterparty = derived.kind === 'erc20_transfer' ? derived.recipient : derived.spender;
      if (counterparty === ZERO_ADDRESS) {
        c.add(
          'PROHIBITED_ZERO_ADDRESS',
          'operation.data',
          derived.kind === 'erc20_transfer'
            ? 'Transferring tokens to the zero address burns them.'
            : 'The spender may not be the zero address.',
        );
      }
      const amount = BigInt(derived.amountBaseUnits);
      if (derived.kind === 'erc20_transfer' && amount === 0n) {
        c.add('PROHIBITED_ZERO_AMOUNT', 'operation.data', 'A token transfer of zero does nothing.');
      }
      if (derived.kind === 'erc20_approve' && amount === UINT256_MAX) {
        c.add(
          'UNLIMITED_ALLOWANCE',
          'operation.data',
          'This grants an unlimited token allowance.',
          'warning',
        );
      }
      return;
    }
    case 'contract_call':
      c.add(
        'UNDECODED_CALLDATA',
        'operation.data',
        'Calldata is not decoded; the owner must review the raw hex.',
        'warning',
      );
      return;
  }
}

/**
 * Validates an untrusted value as an approval request. Returns every blocking issue at once, or a
 * normalized request with its fingerprint and any non-blocking warnings.
 */
export function parseRequest(input: unknown, ctx: ParseContext): ParseResult {
  const c = new Collector();
  if (!isRecord(input)) {
    c.add('MALFORMED', '', 'Request must be an object.');
    return { ok: false, issues: c.issues };
  }
  checkKeys(input, TOP_KEYS, '', c);

  if (input.schemaVersion !== REQUEST_SCHEMA_VERSION) {
    c.add(
      'UNSUPPORTED_SCHEMA_VERSION',
      'schemaVersion',
      `Only schema version ${REQUEST_SCHEMA_VERSION} is supported.`,
    );
  }

  let requestId: string | undefined;
  if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) {
    c.add(
      'INVALID_REQUEST_ID',
      'requestId',
      'Must be 1 to 64 characters: letters, digits, dot, underscore, colon or hyphen; starting with a letter or digit.',
    );
  } else {
    requestId = input.requestId;
  }

  const owner = readAddress(input.owner, 'owner', 'INVALID_OWNER', c);
  if (owner === ZERO_ADDRESS) {
    c.add('PROHIBITED_ZERO_ADDRESS', 'owner', 'The zero address cannot be an owner.');
  }

  let createdAt: number | undefined;
  if (!isSeconds(input.createdAt)) {
    c.add('INVALID_TIMESTAMP', 'createdAt', 'Must be a non-negative integer in Unix seconds.');
  } else {
    createdAt = input.createdAt;
    if (ctx.checkTime !== false && createdAt > ctx.nowSeconds + CLOCK_SKEW_SECONDS) {
      c.add('CREATED_IN_FUTURE', 'createdAt', 'Creation time is in the future.');
    }
  }

  const purpose = readText(input.purpose, 'purpose', c);
  const reason = readText(input.reason, 'reason', c);
  const tokenMeta = input.tokenMeta === undefined ? undefined : readTokenMeta(input.tokenMeta, c);
  const typed = readTyped(input.typed, c);
  const operation = readOperation(input.operation, ctx, createdAt, c);

  if (operation) {
    const derived = deriveTyped(operation);
    if (!derived.ok) {
      c.add('INVALID_CALLDATA', 'operation.data', derived.reason);
    } else {
      applyOperationRules(derived.typed, operation, c);
      if (typed) sameTyped(typed, derived.typed, c);
    }
  }

  if (
    c.hasErrors ||
    requestId === undefined ||
    owner === undefined ||
    createdAt === undefined ||
    purpose === undefined ||
    reason === undefined ||
    typed === undefined ||
    operation === undefined
  ) {
    return { ok: false, issues: c.issues };
  }

  const request: RequestPayload = {
    schemaVersion: REQUEST_SCHEMA_VERSION,
    requestId,
    owner,
    createdAt,
    purpose,
    reason,
    ...(tokenMeta ? { tokenMeta } : {}),
    typed,
    operation,
  };
  return {
    ok: true,
    value: {
      request,
      fingerprint: requestFingerprint(request),
      warnings: c.issues.filter((issue) => issue.severity === 'warning'),
    },
  };
}
