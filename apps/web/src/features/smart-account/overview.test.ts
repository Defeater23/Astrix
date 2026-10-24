import { describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import type { ChainReader } from './overview';
import { describeReadError, fetchOverview } from './overview';

const OWNER = '0x1234567890abcdef1234567890abcdef12345678' as Address;
const ACCOUNT = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address;
const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address;

function makeReader(overrides: Partial<ChainReader> = {}): ChainReader {
  return {
    getBalance: vi.fn(async (address: Address) => (address === OWNER ? 5n : 7n)),
    getCode: vi.fn(async (address: Address): Promise<Hex> =>
      address === ENTRY_POINT ? '0x6080' : '0x',
    ),
    getEntryPointDeposit: vi.fn(async () => 3n),
    ...overrides,
  };
}

const base = { chainId: 11155111, owner: OWNER, entryPoint: ENTRY_POINT };

describe('fetchOverview', () => {
  it('reads owner balance and EntryPoint code, and skips account reads when none is configured', async () => {
    const reader = makeReader();
    const result = await fetchOverview(reader, { ...base, account: undefined });

    expect(result.ownerBalance).toEqual({ ok: true, value: 5n });
    expect(result.entryPointCode).toEqual({ ok: true, value: '0x6080' });
    expect(result.accountCode).toBeUndefined();
    expect(result.accountBalance).toBeUndefined();
    expect(result.entryPointDeposit).toBeUndefined();
    expect(reader.getEntryPointDeposit).not.toHaveBeenCalled();
  });

  it('reads the configured account code, balance and EntryPoint deposit', async () => {
    const result = await fetchOverview(makeReader(), { ...base, account: ACCOUNT });

    expect(result.accountCode).toEqual({ ok: true, value: '0x' });
    expect(result.accountBalance).toEqual({ ok: true, value: 7n });
    expect(result.entryPointDeposit).toEqual({ ok: true, value: 3n });
  });

  it('does not read the deposit when no EntryPoint contract exists on the chain', async () => {
    const reader = makeReader({ getCode: vi.fn(async () => '0x' as const) });
    const result = await fetchOverview(reader, { ...base, account: ACCOUNT });

    expect(result.entryPointDeposit).toEqual({
      ok: false,
      error: 'No EntryPoint contract found on this chain.',
    });
    expect(reader.getEntryPointDeposit).not.toHaveBeenCalled();
  });

  it('reports a failed read as an error without affecting other reads', async () => {
    const reader = makeReader({
      getBalance: vi.fn(async (address: Address) => {
        if (address === OWNER) throw new Error('rpc down\nstack line');
        return 7n;
      }),
    });
    const result = await fetchOverview(reader, { ...base, account: ACCOUNT });

    expect(result.ownerBalance).toEqual({ ok: false, error: 'rpc down' });
    expect(result.accountBalance).toEqual({ ok: true, value: 7n });
  });

  it('marks the deposit unavailable when the EntryPoint code read failed', async () => {
    const reader = makeReader({
      getCode: vi.fn(async (address: Address) => {
        if (address === ENTRY_POINT) throw new Error('timeout');
        return '0x' as const;
      }),
    });
    const result = await fetchOverview(reader, { ...base, account: ACCOUNT });

    expect(result.entryPointCode).toEqual({ ok: false, error: 'timeout' });
    expect(result.entryPointDeposit).toEqual({
      ok: false,
      error: 'EntryPoint code could not be read.',
    });
  });

  it('never invents data: every field is either a read value or an error', async () => {
    const failing: ChainReader = {
      getBalance: async () => {
        throw new Error('x');
      },
      getCode: async () => {
        throw new Error('x');
      },
      getEntryPointDeposit: async () => {
        throw new Error('x');
      },
    };
    const result = await fetchOverview(failing, { ...base, account: ACCOUNT });
    for (const field of [
      result.ownerBalance,
      result.entryPointCode,
      result.accountCode,
      result.accountBalance,
      result.entryPointDeposit,
    ]) {
      expect(field?.ok).toBe(false);
    }
  });
});

describe('describeReadError', () => {
  it('uses the first line only and truncates long messages', () => {
    expect(describeReadError(new Error('first\nsecond'))).toBe('first');
    expect(describeReadError(new Error('a'.repeat(300))).length).toBe(201);
  });

  it('handles non-Error values', () => {
    expect(describeReadError('boom')).toBe('boom');
    expect(describeReadError(new Error(''))).toBe('Unknown error');
  });
});
