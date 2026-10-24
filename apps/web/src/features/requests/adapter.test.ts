import { describe, expect, it } from 'vitest';
import { isDisplayableRequest } from '../approvals/guard';
import { cancel, decide } from './registry';
import { createWorkflowSource, toApprovalRequest } from './adapter';
import {
  CHAIN,
  NOW,
  OWNER,
  numbered,
  recordOf,
  storeWith,
  rawRequest,
  validated,
} from './fixtures';

describe('7A adapter', () => {
  it('maps a workflow record to the review-UI request shape and passes the 7A display guard', () => {
    const store = storeWith(numbered(1));
    const mapped = toApprovalRequest(recordOf(store, 'req-1'));
    expect(mapped.id).toBe('req-1');
    expect(mapped.operation).toEqual(recordOf(store, 'req-1').request.operation);
    expect(mapped.tokenMeta).toEqual({ symbol: 'DEMO', decimals: 6 });
    expect(isDisplayableRequest(mapped)).toBe(true);
  });

  it('omits tokenMeta when the request has none', () => {
    const store = storeWith(validated(rawRequest({ tokenMeta: undefined })));
    expect('tokenMeta' in toApprovalRequest(recordOf(store, 'req-1'))).toBe(false);
  });

  it('lists only active requests', async () => {
    let store = storeWith(numbered(1), numbered(2), numbered(3));
    const approved = decide(store, 'req-2', 'approved', {
      reviewedFingerprint: recordOf(store, 'req-2').fingerprint,
      now: NOW + 1,
    });
    if (!approved.ok) throw new Error('fixture');
    const cancelled = cancel(approved.store, 'req-3', 'agent', NOW + 2);
    if (!cancelled.ok) throw new Error('fixture');
    store = cancelled.store;
    const source = createWorkflowSource({ label: 'Workflow store', read: () => store });
    expect(source.kind).toBe('workflow');
    const items = await source.list({ owner: OWNER, chainId: CHAIN }, NOW);
    expect(items.map((i) => (i as { id: string }).id).sort()).toEqual(['req-1', 'req-2']);
  });
});
