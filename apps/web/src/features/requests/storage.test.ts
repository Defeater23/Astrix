import { describe, expect, it } from 'vitest';
import { cancel, decide, submit } from './registry';
import { loadRequests, requestStorageKey, saveRequests } from './storage';
import type { RequestStorageLike } from './storage';
import {
  CHAIN,
  NOW,
  OWNER,
  SPENDER,
  numbered,
  rawRequest,
  recordOf,
  storeWith,
  validated,
} from './fixtures';
import type { RequestStore } from './types';

const SCOPE = { chainId: CHAIN, owner: OWNER };
const CTX = { supportedChainIds: [11155111, 31337] };

function memory(
  initial: Record<string, string> = {},
): RequestStorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? (data[k] as string) : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

function stored(store: RequestStore): string {
  return JSON.stringify({ version: 1, records: Object.values(store) });
}

function mutate(
  store: RequestStore,
  id: string,
  edit: (record: Record<string, unknown>) => void,
): string {
  const records = JSON.parse(stored(store)) as { records: Record<string, unknown>[] };
  const target = records.records.find((r) => (r.request as { requestId: string }).requestId === id);
  if (!target) throw new Error('fixture');
  edit(target);
  return JSON.stringify(records);
}

function approvedStore(): RequestStore {
  const store = storeWith(numbered(1), numbered(2));
  const r = decide(store, 'req-1', 'approved', {
    reviewedFingerprint: recordOf(store, 'req-1').fingerprint,
    now: NOW + 1,
  });
  if (!r.ok) throw new Error(r.message);
  return r.store;
}

