import { describe, expect, it } from 'vitest';
import type { StorageLike } from './storage';
import { agentStorageKey, isAgentRecord, loadAgents, saveAgents } from './storage';
import type { AgentRecord } from './types';

const OWNER = '0xAbCdEf0123456789aBcDeF0123456789abcdef01';

const RECORD: AgentRecord = {
  id: 'a1',
  name: 'Bot',
  description: 'desc',
  signer: '0x00000000000000000000000000000000000000a1',
  expiresAt: 1_900_000_000,
  status: 'paused',
  createdAt: 1_800_000_000,
  updatedAt: 1_800_000_100,
};

function memory(
  initial: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('agentStorageKey', () => {
  it('scopes by chain and lower-cased owner', () => {
    expect(agentStorageKey(11155111, OWNER)).toBe(agentStorageKey(11155111, OWNER.toLowerCase()));
    expect(agentStorageKey(11155111, OWNER)).not.toBe(agentStorageKey(31337, OWNER));
  });
});

describe('save and load', () => {
  it('round-trips records', () => {
    const storage = memory();
    const key = agentStorageKey(31337, OWNER);
    expect(saveAgents(storage, key, [RECORD])).toBe(true);
    const loaded = loadAgents(storage, key);
    expect(loaded.agents).toEqual([RECORD]);
    expect(loaded.dropped).toBe(0);
    expect(loaded.corrupt).toBe(false);
  });

  it('returns an empty result when nothing is stored or storage is missing', () => {
    expect(loadAgents(memory(), 'k').agents).toEqual([]);
    expect(loadAgents(undefined, 'k').corrupt).toBe(false);
  });

  it('flags unparsable data as corrupt', () => {
    const loaded = loadAgents(memory({ k: '{not json' }), 'k');
    expect(loaded.corrupt).toBe(true);
    expect(loaded.agents).toEqual([]);
    expect(
      loadAgents(memory({ k: JSON.stringify({ version: 99, agents: [] }) }), 'k').corrupt,
    ).toBe(true);
  });

  it('drops invalid records and counts them', () => {
    const storage = memory({
      k: JSON.stringify({
        version: 1,
        agents: [RECORD, { ...RECORD, id: 'bad', signer: 'not-an-address' }, 'junk', null],
      }),
    });
    const loaded = loadAgents(storage, 'k');
    expect(loaded.agents).toEqual([RECORD]);
    expect(loaded.dropped).toBe(3);
  });

  it('reports a failed save instead of throwing', () => {
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(saveAgents(failing, 'k', [RECORD])).toBe(false);
    expect(saveAgents(undefined, 'k', [RECORD])).toBe(false);
  });
});

describe('isAgentRecord', () => {
  it('rejects unknown statuses and bad timestamps', () => {
    expect(isAgentRecord({ ...RECORD, status: 'expired' })).toBe(false);
    expect(isAgentRecord({ ...RECORD, expiresAt: -1 })).toBe(false);
    expect(isAgentRecord({ ...RECORD, createdAt: 1.5 })).toBe(false);
    expect(isAgentRecord({ ...RECORD, expiresAt: null })).toBe(true);
  });
});
