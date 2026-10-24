import { encodeFunctionData, recoverTypedDataAddress } from 'viem';
import type { Address, Hex } from 'viem';
import type { AuthorizationVerifier, AuthorizationVerdict } from '../requests/release';
import { requestFingerprint } from '../requests/schema';
import type { RequestPayload } from '../requests/types';
import {
  MAX_APPROVAL_LIFETIME_SECONDS,
  OWNER_APPROVAL_ABI,
  approvalDigest,
  approvalTypedData,
  buildApprovalMessage,
} from './typedData';
import type { ApprovalTypedData, OwnerApprovalMessage } from './typedData';

/**
 * Module 7C client side: build what the owner signs, check the signature locally, and give the
 * Module 7B release gate evidence it can trust. EVERYTHING HERE IS ADVISORY. A local "valid" means
 * "this would pass the contract's checks"; `SentinelOwnerApproval.submitApproval` verifies the
 * signature again on-chain and `SentinelApprovalKernelHook` consumes it at execution. If this file
 * and the contract disagree, the contract wins.
 */

/** secp256k1 n / 2. Larger `s` values are malleable twins and the contract rejects them. */
const HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

export type VerifyFailureCode =
  | 'INVALID_CONFIG'
  | 'FINGERPRINT_MISMATCH'
  | 'EXPIRED'
  | 'LIFETIME_TOO_LONG'
  | 'BAD_SIGNATURE_FORMAT'
  | 'HIGH_S_SIGNATURE'
  | 'RECOVERY_FAILED'
  | 'SIGNER_NOT_OWNER'
  | 'SIGNER_NOT_CHAIN_OWNER';

export interface VerifiedOwnerApproval {
  readonly requestId: string;
  readonly fingerprint: string;
  readonly digest: Hex;
  readonly signer: Address;
  readonly signature: Hex;
  readonly chainId: number;
  readonly verifyingContract: Address;
  readonly message: OwnerApprovalMessage;
}

export type VerifyResult =
  | { ok: true; approval: VerifiedOwnerApproval }
  | { ok: false; code: VerifyFailureCode; reason: string };

export interface VerifyInput {
  request: RequestPayload;
  /** Fingerprint stored with the 7B record. Must equal the request's own recomputed fingerprint. */
  fingerprint: string;
  signature: string;
  /** Deployed `SentinelOwnerApproval` address. */
  verifyingContract: string;
  nowSeconds: number;
  /**
   * `SentinelPolicy.owner()` as read from the chain. When given, the signer must equal it. Without
   * it only the request's own `owner` field is compared, which is data from the same source.
   */
  chainOwner?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

/** Objects returned by `verifyOwnerSignature`. Spoofed copies are rejected by the sync verifier. */
const issued = new WeakSet<object>();

function fail(code: VerifyFailureCode, reason: string): VerifyResult {
  return { ok: false, code, reason };
}

/** Recovers the signer from the exact request and checks every client-checkable binding. */
export async function verifyOwnerSignature(input: VerifyInput): Promise<VerifyResult> {
  const { request, nowSeconds } = input;
  const op = request.operation;

  if (!ADDRESS.test(input.verifyingContract)) {
    return fail('INVALID_CONFIG', 'The approval contract address is missing or malformed.');
  }
  if (input.chainOwner !== undefined && !ADDRESS.test(input.chainOwner)) {
    return fail('INVALID_CONFIG', 'The on-chain owner address is malformed.');
  }
  if (requestFingerprint(request) !== input.fingerprint) {
    return fail('FINGERPRINT_MISMATCH', 'The request no longer matches the fingerprint on record.');
  }
  if (op.expiresAt <= nowSeconds) return fail('EXPIRED', 'The approval has expired.');
  if (op.expiresAt > nowSeconds + MAX_APPROVAL_LIFETIME_SECONDS) {
    return fail('LIFETIME_TOO_LONG', 'The approval lifetime exceeds what the contract accepts.');
  }
  if (!SIGNATURE.test(input.signature)) {
    return fail('BAD_SIGNATURE_FORMAT', 'The signature must be 65 bytes (r, s, v).');
  }
  const s = BigInt(`0x${input.signature.slice(66, 130)}`);
  if (s > HALF_N) {
    return fail('HIGH_S_SIGNATURE', 'The signature uses a non-canonical high-s value.');
  }

  const typed = approvalTypedData(request, input.verifyingContract);
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({
      domain: typed.domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: typed.message,
      signature: input.signature as Hex,
    });
  } catch {
    return fail('RECOVERY_FAILED', 'The signer could not be recovered from the signature.');
  }

