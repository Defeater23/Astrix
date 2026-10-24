import { parseDecimalAmount } from './amount.js';
import { ADDRESS_PATTERN, ZERO_ADDRESS } from './context.js';
import { MAX_UINT256, PURPOSE_MAX_LENGTH, SUPPORTED_OPERATION_KINDS } from './types.js';
import type {
  ProposalAsset,
  ProposalContext,
  ProposalMessage,
  ProposalOperation,
  ProposalOperationKind,
} from './types.js';

/**
 * Turns UNTRUSTED model text into a validated operation, or a refusal. Rules:
 * - Exactly one JSON object (optionally inside a single ```json fence). Prose around it is rejected.
 * - Unknown keys are rejected, so a model cannot smuggle in account, nonce, expiry or calldata.
 * - Security-critical values are never repaired: a wrong chain, token address, precision or address
 *   is an error, not something that is silently corrected, rounded or replaced.
 * - Chain, account, agent, owner, expiry, asset decimals and token addresses come from the trusted
 *   context. The model's confidence or wording carries no authority.
 */

const FORBIDDEN_TEXT = /[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/;
const PROPOSAL_KEYS = new Set([
  'outcome',
  'operation',
  'asset',
  'recipient',
  'spender',
  'tokenAddress',
  'amount',
  'purpose',
  'chainId',
]);
const UNSUPPORTED_KEYS = new Set(['outcome', 'reason']);
const FENCE = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/;

export type InterpretedOutput =
  | {
      status: 'proposed';
      operation: ProposalOperation;
      asset: ProposalAsset;
      purpose: string;
      messages: ProposalMessage[];
    }
  | { status: 'invalid' | 'unsupported'; messages: ProposalMessage[] };

function error(code: ProposalMessage['code'], message: string, path?: string): ProposalMessage {
  return path === undefined
    ? { severity: 'error', code, message }
    : { severity: 'error', code, message, path };
}

function invalid(...messages: ProposalMessage[]): InterpretedOutput {
  return { status: 'invalid', messages };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkText(value: unknown, path: string, maxLength: number): ProposalMessage | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return error('PURPOSE_INVALID', 'Must be non-empty text.', path);
  }
  if (value.length > maxLength) {
    return error('PURPOSE_INVALID', `Must be at most ${maxLength} characters.`, path);
  }
  if (FORBIDDEN_TEXT.test(value)) {
    return error('PURPOSE_INVALID', 'Must not contain control or direction-override characters.', path);
  }
  return undefined;
}

function checkAddress(
  value: unknown,
  path: string,
  context: ProposalContext,
): { address: string } | { problem: ProposalMessage } {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) {
    return {
      problem: error(
        'ADDRESS_INVALID',
        'Must be a 20-byte hex address starting with 0x (names such as ENS are not resolved).',
        path,
      ),
    };
  }
  const address = value.toLowerCase();
  if (address === ZERO_ADDRESS) {
    return { problem: error('PROHIBITED_ZERO_ADDRESS', 'The zero address is not allowed.', path) };
  }
  if (address === context.account.toLowerCase()) {
    return {
      problem: error('PROHIBITED_SELF_RECIPIENT', 'The smart account cannot be its own counterparty.', path),
    };
  }
  return { address };
}

function extractJson(text: string, maxOutputChars: number): { json: unknown } | { problem: ProposalMessage } {
  if (text.length > maxOutputChars) {
    return { problem: error('OUTPUT_TOO_LARGE', `Model output is longer than ${maxOutputChars} characters.`) };
  }
  let body = text.trim();
  const fenced = FENCE.exec(body);
  if (fenced?.[1] !== undefined) body = fenced[1].trim();
  if (!body.startsWith('{') || !body.endsWith('}')) {
    return { problem: error('OUTPUT_NOT_JSON', 'Model output must be a single JSON object and nothing else.') };
  }
  try {
    return { json: JSON.parse(body) as unknown };
  } catch {
    return { problem: error('OUTPUT_NOT_JSON', 'Model output is not valid JSON.') };
  }
}

function unknownKeys(object: Record<string, unknown>, allowed: ReadonlySet<string>): ProposalMessage[] {
  return Object.keys(object)
    .filter((key) => !allowed.has(key))
    .map((key) =>
      error('OUTPUT_UNKNOWN_FIELD', 'This field is not allowed in model output and was not used.', key),
    );
}