describe('request storage', () => {
  it('scopes the key by chain and lowercased owner', () => {
    expect(requestStorageKey(11155111, '0xABCDEF0000000000000000000000000000000001')).toBe(
      'sentinel-wallet:requests:v1:11155111:0xabcdef0000000000000000000000000000000001',
    );
  });

  it('round-trips a store with decisions and history intact', () => {
    const store = approvedStore();
    const storage = memory();
    expect(saveRequests(storage, SCOPE, store)).toBe(true);
    const loaded = loadRequests(storage, SCOPE, CTX);
    expect(loaded).toMatchObject({ dropped: 0, corrupt: false });
    expect(loaded.store).toEqual(store);
  });

  it('returns an empty store when nothing is saved or storage is unavailable', () => {
    expect(loadRequests(memory(), SCOPE, CTX)).toEqual({ store: {}, dropped: 0, corrupt: false });
    expect(loadRequests(undefined, SCOPE, CTX)).toEqual({ store: {}, dropped: 0, corrupt: false });
    expect(saveRequests(undefined, SCOPE, {})).toBe(false);
  });

  it('flags unreadable storage as corrupt and reports write failures', () => {
    const key = requestStorageKey(CHAIN, OWNER);
    for (const raw of [
      'not json',
      '{}',
      '{"version":2,"records":[]}',
      '{"version":1,"records":5}',
      'null',
      '[]',
    ]) {
      expect(loadRequests(memory({ [key]: raw }), SCOPE, CTX).corrupt).toBe(true);
    }
    const throwing: RequestStorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadRequests(throwing, SCOPE, CTX).corrupt).toBe(true);
    expect(saveRequests(throwing, SCOPE, {})).toBe(false);
  });

  it('drops a record whose payload was edited without updating its fingerprint', () => {
    const raw = mutate(approvedStore(), 'req-1', (r) => {
      (r.request as { operation: { value: string } }).operation.value = '5';
    });
    const loaded = loadRequests(memory({ [requestStorageKey(CHAIN, OWNER)]: raw }), SCOPE, CTX);
    expect(Object.keys(loaded.store)).toEqual(['req-2']);
    expect(loaded.dropped).toBe(1);
  });

  it('drops a pending record edited to look approved (no history for it)', () => {
    const raw = mutate(storeWith(numbered(1)), 'req-1', (r) => {
      r.status = 'approved';
      r.approvedFingerprint = r.fingerprint;
    });
    expect(
      loadRequests(memory({ [requestStorageKey(CHAIN, OWNER)]: raw }), SCOPE, CTX).store,
    ).toEqual({});
  });

  it('drops an approved record with a mismatched approvedFingerprint', () => {
    const raw = mutate(approvedStore(), 'req-1', (r) => {
      r.approvedFingerprint = 'something-else';
    });
    expect(
      Object.keys(
        loadRequests(memory({ [requestStorageKey(CHAIN, OWNER)]: raw }), SCOPE, CTX).store,
      ),
    ).toEqual(['req-2']);
  });

  it('drops records with forged or impossible history', () => {
    const raw = mutate(approvedStore(), 'req-1', (r) => {
      (r.history as { actor: string }[])[1]!.actor = 'agent';
    });
    expect(
      Object.keys(
        loadRequests(memory({ [requestStorageKey(CHAIN, OWNER)]: raw }), SCOPE, CTX).store,
      ),
    ).toEqual(['req-2']);
  });

  it('drops unknown statuses, extra record fields in the request, and bad supersededBy', () => {
    const base = storeWith(numbered(1));
    const key = requestStorageKey(CHAIN, OWNER);
    const unknownStatus = mutate(base, 'req-1', (r) => {
      r.status = 'authorized';
    });
    const extraField = mutate(base, 'req-1', (r) => {
      (r.request as Record<string, unknown>).admin = true;
    });
    const strayLink = mutate(base, 'req-1', (r) => {
      r.supersededBy = 'req-2';
    });
    for (const raw of [unknownStatus, extraField, strayLink]) {
      expect(loadRequests(memory({ [key]: raw }), SCOPE, CTX).store).toEqual({});
    }
  });

  it('drops a superseded record that does not name its replacement', () => {
    const store = storeWith(numbered(1));
    const result = submit(
      store,
      validated(rawRequest({ requestId: 'req-1b', purpose: 'v2' }, { nonce: '1' })),
      NOW + 1,
      {
        supersedes: 'req-1',
      },
    );
    if (result.kind !== 'created') throw new Error('fixture');
    const good = loadRequests(
      memory({ [requestStorageKey(CHAIN, OWNER)]: stored(result.store) }),
      SCOPE,
      CTX,
    );
    expect(Object.keys(good.store).sort()).toEqual(['req-1', 'req-1b']);
    const raw = mutate(result.store, 'req-1', (r) => {
      delete r.supersededBy;
    });
    expect(
      Object.keys(
        loadRequests(memory({ [requestStorageKey(CHAIN, OWNER)]: raw }), SCOPE, CTX).store,
      ),
    ).toEqual(['req-1b']);
  });

  it('drops records for another owner or chain', () => {
    const storage = memory({ [requestStorageKey(CHAIN, OWNER)]: stored(storeWith(numbered(1))) });
    expect(loadRequests(storage, SCOPE, CTX).dropped).toBe(0);
    const wrongOwner = memory({
      [requestStorageKey(CHAIN, SPENDER)]: stored(storeWith(numbered(1))),
    });
    expect(loadRequests(wrongOwner, { chainId: CHAIN, owner: SPENDER }, CTX).dropped).toBe(1);
    const wrongChain = memory({
      [requestStorageKey(31337, OWNER)]: stored(storeWith(numbered(1))),
    });
    expect(loadRequests(wrongChain, { chainId: 31337, owner: OWNER }, CTX).dropped).toBe(1);
  });

  it('keeps one record per request id', () => {
    const one = storeWith(numbered(1));
    const raw = JSON.stringify({
      version: 1,
      records: [...Object.values(one), ...Object.values(one)],
    });
    const loaded = loadRequests(memory({ [requestStorageKey(CHAIN, OWNER)]: raw }), SCOPE, CTX);
    expect(Object.keys(loaded.store)).toEqual(['req-1']);
    expect(loaded.dropped).toBe(1);
  });

  it('reloads expired and finished requests without re-applying the time checks', () => {
    const store = storeWith(numbered(1));
    const cancelled = cancel(store, 'req-1', 'agent', NOW + 5);
    if (!cancelled.ok) throw new Error('fixture');
    const loaded = loadRequests(
      memory({ [requestStorageKey(CHAIN, OWNER)]: stored(cancelled.store) }),
      SCOPE,
      CTX,
    );
    expect(recordOf(loaded.store, 'req-1').status).toBe('cancelled');
  });

  it('documents the limit: a fully self-consistent forgery cannot be detected here', () => {
    // An attacker who can edit browser storage can write a valid-looking record, including a
    // consistent "approved" history. Storage is not trusted; release requires 7C evidence.
    const forged = approvedStore();
    const loaded = loadRequests(
      memory({ [requestStorageKey(CHAIN, OWNER)]: stored(forged) }),
      SCOPE,
      CTX,
    );
    expect(recordOf(loaded.store, 'req-1').status).toBe('approved');
  });
});
