import { describe, expect, it } from 'vitest';
import type { AgentRecord } from './types';
import {
  DESCRIPTION_MAX,
  NAME_MAX,
  formatUtc,
  looksLikeSecret,
  parseUtcDateTime,
  validateRegistration,
} from './validation';
import type { RegistrationInput } from './validation';

const OWNER = '0x1234567890abcdef1234567890abcdef12345678';
const SIGNER = '0xAbCdEf0123456789aBcDeF0123456789abcdef01';
const NOW = 1_800_000_000;

function input(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  return {
    name: 'Research bot',
    description: '',
    signer: SIGNER.toLowerCase(),
    expiry: '',
    ...overrides,
  };
}

function record(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: 'a1',
    name: 'Existing',
    description: '',
    signer: '0x00000000000000000000000000000000000000a1',
    expiresAt: null,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function run(value: RegistrationInput, existing: AgentRecord[] = []) {
  return validateRegistration(value, { owner: OWNER, existing, nowSeconds: NOW });
}

describe('validateRegistration', () => {
  it('accepts a valid registration and checksums the signer', () => {
    const result = run(input({ name: '  Research bot  ' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Research bot');
      expect(result.value.expiresAt).toBe(null);
      expect(result.value.signer).toBe('0xabCDeF0123456789AbcdEf0123456789aBCDEF01');
    }
  });

  it('requires a name and enforces the length limit', () => {
    expect(run(input({ name: '   ' })).ok).toBe(false);
    expect(run(input({ name: 'x'.repeat(NAME_MAX + 1) })).ok).toBe(false);
    expect(run(input({ name: 'x'.repeat(NAME_MAX) })).ok).toBe(true);
  });

  it('rejects control and direction-override characters in the name', () => {
    expect(run(input({ name: 'bad\u0007name' })).ok).toBe(false);
    expect(run(input({ name: 'evil\u202Egnp.exe' })).ok).toBe(false);
  });

  it('limits the description and allows line breaks', () => {
    expect(run(input({ description: 'x'.repeat(DESCRIPTION_MAX + 1) })).ok).toBe(false);
    expect(run(input({ description: 'line one\nline two' })).ok).toBe(true);
    expect(run(input({ description: 'bad\u0000text' })).ok).toBe(false);
  });

  it('rejects an invalid, empty or zero-address signer', () => {
    expect(run(input({ signer: '' })).ok).toBe(false);
    expect(run(input({ signer: '0x123' })).ok).toBe(false);
    expect(run(input({ signer: `0x${'0'.repeat(40)}` })).ok).toBe(false);
  });

  it('rejects a mixed-case address with a wrong checksum', () => {
    expect(run(input({ signer: '0xAbCdEf0123456789aBcDeF0123456789abcdef01' })).ok).toBe(false);
  });

  it('rejects the owner account as the agent signer', () => {
    const result = run(input({ signer: OWNER.toUpperCase().replace('0X', '0x') }));
    expect(result.ok).toBe(false);
    const lower = run(input({ signer: OWNER }));
    expect(lower.ok).toBe(false);
    if (!lower.ok) expect(lower.errors.signer).toContain('owner');
  });

  it('rejects a private key or seed phrase pasted as the signer', () => {
    const key = `0x${'ab'.repeat(32)}`;
    const result = run(input({ signer: key }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.signer).toContain('private key');
    expect(looksLikeSecret('one two three four five six seven eight nine ten eleven twelve')).toBe(
      true,
    );
    expect(looksLikeSecret(SIGNER)).toBe(false);
  });

  it('rejects duplicate signers, including revoked ones', () => {
    const active = record({ signer: '0xabCDeF0123456789AbcdEf0123456789aBCDEF01' });
    expect(run(input(), [active]).ok).toBe(false);
    const revoked = record({ signer: active.signer, status: 'revoked' });
    const result = run(input(), [revoked]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.signer).toContain('revoked');
  });

  it('rejects a duplicate name unless the other agent is revoked', () => {
    expect(run(input({ name: 'existing' }), [record()]).ok).toBe(false);
    expect(run(input({ name: 'existing' }), [record({ status: 'revoked' })]).ok).toBe(true);
  });

  it('parses the expiry as UTC and requires it to be in the future', () => {
    const future = formatInput(NOW + 3600);
    const ok = run(input({ expiry: future }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.expiresAt).toBe(parseUtcDateTime(future));
    expect(run(input({ expiry: formatInput(NOW - 3600) })).ok).toBe(false);
    expect(run(input({ expiry: formatInput(NOW + 10) })).ok).toBe(false);
    expect(run(input({ expiry: 'tomorrow' })).ok).toBe(false);
  });

  it('collects every error at once', () => {
    const result = run(input({ name: '', signer: 'nope', expiry: 'x' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(['expiry', 'name', 'signer']);
    }
  });
});

function formatInput(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 16);
}

describe('parseUtcDateTime and formatUtc', () => {
  it('parses valid values and rejects impossible dates', () => {
    expect(parseUtcDateTime('1970-01-01T00:00')).toBe(0);
    expect(parseUtcDateTime('2026-02-30T10:00')).toBe(undefined);
    expect(parseUtcDateTime('2026-13-01T10:00')).toBe(undefined);
    expect(parseUtcDateTime('2026-01-01 10:00')).toBe(undefined);
  });

  it('formats deterministically in UTC', () => {
    expect(formatUtc(0)).toBe('1970-01-01 00:00 UTC');
    expect(formatUtc(parseUtcDateTime('2026-12-31T23:59') ?? -1)).toBe('2026-12-31 23:59 UTC');
  });
});
