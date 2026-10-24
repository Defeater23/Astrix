import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../agents/storage';
import { isPolicyRecord, loadPolicies, policyStorageKey, savePolicies } from './storage';
import type { PolicyRecord } from './types';

const OWNER = '0x1234567890abcdef1234567890abcdef12345678';

const RECORD: PolicyRecord = {
  agentId: 'a1',
  perTxLimitWei: '100',
  dailyLimitWei: '1000',
  recipients: ['0x00000000000000000000000000000000000000a1'],
  tokens: [],
  contracts: [],
  selectors: ['0xa9059cbb'],
  state: 'draft',
  updatedAt: 1_800_000_000,
};

function memory(initial: Record<string, string> = {}): StorageLike {
  const data = { ...initial };
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('policy storage', () => {
  it('scopes by chain and owner and round-trips', () => {
    const key = policyStorageKey(31337, OWNER);
    expect(key).not.toBe(policyStorageKey(11155111, OWNER));
    const storage = memory();
    expect(savePolicies(storage, key, [RECORD])).toBe(true);
    expect(loadPolicies(storage, key).policies).toEqual([RECORD]);
  });

  it('rejects stored records that claim a state other than draft', () => {
    for (const state of ['submitted', 'confirmed', 'enforced']) {
      expect(isPolicyRecord({ ...RECORD, state })).toBe(false);
    }
    const storage = memory({
      k: JSON.stringify({ version: 1, policies: [{ ...RECORD, state: 'confirmed' }, RECORD] }),
    });
    const loaded = loadPolicies(storage, 'k');
    expect(loaded.policies).toEqual([RECORD]);
    expect(loaded.dropped).toBe(1);
  });

  it('rejects malformed limits, addresses and selectors', () => {
    expect(isPolicyRecord({ ...RECORD, perTxLimitWei: '-1' })).toBe(false);
    expect(isPolicyRecord({ ...RECORD, recipients: ['nope'] })).toBe(false);
    expect(isPolicyRecord({ ...RECORD, selectors: ['0xA9059CBB'] })).toBe(false);
  });

  it('flags unparsable data and survives write failures', () => {
    expect(loadPolicies(memory({ k: '{bad' }), 'k').corrupt).toBe(true);
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(savePolicies(failing, 'k', [RECORD])).toBe(false);
  });
});
