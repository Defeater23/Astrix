import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  hashTypedData,
  keccak256,
} from 'viem';
import type { Address, Hex } from 'viem';
import type { OperationRequest } from '../execution/types';
import type { RequestPayload } from '../requests/types';

/**
 * Module 7C: the owner approval message and its EIP-712 digest. It mirrors
 * `contracts/src/SentinelOwnerApproval.sol` field for field. Any change here must be made there too;
 * the shared known-answer vector in both test suites exists to catch drift.
 *
 * This file only builds and hashes. It decides nothing. The contract verifies the signature on-chain.
 */

export const OWNER_APPROVAL_NAME = 'SentinelOwnerApproval';
export const OWNER_APPROVAL_VERSION = '1';
export const OWNER_APPROVAL_PRIMARY_TYPE = 'OwnerApproval';

export const OWNER_APPROVAL_TYPES = {
  OwnerApproval: [
    { name: 'account', type: 'address' },
    { name: 'agent', type: 'address' },
    { name: 'operationId', type: 'bytes32' },
    { name: 'userOpNonce', type: 'uint256' },
    { name: 'executionHash', type: 'bytes32' },
    { name: 'expiry', type: 'uint64' },
  ],
} as const;

/** Kernel ERC-7579 ExecMode for a single plain CALL: all 32 bytes zero. */
export const SINGLE_CALL_MODE: Hex = `0x${'00'.repeat(32)}`;

/** Longest approval lifetime the contract accepts (`MAX_LIFETIME`). */
export const MAX_APPROVAL_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

const EXECUTE_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'mode', type: 'bytes32' },
      { name: 'executionCalldata', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

export interface OwnerApprovalMessage {
  account: Address;
  agent: Address;
  operationId: Hex;
  userOpNonce: bigint;
  executionHash: Hex;
  expiry: bigint;
}

export interface ApprovalDomain {
  name: typeof OWNER_APPROVAL_NAME;
  version: typeof OWNER_APPROVAL_VERSION;
  chainId: number;
  verifyingContract: Address;
}

/** `abi.encodePacked(target, value, data)`: the single-call execution calldata Kernel decodes. */
export function encodeSingleExecution(op: OperationRequest): Hex {
  return encodePacked(
    ['address', 'uint256', 'bytes'],
    [op.target as Address, BigInt(op.value), op.data as Hex],
  );
}

/** The exact bytes of `userOp.callData[4:]` the hook sees: `execute(mode, executionCalldata)`. */
export function executeCallData(op: OperationRequest): Hex {
  return encodeFunctionData({
    abi: EXECUTE_ABI,
    functionName: 'execute',
    args: [SINGLE_CALL_MODE, encodeSingleExecution(op)],
  });
}

/** What the on-chain hook uses to look the approval up: keccak256 of the exact execute call data. */
export function executionHashOf(op: OperationRequest): Hex {
  return keccak256(executeCallData(op));
}

/**
 * Single-use identifier. The contract never accepts the same operationId twice, so it must be unique
 * per request: it is derived from chain, account and the 7B request ID.
 */
export function operationIdOf(request: RequestPayload): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'string' }],
      [BigInt(request.operation.chainId), request.operation.account as Address, request.requestId],
    ),
  );
}

export function buildApprovalMessage(request: RequestPayload): OwnerApprovalMessage {
  const op = request.operation;
  return {
    account: op.account as Address,
    agent: op.agent as Address,
    operationId: operationIdOf(request),
    userOpNonce: BigInt(op.nonce),
    executionHash: executionHashOf(op),
    expiry: BigInt(op.expiresAt),
  };
}

export function approvalDomain(chainId: number, verifyingContract: string): ApprovalDomain {
  return {
    name: OWNER_APPROVAL_NAME,
    version: OWNER_APPROVAL_VERSION,
    chainId,
    verifyingContract: verifyingContract as Address,
  };
}

/** Arguments for `signTypedData` (viem, wagmi or `eth_signTypedData_v4`). */
export function approvalTypedData(request: RequestPayload, verifyingContract: string) {
  return {
    domain: approvalDomain(request.operation.chainId, verifyingContract),
    types: OWNER_APPROVAL_TYPES,
    primaryType: OWNER_APPROVAL_PRIMARY_TYPE,
    message: buildApprovalMessage(request),
  } as const;
}

export type ApprovalTypedData = ReturnType<typeof approvalTypedData>;

/** The digest the owner signs and the contract recovers against. */
export function approvalDigest(request: RequestPayload, verifyingContract: string): Hex {
  return hashTypedData(approvalTypedData(request, verifyingContract));
}

/** Digest of an explicit message, used by tests and the known-answer vector. */
export function digestOfMessage(
  message: OwnerApprovalMessage,
  chainId: number,
  verifyingContract: string,
): Hex {
  return hashTypedData({
    domain: approvalDomain(chainId, verifyingContract),
    types: OWNER_APPROVAL_TYPES,
    primaryType: OWNER_APPROVAL_PRIMARY_TYPE,
    message,
  });
}

/** Minimal ABI for the two owner-facing calls and the views the UI needs. */
export const OWNER_APPROVAL_ABI = [
  {
    type: 'function',
    name: 'submitApproval',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'a',
        type: 'tuple',
        components: [
          { name: 'account', type: 'address' },
          { name: 'agent', type: 'address' },
          { name: 'operationId', type: 'bytes32' },
          { name: 'userOpNonce', type: 'uint256' },
          { name: 'executionHash', type: 'bytes32' },
          { name: 'expiry', type: 'uint64' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'digest', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'revokeApproval',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'digest', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'statusOf',
    stateMutability: 'view',
    inputs: [{ name: 'digest', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;