  if (signer.toLowerCase() !== request.owner.toLowerCase()) {
    return fail('SIGNER_NOT_OWNER', 'The signature was not made by the owner named in the request.');
  }
  if (input.chainOwner !== undefined && signer.toLowerCase() !== input.chainOwner.toLowerCase()) {
    return fail('SIGNER_NOT_CHAIN_OWNER', 'The signer is not the owner recorded on-chain.');
  }

  const approval: VerifiedOwnerApproval = Object.freeze({
    requestId: request.requestId,
    fingerprint: input.fingerprint,
    digest: approvalDigest(request, input.verifyingContract),
    signer,
    signature: input.signature as Hex,
    chainId: op.chainId,
    verifyingContract: input.verifyingContract.toLowerCase() as Address,
    message: Object.freeze(buildApprovalMessage(request)),
  });
  issued.add(approval);
  return { ok: true, approval };
}

export interface SignInput extends Omit<VerifyInput, 'signature'> {
  /** wagmi `signTypedDataAsync` or any function that performs `eth_signTypedData_v4`. */
  signTypedData: (typedData: ApprovalTypedData) => Promise<string>;
}

export type SignResult = VerifyResult | { ok: false; code: 'USER_REJECTED' | 'SIGNING_FAILED'; reason: string };

/** Asks the owner's wallet to sign the exact typed approval, then verifies what came back. */
export async function signOwnerApproval(input: SignInput): Promise<SignResult> {
  const { signTypedData, ...rest } = input;
  let signature: string;
  try {
    signature = await signTypedData(approvalTypedData(input.request, input.verifyingContract));
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 4001 || code === 'ACTION_REJECTED') {
      return { ok: false, code: 'USER_REJECTED', reason: 'The signature request was rejected.' };
    }
    return { ok: false, code: 'SIGNING_FAILED', reason: 'The wallet could not sign the approval.' };
  }
  return verifyOwnerSignature({ ...rest, signature });
}

export interface OwnerAuthorizationConfig {
  verifyingContract: string;
  chainOwner?: string;
}

function invalid(reason: string): AuthorizationVerdict {
  return { valid: false, reason };
}

/**
 * The synchronous verifier the Module 7B release gate expects. It accepts only evidence issued by
 * `verifyOwnerSignature` in this module and re-derives the digest from the request being released,
 * so evidence for another request, contract, chain or expiry is refused. Not a security authority.
 */
export function createOwnerAuthorizationVerifier(
  config: OwnerAuthorizationConfig,
): AuthorizationVerifier {
  return {
    verify(check): AuthorizationVerdict {
      const evidence = check.evidence;
      if (typeof evidence !== 'object' || evidence === null || !issued.has(evidence)) {
        return invalid('The evidence was not produced by the owner-signature verifier.');
      }
      const a = evidence as VerifiedOwnerApproval;
      const op = check.request.operation;

      if (!ADDRESS.test(config.verifyingContract)) return invalid('The approval contract is not configured.');
      if (a.verifyingContract !== config.verifyingContract.toLowerCase()) {
        return invalid('The approval was made for a different approval contract.');
      }
      if (a.requestId !== check.request.requestId) return invalid('The approval is for another request.');
      if (a.fingerprint !== check.fingerprint || requestFingerprint(check.request) !== check.fingerprint) {
        return invalid('The request changed after it was signed.');
      }
      if (a.chainId !== op.chainId) return invalid('The approval was made for a different chain.');
      if (a.digest !== approvalDigest(check.request, config.verifyingContract)) {
        return invalid('The signed digest does not match this exact operation.');
      }
      if (a.signer.toLowerCase() !== check.request.owner.toLowerCase()) {
        return invalid('The signer is not the owner named in the request.');
      }
      if (config.chainOwner && a.signer.toLowerCase() !== config.chainOwner.toLowerCase()) {
        return invalid('The signer is not the owner recorded on-chain.');
      }
      if (op.expiresAt <= check.nowSeconds) return invalid('The approval has expired.');
      return { valid: true };
    },
  };
}

/** Calldata for `SentinelOwnerApproval.submitApproval`. Anyone may send it; the signature is the authority. */
export function submitApprovalCall(approval: VerifiedOwnerApproval): { to: Address; data: Hex } {
  return {
    to: approval.verifyingContract,
    data: encodeFunctionData({
      abi: OWNER_APPROVAL_ABI,
      functionName: 'submitApproval',
      args: [approval.message, approval.signature],
    }),
  };
}
