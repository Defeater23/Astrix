import { describe, expect, it } from 'vitest';
import { keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createOwnerAuthorizationVerifier,
  signOwnerApproval,
  submitApprovalCall,
  verifyOwnerSignature,
} from './verify';
import type { VerifiedOwnerApproval } from './verify';
import { approvalTypedData } from './typedData';
import { evaluateRelease } from '../requests/release';
import type { ReleaseContext } from '../requests/release';
import { decide } from '../requests/registry';
import { requestFingerprint } from '../requests/schema';
import {
  ACCOUNT,
  NOW,
  RECIPIENT,
  TOKEN,
  encodeCall,
  rawRequest,
  recordOf,
  storeWith,
  validated,
} from '../requests/fixtures';
import type { RequestPayload } from '../requests/types';

// Throwaway keys derived from labels. They hold nothing and exist only in these tests.
const OWNER_KEY = keccak256('0x6f776e6572'); // "owner"
const OTHER_KEY = keccak256('0x6f74686572'); // "other"
const owner = privateKeyToAccount(OWNER_KEY);
const other = privateKeyToAccount(OTHER_KEY);

const CONTRACT = '0x00000000000000000000000000000000000d0b01';
const NOW_S = NOW + 60;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** A request whose `owner` is the test key, so a signature by `owner` is the right one. */
function ownedRequest(requestId = 'req-1', operation: Record<string, unknown> = {}) {
  return validated(rawRequest({ requestId, owner: owner.address }, operation));
}

async function signWith(
  account: ReturnType<typeof privateKeyToAccount>,
  request: RequestPayload,
  contract = CONTRACT,
): Promise<string> {
  return account.signTypedData(approvalTypedData(request, contract) as never);
}

async function good(requestId = 'req-1'): Promise<{
  request: RequestPayload;
  fingerprint: string;
  approval: VerifiedOwnerApproval;
}> {
  const v = ownedRequest(requestId);
  const signature = await signWith(owner, v.request);
  const result = await verifyOwnerSignature({
    request: v.request,
    fingerprint: v.fingerprint,
    signature,
    verifyingContract: CONTRACT,
    nowSeconds: NOW_S,
  });
  if (!result.ok) throw new Error(result.reason);
  return { request: v.request, fingerprint: v.fingerprint, approval: result.approval };
}

