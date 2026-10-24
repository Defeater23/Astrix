import { describe, expect, it } from 'vitest';
import { keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { approvalTypedData, executeCallData, executionHashOf } from '../authorization/typedData';
import {
  createOwnerAuthorizationVerifier,
  verifyOwnerSignature,
} from '../authorization/verify';
import type { VerifiedOwnerApproval } from '../authorization/verify';
import { EMPTY_LEDGER } from '../execution/tracker';
import type { Ledger } from '../execution/tracker';
import { decide } from '../requests/registry';
import type { ReleaseContext } from '../requests/release';
import { parseRequest } from '../requests/schema';
import {
  ACCOUNT,
  CHAIN,
  CTX,
  NOW,
  RECIPIENT,
  TOKEN,
  encodeCall,
  rawRequest,
  recordOf,
  storeWith,
  validated,
} from '../requests/fixtures';
import type { RequestRecord, RequestStore } from '../requests/types';
import {
  createSubmissionController,
  onChainStatusFromIndex,
  prepareExecution,
  recordInclusion,
  recordRejection,
  recordSignedApproval,
  snapshotForReview,
} from './flow';
import type { ExecutionPlan, OperationSender, SendOutcome } from './flow';

// Throwaway keys derived from labels; they hold nothing and exist only in these tests.
const owner = privateKeyToAccount(keccak256('0x6f776e6572')); // "owner"
const other = privateKeyToAccount(keccak256('0x6f74686572')); // "other"
const CONTRACT = '0x00000000000000000000000000000000000d0b01';
const NOW_S = NOW + 60;

function ctxAt(nowSeconds = NOW_S, expectedNonce = '7'): ReleaseContext {
  return {
    owner: owner.address,
    execution: {
      chainId: CHAIN,
      account: ACCOUNT,
      nowSeconds,
      expectedNonce,
      agentAuthorized: true,
    },
  };
}

const verifier = createOwnerAuthorizationVerifier({
  verifyingContract: CONTRACT,
  chainOwner: owner.address,
});

function ownedRequest(
  requestId = 'req-1',
  operation: Record<string, unknown> = {},
  typed?: Record<string, unknown>,
) {
  return validated(rawRequest({ requestId, owner: owner.address }, operation, typed));
}

async function signed(
  record: RequestRecord,
  account: ReturnType<typeof privateKeyToAccount> = owner,
): Promise<{ ok: true; approval: VerifiedOwnerApproval } | { ok: false }> {
  const signature = await account.signTypedData(
    approvalTypedData(record.request, CONTRACT) as never,
  );
  const result = await verifyOwnerSignature({
    request: record.request,
    fingerprint: record.fingerprint,
    signature,
    verifyingContract: CONTRACT,
    nowSeconds: NOW_S,
    chainOwner: owner.address,
  });
  return result.ok ? { ok: true, approval: result.approval } : { ok: false };
}

/** A fully approved request: reviewed, signed, recorded as approved. */
async function approvedScenario(
  requestId = 'req-1',
  operation: Record<string, unknown> = {},
  typed?: Record<string, unknown>,
) {
  const store0 = storeWith(ownedRequest(requestId, operation, typed));
  const review = snapshotForReview(recordOf(store0, requestId));
  const s = await signed(recordOf(store0, requestId));
  if (!s.ok) throw new Error('fixture signature invalid');
  const decision = recordSignedApproval(store0, requestId, review, s.approval, NOW_S);
  if (!decision.ok) throw new Error(decision.message);
  return { store: decision.store, record: recordOf(decision.store, requestId), review, approval: s.approval };
}

class FakeSender implements OperationSender {
  calls: ExecutionPlan[] = [];
  constructor(
    private readonly outcomes: SendOutcome[],
    private readonly delayMs = 0,
  ) {}
  async send(plan: ExecutionPlan): Promise<SendOutcome> {
    this.calls.push(plan);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const next = this.outcomes[Math.min(this.calls.length - 1, this.outcomes.length - 1)];
    if (!next) throw new Error('no outcome');
    return next;
  }
}

function plan(result: ReturnType<typeof prepareExecution>): ExecutionPlan {
  if (!result.ok) throw new Error(`expected a plan, got ${result.blocks.map((b) => b.code).join(',')}`);
  return result.plan;
}

function blockCodes(result: ReturnType<typeof prepareExecution>): string[] {
  return result.ok ? [] : result.blocks.map((b) => b.code);
}

async function ready(requestId = 'req-1') {
  const s = await approvedScenario(requestId);
  const prepared = prepareExecution({
    record: s.record,
    review: s.review,
    ctx: ctxAt(),
    approval: s.approval,
    verifier,
    onChainStatus: 'approved',
    ledger: EMPTY_LEDGER,
  });
  return { ...s, prepared };
}

describe('eligible approval to confirmed outcome', () => {
  it('releases only the reviewed, signed operation, and confirms only on receipt evidence', async () => {
    const s = await ready();
    const p = plan(s.prepared);
    expect(p.operation).toEqual(s.record.request.operation);
    expect(p.callData).toBe(executeCallData(s.record.request.operation));
    expect(p.executionHash).toBe(executionHashOf(s.record.request.operation));
    expect(p.executionHash).toBe(s.approval.message.executionHash);
    expect(p.executionHash).toBe(s.review.executionHash);
    expect(p.fingerprint).toBe(s.review.fingerprint);

    const sender = new FakeSender([{ kind: 'accepted', userOpHash: '0xabc' }]);
    const controller = createSubmissionController(sender);
    const sent = await controller.submit(p, s.prepared.ledger);
    expect(sent.sent).toBe(true);
    expect(sent.status).toBe('pending'); // accepted by a bundler is not confirmed

    const included = recordInclusion(sent.ledger, p.operationKey, {
      transactionHash: '0x1',
      blockNumber: 12,
      txStatus: 'success',
      userOpSuccess: true,
    });
    expect(included.status).toBe('confirmed');
  });

  it('maps on-chain status indexes to names', () => {
    expect(onChainStatusFromIndex(0)).toBe('none');
    expect(onChainStatusFromIndex(1)).toBe('approved');
    expect(onChainStatusFromIndex(2)).toBe('consumed');
    expect(onChainStatusFromIndex(3)).toBe('revoked');
    expect(onChainStatusFromIndex(4)).toBe(undefined);
  });
});

describe('rejection never submits', () => {
  it('a rejected request cannot produce an execution plan', async () => {
    const store0 = storeWith(ownedRequest());
    const review = snapshotForReview(recordOf(store0, 'req-1'));
    const rejected = recordRejection(store0, 'req-1', review, NOW_S);
    expect(rejected.ok).toBe(true);
    const record = recordOf(rejected.store, 'req-1');
    expect(record.status).toBe('rejected');

    // Even with a valid owner signature in hand, a rejected request is blocked.
    const s = await signed(recordOf(store0, 'req-1'));
    if (!s.ok) throw new Error('fixture');
    const result = prepareExecution({
      record,
      review,
      ctx: ctxAt(),
      approval: s.approval,
      verifier,
      onChainStatus: 'approved',
      ledger: EMPTY_LEDGER,
    });
    expect(blockCodes(result)).toContain('RELEASE_BLOCKED');
    const release = result.ok ? [] : (result.blocks.find((b) => b.code === 'RELEASE_BLOCKED')?.release ?? []);
    expect(release.map((b) => b.code)).toContain('NOT_APPROVED');
  });

  it('a pending request cannot be released, and the sender is never called', async () => {
    const store0 = storeWith(ownedRequest());
    const record = recordOf(store0, 'req-1');
    const review = snapshotForReview(record);
    const s = await signed(record);
    if (!s.ok) throw new Error('fixture');
    const result = prepareExecution({
      record,
      review,
      ctx: ctxAt(),
      approval: s.approval,
      verifier,
      onChainStatus: 'approved',
      ledger: EMPTY_LEDGER,
    });
    expect(result.ok).toBe(false);
    const sender = new FakeSender([{ kind: 'accepted', userOpHash: '0x1' }]);
    expect(sender.calls).toHaveLength(0);
  });

  it('the controller refuses an unregistered operation', async () => {
    const s = await ready();
    const p = plan(s.prepared);
    const sender = new FakeSender([{ kind: 'accepted', userOpHash: '0x1' }]);
    const out = await createSubmissionController(sender).submit(p, EMPTY_LEDGER);
    expect(out.sent).toBe(false);
    expect(sender.calls).toHaveLength(0);
  });

  it('recording an approval needs a signature over the reviewed payload', async () => {
    const store0 = storeWith(ownedRequest('req-1'), ownedRequest('req-2', { nonce: '8' }));
    const review1 = snapshotForReview(recordOf(store0, 'req-1'));
    const s2 = await signed(recordOf(store0, 'req-2'));
    if (!s2.ok) throw new Error('fixture');
    const wrong = recordSignedApproval(store0, 'req-1', review1, s2.approval, NOW_S);
    expect(wrong.ok).toBe(false);
    expect(recordOf(wrong.store, 'req-1').status).toBe('pending');
  });
});

describe('forged, expired and altered authorization', () => {
  it('rejects a signature made by another key before any approval exists', async () => {
    const store0 = storeWith(ownedRequest());
    const s = await signed(recordOf(store0, 'req-1'), other);
    expect(s.ok).toBe(false);
  });

  it('rejects a forged approval object that the verifier did not issue', async () => {
    const s = await approvedScenario();
    const forged = { ...s.approval, signer: owner.address } as VerifiedOwnerApproval;
    const result = prepareExecution({
      record: s.record,
      review: s.review,
      ctx: ctxAt(),
      approval: forged,
      verifier,
      onChainStatus: 'approved',
      ledger: EMPTY_LEDGER,
    });
    expect(blockCodes(result)).toContain('RELEASE_BLOCKED');
    expect(result.ok).toBe(false);
  });

  it('rejects an expired approval', async () => {
    const s = await approvedScenario();
    const late = s.record.request.operation.expiresAt + 1;
    const result = prepareExecution({
      record: s.record,
      review: s.review,
      ctx: ctxAt(late),
      approval: s.approval,
      verifier,
      onChainStatus: 'approved',
      ledger: EMPTY_LEDGER,
    });
    expect(result.ok).toBe(false);
    const release = result.ok ? [] : (result.blocks.find((b) => b.code === 'RELEASE_BLOCKED')?.release ?? []);
    expect(release.map((b) => b.code)).toContain('EXPIRED');
  });

  it('rejects a payload altered after it was reviewed and signed', async () => {
    const s = await approvedScenario();
    const tampered: RequestRecord = {
      ...s.record,
      request: {
        ...s.record.request,
        operation: { ...s.record.request.operation, value: '1' },
      },
    };
    const result = prepareExecution({
      record: tampered,
      review: s.review,
      ctx: ctxAt(),
      approval: s.approval,
      verifier,
      onChainStatus: 'approved',
      ledger: EMPTY_LEDGER,
    });
    expect(result.ok).toBe(false);
    const codes = blockCodes(result);
    expect(codes).toContain('REVIEW_MISMATCH');
    expect(codes).toContain('APPROVAL_MISMATCH');
    expect(codes).toContain('RELEASE_BLOCKED');
  });

  it('rejects when the reviewed snapshot is for a different request', async () => {
    const s = await approvedScenario();
    const otherStore = storeWith(ownedRequest('req-9', { nonce: '9' }));
    const wrongReview = snapshotForReview(recordOf(otherStore, 'req-9'));
    const result = prepareExecution({
      record: s.record,
      review: wrongReview,
      ctx: ctxAt(),
      approval: s.approval,
      verifier,
      onChainStatus: 'approved',
      ledger: EMPTY_LEDGER,
    });
    expect(blockCodes(result)).toContain('REVIEW_MISMATCH');
  });

  it('rejects another request’s approval being replayed', async () => {
    const a = await approvedScenario('req-1');
    const b = await approvedScenario('req-2', { nonce: '8' });
    const result = prepareExecution({
      record: b.record,
      review: b.review,
      ctx: ctxAt(NOW_S, '8'),
      approval: a.approval,
      verifier,
      onChainStatus: 'approved',
      ledger: EMPTY_LEDGER,
    });
    expect(result.ok).toBe(false);
    expect(blockCodes(result)).toContain('APPROVAL_MISMATCH');
  });

  it.each(['none', 'consumed', 'revoked'] as const)(
    'blocks when the on-chain approval is %s',
    async (status) => {
      const s = await approvedScenario();
      const result = prepareExecution({
        record: s.record,
        review: s.review,
        ctx: ctxAt(),
        approval: s.approval,
        verifier,
        onChainStatus: status,
        ledger: EMPTY_LEDGER,
      });
      expect(blockCodes(result)).toContain('APPROVAL_NOT_ON_CHAIN');
    },
  );
});

describe('nonce reuse and prohibited operations', () => {
  it('blocks a request whose nonce was already consumed on-chain', async () => {
    const s = await approvedScenario();
    const result = prepareExecution({
      record: s.record,
      review: s.review,
      ctx: ctxAt(NOW_S, '8'), // the account's next nonce moved past 7
      approval: s.approval,
      verifier,
      onChainStatus: 'approved',
      ledger: EMPTY_LEDGER,
    });
    expect(result.ok).toBe(false);
    const release = result.ok ? [] : (result.blocks.find((b) => b.code === 'RELEASE_BLOCKED')?.release ?? []);
    const rejections = release.flatMap((b) => b.rejections ?? []).map((r) => r.code);
    expect(rejections).toContain('NONCE_MISMATCH');
  });

  it('flags a different payload that reuses a tracked account, chain and nonce', async () => {
    const first = await ready('req-1');
    const second = await approvedScenario(
      'req-2',
      { nonce: '7', data: encodeCall('0xa9059cbb', RECIPIENT, 1n) },
      { kind: 'erc20_transfer', token: TOKEN, recipient: RECIPIENT, amountBaseUnits: '1' },
    );
    const result = prepareExecution({
      record: second.record,
      review: second.review,
      ctx: ctxAt(),
      approval: second.approval,
      verifier,
      onChainStatus: 'approved',
      ledger: first.prepared.ledger,
    });
    expect(result.ok).toBe(false);
    expect(blockCodes(result)).toContain('NONCE_CONFLICT');
  });

  it('refuses prohibited operations at request creation, so no approval can exist', () => {
    const toAccount = parseRequest(rawRequest({}, { target: ACCOUNT, data: '0x', value: '1' }, undefined), CTX);
    expect(toAccount.ok).toBe(false);
    const zeroAmount = parseRequest(
      rawRequest({}, {}, {
        kind: 'erc20_transfer',
        token: '0x00000000000000000000000000000000000d0c01',
        recipient: '0x00000000000000000000000000000000000d0e01',
        amountBaseUnits: '0',
      }),
      CTX,
    );
    expect(zeroAmount.ok).toBe(false);
  });

  it('keeps a policy-prohibited operation prohibited even with a valid approval', async () => {
    const s = await ready();
    const p = plan(s.prepared);
    const sender = new FakeSender([
      { kind: 'policy_rejected', reason: 'RecipientNotAllowed', revertData: '0xdeadbeef' },
    ]);
    const out = await createSubmissionController(sender).submit(p, s.prepared.ledger);
    expect(out.status).toBe('policy_rejected');
    // A second attempt is refused locally: it needs a new operation, not a retry.
    const again = await createSubmissionController(sender).submit(p, out.ledger);
    expect(again.sent).toBe(false);
    expect(sender.calls).toHaveLength(1);
  });
});

describe('duplicate submission and retries', () => {
  it('sends once when the same plan is submitted concurrently', async () => {
    const s = await ready();
    const p = plan(s.prepared);
    const sender = new FakeSender([{ kind: 'accepted', userOpHash: '0xabc' }], 15);
    const controller = createSubmissionController(sender);
    const [a, b] = await Promise.all([
      controller.submit(p, s.prepared.ledger),
      controller.submit(p, s.prepared.ledger),
    ]);
    expect(sender.calls).toHaveLength(1);
    expect([a.sent, b.sent].filter(Boolean)).toHaveLength(1);
  });

  it('refuses to resubmit a pending operation', async () => {
    const s = await ready();
    const p = plan(s.prepared);
    const sender = new FakeSender([{ kind: 'accepted', userOpHash: '0xabc' }]);
    const controller = createSubmissionController(sender);
    const first = await controller.submit(p, s.prepared.ledger);
    const second = await controller.submit(p, first.ledger);
    expect(second.sent).toBe(false);
    expect(sender.calls).toHaveLength(1);
  });

  it('allows a retry after a bundler error that produced no UserOperation hash', async () => {
    const s = await ready();
    const p = plan(s.prepared);
    const sender = new FakeSender([
      { kind: 'bundler_error', error: 'connection refused' },
      { kind: 'accepted', userOpHash: '0xabc' },
    ]);
    const controller = createSubmissionController(sender);
    const first = await controller.submit(p, s.prepared.ledger);
    expect(first.status).toBe('submission_failed');
    const second = await controller.submit(p, first.ledger);
    expect(second.sent).toBe(true);
    expect(second.status).toBe('pending');
    expect(sender.calls).toHaveLength(2);
    expect(second.ledger[p.operationKey]?.attempts).toBe(2);
  });

  it('does not retry when the bundler error already carries a UserOperation hash', async () => {
    const s = await ready();
    const p = plan(s.prepared);
    const sender = new FakeSender([{ kind: 'bundler_error', error: 'timeout', userOpHash: '0xabc' }]);
    const controller = createSubmissionController(sender);
    const first = await controller.submit(p, s.prepared.ledger);
    const second = await controller.submit(p, first.ledger);
    expect(second.sent).toBe(false);
    expect(sender.calls).toHaveLength(1);
  });

  it('records a throwing sender as an error and blocks a blind retry', async () => {
    const s = await ready();
    const p = plan(s.prepared);
    let calls = 0;
    const throwing: OperationSender = {
      send: () => {
        calls += 1;
        return Promise.reject(new Error('socket closed after write'));
      },
    };
    const controller = createSubmissionController(throwing);
    const first = await controller.submit(p, s.prepared.ledger);
    expect(first.status).toBe('error');
    const second = await controller.submit(p, first.ledger);
    expect(second.sent).toBe(false);
    expect(calls).toBe(1);
  });

  it('records a user rejection in the wallet as such', async () => {
    const s = await ready();
    const p = plan(s.prepared);
    const sender = new FakeSender([{ kind: 'user_rejected' }]);
    const out = await createSubmissionController(sender).submit(p, s.prepared.ledger);
    expect(out.status).toBe('user_rejected');
  });

  it('never overwrites a confirmed outcome with later evidence', async () => {
    const s = await ready();
    const p = plan(s.prepared);
    const sender = new FakeSender([{ kind: 'accepted', userOpHash: '0xabc' }]);
    const sent = await createSubmissionController(sender).submit(p, s.prepared.ledger);
    const done = recordInclusion(sent.ledger, p.operationKey, {
      transactionHash: '0x1',
      blockNumber: 3,
      txStatus: 'success',
      userOpSuccess: true,
    });
    const later = recordInclusion(done.ledger, p.operationKey, {
      transactionHash: '0x2',
      blockNumber: 4,
      txStatus: 'reverted',
    });
    expect(later.applied).toBe(false);
    expect(later.status).toBe('confirmed');
  });

  it('reports a reverted operation from receipt evidence', async () => {
    const s = await ready();
    const p = plan(s.prepared);
    const sender = new FakeSender([{ kind: 'accepted', userOpHash: '0xabc' }]);
    const sent = await createSubmissionController(sender).submit(p, s.prepared.ledger);
    const out = recordInclusion(sent.ledger, p.operationKey, {
      transactionHash: '0x1',
      blockNumber: 3,
      txStatus: 'success',
      userOpSuccess: false,
    });
    expect(out.status).toBe('reverted');
  });
});

describe('workflow state alone never releases', () => {
  it('an approved status without a verified signature is blocked', async () => {
    const store0 = storeWith(ownedRequest());
    const record0 = recordOf(store0, 'req-1');
    const review = snapshotForReview(record0);
    // Approve the workflow record directly, bypassing the signature step (the 7B registry allows it).
    const direct = decide(store0, 'req-1', 'approved', { reviewedFingerprint: review.fingerprint, now: NOW_S });
    if (!direct.ok) throw new Error(direct.message);
    const record = recordOf(direct.store, 'req-1');
    expect(record.status).toBe('approved');
    const s = await signed(record0, owner);
    if (!s.ok) throw new Error('fixture');
    const forged = { ...s.approval, digest: '0x' + '11'.repeat(32) } as VerifiedOwnerApproval;
    const result = prepareExecution({
      record,
      review,
      ctx: ctxAt(),
      approval: forged,
      verifier,
      onChainStatus: 'approved',
      ledger: EMPTY_LEDGER,
    });
    expect(result.ok).toBe(false);
  });

  it('does not mutate the store or ledger it was given', async () => {
    const s = await ready();
    const ledgerBefore: Ledger = EMPTY_LEDGER;
    expect(Object.keys(ledgerBefore)).toHaveLength(0);
    const storeBefore: RequestStore = s.store;
    expect(recordOf(storeBefore, 'req-1').status).toBe('approved');
  });
});