export function interpretModelOutput(
  text: unknown,
  context: ProposalContext,
  maxOutputChars: number,
): InterpretedOutput {
  if (typeof text !== 'string') {
    return invalid(error('OUTPUT_NOT_JSON', 'Model output must be text.'));
  }
  const extracted = extractJson(text, maxOutputChars);
  if ('problem' in extracted) return invalid(extracted.problem);
  const output = extracted.json;
  if (!isPlainObject(output)) {
    return invalid(error('OUTPUT_NOT_OBJECT', 'Model output must be a JSON object.'));
  }

  // Declined or unclear request.
  if (output.outcome === 'unsupported') {
    const extra = unknownKeys(output, UNSUPPORTED_KEYS);
    if (extra.length > 0) return invalid(...extra);
    const reasonProblem = checkText(output.reason, 'reason', PURPOSE_MAX_LENGTH);
    const reason = reasonProblem ? 'No usable reason was given.' : (output.reason as string);
    return {
      status: 'unsupported',
      messages: [
        {
          severity: 'error',
          code: 'MODEL_DECLINED',
          message: `The request was not turned into a proposal: ${reason}`,
        },
      ],
    };
  }
  if (output.outcome !== 'proposal') {
    return invalid(error('OUTPUT_INVALID_FIELD', 'outcome must be "proposal" or "unsupported".', 'outcome'));
  }

  const problems: ProposalMessage[] = unknownKeys(output, PROPOSAL_KEYS);

  // Operation kind: fail closed on anything outside the supported set (including contract_call).
  const kind = output.operation;
  if (typeof kind !== 'string') {
    problems.push(error('OUTPUT_MISSING_FIELD', 'operation is required.', 'operation'));
  } else if (!(SUPPORTED_OPERATION_KINDS as readonly string[]).includes(kind)) {
    return {
      status: 'unsupported',
      messages: [
        ...problems,
        error(
          'OPERATION_UNSUPPORTED',
          `Operation "${kind.slice(0, 40)}" is not supported. Supported: ${SUPPORTED_OPERATION_KINDS.join(', ')}.`,
          'operation',
        ),
      ],
    };
  }

  // Echoed chain must match the trusted chain. It is never used and never "fixed".
  if (output.chainId !== undefined && output.chainId !== context.chainId) {
    problems.push(
      error(
        'CHAIN_MISMATCH',
        `The model named a different chain than the one this account is on (${context.chainId}).`,
        'chainId',
      ),
    );
  }

  // Asset resolved from the trusted registry only.
  let asset: ProposalAsset | undefined;
  if (typeof output.asset !== 'string' || output.asset.length === 0) {
    problems.push(error('OUTPUT_MISSING_FIELD', 'asset is required.', 'asset'));
  } else if (output.asset === context.nativeSymbol) {
    asset = { type: 'native', symbol: context.nativeSymbol, decimals: 18 };
  } else {
    const token = context.tokens.find((candidate) => candidate.symbol === output.asset);
    if (token) {
      asset = {
        type: 'erc20',
        symbol: token.symbol,
        decimals: token.decimals,
        address: token.address.toLowerCase(),
      };
    } else {
      problems.push(
        error('ASSET_UNKNOWN', 'This asset is not in the trusted token list for this chain.', 'asset'),
      );
    }
  }

  if (output.tokenAddress !== undefined) {
    if (asset?.type !== 'erc20') {
      problems.push(error('TOKEN_ADDRESS_MISMATCH', 'tokenAddress is only valid for token operations.', 'tokenAddress'));
    } else if (
      typeof output.tokenAddress !== 'string' ||
      output.tokenAddress.toLowerCase() !== asset.address
    ) {
      problems.push(
        error('TOKEN_ADDRESS_MISMATCH', 'tokenAddress does not match the trusted address for this asset.', 'tokenAddress'),
      );
    }
  }

  const expectsNative = kind === 'native_transfer';
  if (asset && typeof kind === 'string') {
    if (expectsNative !== (asset.type === 'native')) {
      problems.push(
        error(
          'ASSET_OPERATION_MISMATCH',
          expectsNative
            ? 'native_transfer must use the native asset.'
            : 'Token operations must use a trusted token, not the native asset.',
          'asset',
        ),
      );
    }
  }

  // Counterparty: recipient for transfers, spender for approvals. Exactly one of them.
  const counterpartyKey = kind === 'erc20_approve' ? 'spender' : 'recipient';
  const otherKey = counterpartyKey === 'spender' ? 'recipient' : 'spender';
  let counterparty: string | undefined;
  if (output[otherKey] !== undefined) {
    problems.push(
      error('OUTPUT_UNKNOWN_FIELD', `${otherKey} is not valid for ${String(kind)}.`, otherKey),
    );
  }
  if (output[counterpartyKey] === undefined) {
    problems.push(error('OUTPUT_MISSING_FIELD', `${counterpartyKey} is required.`, counterpartyKey));
  } else {
    const checked = checkAddress(output[counterpartyKey], counterpartyKey, context);
    if ('problem' in checked) problems.push(checked.problem);
    else counterparty = checked.address;
  }

  // Amount: exact decimal string, converted with the TRUSTED decimals. No rounding, no floats.
  let baseUnits: bigint | undefined;
  if (output.amount === undefined) {
    problems.push(error('OUTPUT_MISSING_FIELD', 'amount is required.', 'amount'));
  } else if (asset) {
    const parsed = parseDecimalAmount(output.amount, asset.decimals);
    if (parsed.ok) baseUnits = parsed.baseUnits;
    else problems.push(error(parsed.code, parsed.message, 'amount'));
  }

  // Purpose: required plain text, validated, never auto-filled.
  const purposeProblem =
    output.purpose === undefined
      ? error('OUTPUT_MISSING_FIELD', 'purpose is required.', 'purpose')
      : checkText(output.purpose, 'purpose', PURPOSE_MAX_LENGTH);
  if (purposeProblem) problems.push(purposeProblem);

  if (problems.length > 0 || !asset || counterparty === undefined || baseUnits === undefined) {
    return invalid(...problems);
  }

  const amount = baseUnits.toString();
  const operationKind = kind as ProposalOperationKind;
  let operation: ProposalOperation;
  const warnings: ProposalMessage[] = [];
  if (operationKind === 'native_transfer') {
    operation = { kind: 'native_transfer', recipient: counterparty, amountWei: amount };
  } else if (operationKind === 'erc20_transfer') {
    operation = {
      kind: 'erc20_transfer',
      token: asset.address as string,
      recipient: counterparty,
      amountBaseUnits: amount,
    };
  } else {
    operation = {
      kind: 'erc20_approve',
      token: asset.address as string,
      spender: counterparty,
      amountBaseUnits: amount,
    };
    if (baseUnits === MAX_UINT256) {
      warnings.push({
        severity: 'warning',
        code: 'UNLIMITED_ALLOWANCE',
        message: 'This is an unlimited token allowance. The owner should review it with extra care.',
        path: 'amount',
      });
    }
  }

  return {
    status: 'proposed',
    operation,
    asset,
    purpose: output.purpose as string,
    messages: warnings,
  };
}
