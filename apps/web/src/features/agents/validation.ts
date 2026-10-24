import type { Address } from 'viem';
import { getAddress, isAddress, zeroAddress } from 'viem';
import type { AgentRecord } from './types';

export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 280;
/** An expiry must be at least this far in the future so it is not already expired on save. */
export const MIN_EXPIRY_LEAD_SECONDS = 60;

export interface RegistrationInput {
  name: string;
  description: string;
  signer: string;
  /** "YYYY-MM-DDTHH:mm" interpreted as UTC, or empty for no expiry. */
  expiry: string;
}

export interface RegistrationContext {
  /** Connected owner EOA. An agent signer must never equal it. */
  owner: string;
  existing: readonly AgentRecord[];
  nowSeconds: number;
}

export type RegistrationField = 'name' | 'description' | 'signer' | 'expiry' | 'form';
export type RegistrationErrors = Partial<Record<RegistrationField, string>>;

export interface ValidRegistration {
  name: string;
  description: string;
  signer: Address;
  expiresAt: number | null;
}

export type RegistrationResult =
  { ok: true; value: ValidRegistration } | { ok: false; errors: RegistrationErrors };

/** Characters that can disguise text: C0/C1-style controls and bidirectional overrides. */
function hasUnsafeCharacters(text: string, allowNewline: boolean): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (allowNewline && code === 10) continue;
    if (code < 32 || (code >= 127 && code <= 159)) return true;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
  }
  return false;
}

/** Parses "YYYY-MM-DDTHH:mm" as UTC and returns Unix seconds, or undefined if invalid. */
export function parseUtcDateTime(text: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(ms);
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute;
  return roundTrips ? Math.floor(ms / 1000) : undefined;
}

/** Deterministic UTC display, for example "2026-12-31 23:59 UTC". */
export function formatUtc(seconds: number): string {
  const iso = new Date(seconds * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** True when the text looks like a private key or a seed phrase rather than an address. */
export function looksLikeSecret(text: string): boolean {
  const trimmed = text.trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(trimmed)) return true;
  return trimmed.split(/\s+/).filter(Boolean).length >= 12;
}

export function validateRegistration(
  input: RegistrationInput,
  context: RegistrationContext,
): RegistrationResult {
  const errors: RegistrationErrors = {};

  const name = input.name.trim();
  if (name.length === 0) errors.name = 'Enter a name for the agent.';
  else if (name.length > NAME_MAX) errors.name = `Use at most ${NAME_MAX} characters.`;
  else if (hasUnsafeCharacters(name, false)) {
    errors.name = 'The name contains control or direction-override characters.';
  } else if (
    context.existing.some(
      (agent) => agent.status !== 'revoked' && agent.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    errors.name = 'Another agent that is not revoked already uses this name.';
  }

  const description = input.description.trim();
  if (description.length > DESCRIPTION_MAX) {
    errors.description = `Use at most ${DESCRIPTION_MAX} characters.`;
  } else if (hasUnsafeCharacters(description, true)) {
    errors.description = 'The description contains control or direction-override characters.';
  }

  let signer: Address | undefined;
  const signerText = input.signer.trim();
  if (signerText.length === 0) {
    errors.signer = 'Enter the agent signer address.';
  } else if (looksLikeSecret(signerText)) {
    errors.signer =
      'This looks like a private key or seed phrase. Never enter one here: only a public address.';
  } else if (!isAddress(signerText)) {
    errors.signer = 'Enter a valid EVM address (checksum casing is enforced).';
  } else {
    const normalized = getAddress(signerText);
    if (normalized === zeroAddress) {
      errors.signer = 'The zero address cannot be an agent signer.';
    } else if (normalized.toLowerCase() === context.owner.toLowerCase()) {
      errors.signer =
        'The agent signer must differ from the owner account. The agent must never hold owner authority.';
    } else {
      const duplicate = context.existing.find(
        (agent) => agent.signer.toLowerCase() === normalized.toLowerCase(),
      );
      if (duplicate) {
        errors.signer =
          duplicate.status === 'revoked'
            ? 'This signer was revoked earlier and cannot be registered again. Use a new key.'
            : 'This signer is already registered.';
      } else {
        signer = normalized;
      }
    }
  }

  let expiresAt: number | null = null;
  const expiryText = input.expiry.trim();
  if (expiryText.length > 0) {
    const parsed = parseUtcDateTime(expiryText);
    if (parsed === undefined) {
      errors.expiry = 'Enter a valid date and time.';
    } else if (parsed < context.nowSeconds + MIN_EXPIRY_LEAD_SECONDS) {
      errors.expiry = 'The expiry must be in the future.';
    } else {
      expiresAt = parsed;
    }
  }

  if (Object.keys(errors).length > 0 || signer === undefined) return { ok: false, errors };
  return { ok: true, value: { name, description, signer, expiresAt } };
}