describe('verifyOwnerSignature', () => {
  it('accepts the owner signature over the exact request', async () => {
    const { approval, request } = await good();
    expect(approval.signer.toLowerCase()).toBe(owner.address.toLowerCase());
    expect(approval.requestId).toBe(request.requestId);
    expect(approval.digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('rejects a forged signature (another key)', async () => {
    const v = ownedRequest();
    const r = await verifyOwnerSignature({
      request: v.request,
      fingerprint: v.fingerprint,
      signature: await signWith(other, v.request),
      verifyingContract: CONTRACT,
      nowSeconds: NOW_S,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SIGNER_NOT_OWNER');
  });

  it('rejects a signature over an altered payload', async () => {
    const v = ownedRequest();
    const signature = await signWith(owner, v.request);
    const altered = validated(
      rawRequest(
        { requestId: 'req-1', owner: owner.address },
        { data: encodeCall('0xa9059cbb', RECIPIENT, 25_000_001n) },
        {
          kind: 'erc20_transfer',
          token: TOKEN,
          recipient: RECIPIENT,
          amountBaseUnits: '25000001',
        },
      ),
    );
    const r = await verifyOwnerSignature({
      request: altered.request,
      fingerprint: altered.fingerprint,
      signature,
      verifyingContract: CONTRACT,
      nowSeconds: NOW_S,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SIGNER_NOT_OWNER');
  });

  it('rejects a signature made for another approval contract (domain binding)', async () => {
    const v = ownedRequest();
    const signature = await signWith(owner, v.request, '0x00000000000000000000000000000000000d0b02');
    const r = await verifyOwnerSignature({
      request: v.request,
      fingerprint: v.fingerprint,
      signature,
      verifyingContract: CONTRACT,
      nowSeconds: NOW_S,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a signature made for another chain', async () => {
    const v = ownedRequest();
    const onOtherChain = ownedRequest('req-1', { chainId: 31337 });
    const signature = await signWith(owner, onOtherChain.request);
    const r = await verifyOwnerSignature({
      request: v.request,
      fingerprint: v.fingerprint,
      signature,
      verifyingContract: CONTRACT,
      nowSeconds: NOW_S,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects an expired approval', async () => {
    const v = ownedRequest();
    const r = await verifyOwnerSignature({
      request: v.request,
      fingerprint: v.fingerprint,
      signature: await signWith(owner, v.request),
      verifyingContract: CONTRACT,
      nowSeconds: v.request.operation.expiresAt,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('EXPIRED');
  });

  it('rejects when the stored fingerprint no longer matches the request', async () => {
    const v = ownedRequest();
    const r = await verifyOwnerSignature({
      request: v.request,
      fingerprint: `${v.fingerprint}x`,
      signature: await signWith(owner, v.request),
      verifyingContract: CONTRACT,
      nowSeconds: NOW_S,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FINGERPRINT_MISMATCH');
  });

  it('rejects malformed signatures', async () => {
    const v = ownedRequest();
    for (const bad of ['0x1234', '', `0x${'00'.repeat(64)}`, `0x${'zz'.repeat(65)}`]) {
      const r = await verifyOwnerSignature({
        request: v.request,
        fingerprint: v.fingerprint,
        signature: bad,
        verifyingContract: CONTRACT,
        nowSeconds: NOW_S,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('BAD_SIGNATURE_FORMAT');
    }
  });

  it('rejects the malleated high-s twin of a valid signature', async () => {
    const v = ownedRequest();
    const sig = await signWith(owner, v.request);
    const s = BigInt(`0x${sig.slice(66, 130)}`);
    const v2 = sig.slice(130) === '1b' ? '1c' : '1b';
    const twin = `0x${sig.slice(2, 66)}${(N - s).toString(16).padStart(64, '0')}${v2}`;
    const result = await verifyOwnerSignature({
      request: v.request,
      fingerprint: v.fingerprint,
      signature: twin,
      verifyingContract: CONTRACT,
      nowSeconds: NOW_S,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('HIGH_S_SIGNATURE');
  });

  it('requires the signer to equal the on-chain owner when one is supplied', async () => {
    const v = ownedRequest();
    const r = await verifyOwnerSignature({
      request: v.request,
      fingerprint: v.fingerprint,
      signature: await signWith(owner, v.request),
      verifyingContract: CONTRACT,
      nowSeconds: NOW_S,
      chainOwner: other.address,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SIGNER_NOT_CHAIN_OWNER');
  });

  it('rejects a malformed contract address', async () => {
    const v = ownedRequest();
    const r = await verifyOwnerSignature({
      request: v.request,
      fingerprint: v.fingerprint,
      signature: await signWith(owner, v.request),
      verifyingContract: '0x1234',
      nowSeconds: NOW_S,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_CONFIG');
  });
});

describe('signOwnerApproval', () => {
  it('signs through the supplied wallet function and verifies the result', async () => {
    const v = ownedRequest();
    const r = await signOwnerApproval({
      request: v.request,
      fingerprint: v.fingerprint,
      verifyingContract: CONTRACT,
      nowSeconds: NOW_S,
      signTypedData: (typed) => owner.signTypedData(typed as never),
    });
    expect(r.ok).toBe(true);
  });

  it('reports a rejected wallet prompt without a signature', async () => {
    const v = ownedRequest();
    const r = await signOwnerApproval({
      request: v.request,
      fingerprint: v.fingerprint,
      verifyingContract: CONTRACT,
      nowSeconds: NOW_S,
      signTypedData: () => Promise.reject(Object.assign(new Error('no'), { code: 4001 })),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('USER_REJECTED');
  });

  it('reports other wallet failures', async () => {
    const v = ownedRequest();
    const r = await signOwnerApproval({
      request: v.request,
      fingerprint: v.fingerprint,
      verifyingContract: CONTRACT,
      nowSeconds: NOW_S,
      signTypedData: () => Promise.reject(new Error('boom')),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SIGNING_FAILED');
  });

  it('refuses a wallet that signs with the wrong key', async () => {
    const v = ownedRequest();
    const r = await signOwnerApproval({
      request: v.request,
      fingerprint: v.fingerprint,
      verifyingContract: CONTRACT,
      nowSeconds: NOW_S,
      signTypedData: (typed) => other.signTypedData(typed as never),
    });
    expect(r.ok).toBe(false);
  });
});

describe('createOwnerAuthorizationVerifier', () => {
  const verifier = createOwnerAuthorizationVerifier({ verifyingContract: CONTRACT });

  it('accepts evidence issued for exactly this request', async () => {
    const { request, fingerprint, approval } = await good();
    expect(verifier.verify({ request, fingerprint, evidence: approval, nowSeconds: NOW_S })).toEqual({
      valid: true,
    });
  });

  it('rejects evidence that was not issued by verifyOwnerSignature', async () => {
    const { request, fingerprint, approval } = await good();
    const copy = { ...approval };
    const v = verifier.verify({ request, fingerprint, evidence: copy, nowSeconds: NOW_S });
    expect(v.valid).toBe(false);
    expect(verifier.verify({ request, fingerprint, evidence: 'sig', nowSeconds: NOW_S }).valid).toBe(
      false,
    );
    expect(verifier.verify({ request, fingerprint, evidence: null, nowSeconds: NOW_S }).valid).toBe(
      false,
    );
  });

  it('rejects evidence for a different request (replay across requests)', async () => {
    const { approval } = await good('req-1');
    const second = ownedRequest('req-2');
    const v = verifier.verify({
      request: second.request,
      fingerprint: second.fingerprint,
      evidence: approval,
      nowSeconds: NOW_S,
    });
    expect(v.valid).toBe(false);
  });

  it('rejects evidence after the request changed', async () => {
    const { request, approval } = await good();
    const altered: RequestPayload = {
      ...request,
      operation: { ...request.operation, data: `${request.operation.data.slice(0, -2)}ff` },
    };
    const v = verifier.verify({
      request: altered,
      fingerprint: requestFingerprint(altered),
      evidence: approval,
      nowSeconds: NOW_S,
    });
    expect(v.valid).toBe(false);
  });

  it('rejects expired evidence', async () => {
    const { request, fingerprint, approval } = await good();
    const v = verifier.verify({
      request,
      fingerprint,
      evidence: approval,
      nowSeconds: request.operation.expiresAt,
    });
    expect(v.valid).toBe(false);
  });

  it('rejects evidence made for a different approval contract', async () => {
    const { request, fingerprint, approval } = await good();
    const elsewhere = createOwnerAuthorizationVerifier({
      verifyingContract: '0x00000000000000000000000000000000000d0b02',
    });
    expect(
      elsewhere.verify({ request, fingerprint, evidence: approval, nowSeconds: NOW_S }).valid,
    ).toBe(false);
  });

  it('rejects when the configured chain owner differs from the signer', async () => {
    const { request, fingerprint, approval } = await good();
    const strict = createOwnerAuthorizationVerifier({
      verifyingContract: CONTRACT,
      chainOwner: other.address,
    });
    expect(
      strict.verify({ request, fingerprint, evidence: approval, nowSeconds: NOW_S }).valid,
    ).toBe(false);
  });

  it('is unusable without a configured contract', async () => {
    const { request, fingerprint, approval } = await good();
    const unconfigured = createOwnerAuthorizationVerifier({ verifyingContract: '' });
    expect(
      unconfigured.verify({ request, fingerprint, evidence: approval, nowSeconds: NOW_S }).valid,
    ).toBe(false);
  });
});

describe('Module 7B release gate with the real verifier', () => {
  const verifier = createOwnerAuthorizationVerifier({ verifyingContract: CONTRACT });

  function ctx(ownerAddress: string, nowSeconds = NOW_S): ReleaseContext {
    return {
      owner: ownerAddress,
      execution: {
        chainId: 11155111,
        account: ACCOUNT,
        nowSeconds,
        expectedNonce: '1',
        agentAuthorized: true,
      },
    };
  }

  async function approvedRecord() {
    // numbered(1) uses nonce 1 and the default owner; rebuild it for the test owner.
    const v = validated(rawRequest({ requestId: 'req-1', owner: owner.address }, { nonce: '1' }));
    let store = storeWith(v);
    const decided = decide(store, 'req-1', 'approved', {
      reviewedFingerprint: v.fingerprint,
      now: NOW + 1,
    });
    if (!decided.ok) throw new Error(decided.message);
    store = decided.store;
    return { record: recordOf(store, 'req-1'), v };
  }

  it('releases only with a verified owner signature', async () => {
    const { record, v } = await approvedRecord();
    const signed = await signOwnerApproval({
      request: v.request,
      fingerprint: v.fingerprint,
      verifyingContract: CONTRACT,
      nowSeconds: NOW_S,
      signTypedData: (typed) => owner.signTypedData(typed as never),
    });
    if (!signed.ok) throw new Error(signed.reason);
    const decision = evaluateRelease(record, ctx(owner.address), {
      verifier,
      evidence: signed.approval,
    });
    expect(decision.allowed).toBe(true);
  });

  it('stays blocked on an approved status without evidence', async () => {
    const { record } = await approvedRecord();
    const decision = evaluateRelease(record, ctx(owner.address), { verifier });
    expect(decision.allowed).toBe(false);
  });

  it('stays blocked when the evidence belongs to another request', async () => {
    const { record } = await approvedRecord();
    const foreign = await good('req-other');
    const decision = evaluateRelease(record, ctx(owner.address), {
      verifier,
      evidence: foreign.approval,
    });
    expect(decision.allowed).toBe(false);
  });
});

describe('submitApprovalCall', () => {
  it('targets the approval contract with the submitApproval selector', async () => {
    const { approval } = await good();
    const call = submitApprovalCall(approval);
    expect(call.to).toBe(CONTRACT);
    expect(call.data.slice(0, 10)).toMatch(/^0x[0-9a-f]{8}$/);
    expect(call.data.includes(approval.signature.slice(2))).toBe(true);
  });
});

