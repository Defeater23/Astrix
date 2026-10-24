import type { Address, Hex } from 'viem';
import { getAddress, isAddress, parseEther, zeroAddress } from 'viem';
import type { PolicyRecord } from './types';

export const MAX_LIST_ENTRIES = 50;
/** Sanity cap so a typo cannot create an effectively unlimited limit. */
export const MAX_LIMIT_ETH = 1_000_000;

export interface PolicyInput {
  perTxLimit: string;
  dailyLimit: string;
  recipients: string;
  tokens: string;
  contracts: string;
  selectors: string;
}

export type PolicyField = keyof PolicyInput | 'form';
export type PolicyErrors = Partial<Record<PolicyField, string>>;

export type PolicyResult =
  | { ok: true; value: Omit<PolicyRecord, 'agentId' | 'state' | 'updatedAt'> }
  | { ok: false; errors: PolicyErrors };

/** Parses a positive decimal ETH amount into exact wei. Never uses floating point. */
export function parseLimit(text: string): { ok: true; wei: bigint } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, error: 'Enter a limit.' };
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) {
    return { ok: false, error: 'Use a plain decimal number with at most 18 decimals.' };
  }
  const wei = parseEther(trimmed);
  if (wei <= 0n) return { ok: false, error: 'The limit must be greater than zero.' };
  if (wei > parseEther(String(MAX_LIMIT_ETH))) {
    return { ok: false, error: `The limit must not exceed ${MAX_LIMIT_ETH} ETH.` };
  }
  return { ok: true, wei };
}

function splitEntries(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseAddressList(
  text: string,
): { ok: true; list: Address[] } | { ok: false; error: string } {
  const entries = splitEntries(text);
  if (entries.length > MAX_LIST_ENTRIES) {
    return { ok: false, error: `Use at most ${MAX_LIST_ENTRIES} entries.` };
  }
  const seen = new Set<string>();
  const list: Address[] = [];
  for (const entry of entries) {
    if (!isAddress(entry)) {
      return {
        ok: false,
        error: `"${entry}" is not a valid address (checksum casing is enforced).`,
      };
    }
    const normalized = getAddress(entry);
    if (normalized === zeroAddress) return { ok: false, error: 'The zero address is not allowed.' };
    if (seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    list.push(normalized);
  }
  return { ok: true, list };
}

function parseSelectorList(text: string): { ok: true; list: Hex[] } | { ok: false; error: string } {
  const entries = splitEntries(text);
  if (entries.length > MAX_LIST_ENTRIES) {
    return { ok: false, error: `Use at most ${MAX_LIST_ENTRIES} entries.` };
  }
  const seen = new Set<string>();
  const list: Hex[] = [];
  for (const entry of entries) {
    if (!/^0x[0-9a-fA-F]{8}$/.test(entry)) {
      return { ok: false, error: `"${entry}" is not a 4-byte selector such as 0xa9059cbb.` };
    }
    const lower = entry.toLowerCase() as Hex;
    if (seen.has(lower)) continue;
    seen.add(lower);
    list.push(lower);
  }
  return { ok: true, list };
}

export function validatePolicy(input: PolicyInput): PolicyResult {
  const errors: PolicyErrors = {};

  const perTx = parseLimit(input.perTxLimit);
  if (!perTx.ok) errors.perTxLimit = perTx.error;
  const daily = parseLimit(input.dailyLimit);
  if (!daily.ok) errors.dailyLimit = daily.error;
  if (perTx.ok && daily.ok && daily.wei < perTx.wei) {
    errors.dailyLimit = 'The daily limit must be at least the per-transaction limit.';
  }

  const recipients = parseAddressList(input.recipients);
  if (!recipients.ok) errors.recipients = recipients.error;
  const tokens = parseAddressList(input.tokens);
  if (!tokens.ok) errors.tokens = tokens.error;
  const contracts = parseAddressList(input.contracts);
  if (!contracts.ok) errors.contracts = contracts.error;
  const selectors = parseSelectorList(input.selectors);
  if (!selectors.ok) errors.selectors = selectors.error;

  if (
    Object.keys(errors).length > 0 ||
    !perTx.ok ||
    !daily.ok ||
    !recipients.ok ||
    !tokens.ok ||
    !contracts.ok ||
    !selectors.ok
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      perTxLimitWei: perTx.wei.toString(),
      dailyLimitWei: daily.wei.toString(),
      recipients: recipients.list,
      tokens: tokens.list,
      contracts: contracts.list,
      selectors: selectors.list,
    },
  };
}

/** Parses a wei amount that was stored as a decimal string; undefined when malformed. */
export function parseStoredWei(text: string): bigint | undefined {
  return /^\d+$/.test(text) ? BigInt(text) : undefined;
}

/** Parses an optional decimal ETH amount into wei; empty means zero. Undefined when malformed. */
export function parseAmountWei(text: string): bigint | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0n;
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) return undefined;
  return parseEther(trimmed);
}
