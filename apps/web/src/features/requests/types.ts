import type { OperationRequest } from '../execution/types';

/**
 * Module 7B types: the approval request data model and its workflow. Everything here is
 * application state. A request marked `approved` records the owner's intent in this app; it is NOT
 * an authorization. Only the owner's signature (Module 7C) verified by the smart account and the
 * on-chain policy can authorize execution (see docs/REQUEST_WORKFLOW.md).
 */

export const REQUEST_SCHEMA_VERSION = 1;

/** Token display metadata supplied with the request. Not verified on-chain. */
export interface RequestTokenMeta {
  symbol: string;
  /** Integer 0 to 36. Display only; amounts always stay exact base units. */
  decimals: number;
}

/**
 * What the request claims to do, in typed form. It is redundant with the exact calldata on
 * purpose: validation requires both to agree, so an agent cannot show the owner one thing and
 * encode another. Amounts are decimal strings in base units.
 */
export type TypedOperation =
  | { kind: 'native_transfer'; recipient: string; amountWei: string }
  | { kind: 'erc20_transfer'; token: string; recipient: string; amountBaseUnits: string }
  | { kind: 'erc20_approve'; token: string; spender: string; amountBaseUnits: string }
  | { kind: 'contract_call'; target: string; selector: string; valueWei: string };

export type TypedOperationKind = TypedOperation['kind'];

/** A validated approval request payload. The `operation` is the exact payload that would execute. */
export interface RequestPayload {
  schemaVersion: typeof REQUEST_SCHEMA_VERSION;
  /** Client-chosen identifier, unique per owner and chain. */
  requestId: string;
  /** Owner address that is asked to review and (in 7C) sign. */
  owner: string;
  /** Unix seconds (UTC). */
  createdAt: number;
  /** What the agent says it is for. Agent-supplied text, shown as such. */
  purpose: string;
  /** Why owner approval is needed. */
  reason: string;
  tokenMeta?: RequestTokenMeta;
  typed: TypedOperation;
  /** Module 6 operation: account, agent, chainId, nonce, expiresAt, target, value, data. */
  operation: OperationRequest;
}

export type ValidationSeverity = 'error' | 'warning';

export type ValidationCode =
  | 'MALFORMED'
  | 'UNKNOWN_FIELD'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'INVALID_REQUEST_ID'
  | 'INVALID_OWNER'
  | 'INVALID_ACCOUNT'
  | 'INVALID_AGENT'
  | 'INVALID_TARGET'
  | 'UNSUPPORTED_CHAIN'
  | 'INVALID_NONCE'
  | 'INVALID_VALUE'
  | 'INVALID_CALLDATA'
  | 'INVALID_TIMESTAMP'
  | 'CREATED_IN_FUTURE'
  | 'EXPIRES_BEFORE_CREATION'
  | 'EXPIRED'
  | 'TTL_TOO_LONG'
  | 'INVALID_TEXT'
  | 'INVALID_TOKEN_META'
  | 'INVALID_TYPED_OPERATION'
  | 'KIND_MISMATCH'
  | 'PROHIBITED_ZERO_ADDRESS'
  | 'PROHIBITED_SELF_TARGET'
  | 'PROHIBITED_TOKEN_CALL_WITH_VALUE'
  | 'PROHIBITED_ZERO_AMOUNT'
  | 'UNLIMITED_ALLOWANCE'
  | 'UNDECODED_CALLDATA';

export interface ValidationIssue {
  code: ValidationCode;
  severity: ValidationSeverity;
  /** Dotted path of the offending field, e.g. `operation.target`. */
  path: string;
  message: string;
}

/** Result of schema validation. `request` is normalized (addresses and hex lowercased). */
export interface ValidatedRequest {
  request: RequestPayload;
  /** Canonical string over every material field. Display and change detection, NOT a signed digest. */
  fingerprint: string;
  /** Non-blocking findings the owner should see. */
  warnings: ValidationIssue[];
}

export type ParseResult =
  | { ok: true; value: ValidatedRequest }
  | { ok: false; issues: ValidationIssue[] };

/** Application workflow status. `approved` is NOT authorization. */
export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'superseded';

export type Actor = 'agent' | 'owner' | 'system';

export interface TransitionEntry {
  /** `null` for the creation entry. */
  from: RequestStatus | null;
  to: RequestStatus;
  /** Unix seconds (UTC). */
  at: number;
  actor: Actor;
  note?: string;
}

export interface RequestRecord {
  request: RequestPayload;
  fingerprint: string;
  status: RequestStatus;
  /** Fingerprint the owner had on screen when approving. Must equal `fingerprint` to stay valid. */
  approvedFingerprint?: string;
  /** Request that replaced this one, set when status is `superseded`. */
  supersededBy?: string;
  history: TransitionEntry[];
}

/** Records keyed by `requestId`. Immutable: every operation returns a new store. */
export type RequestStore = Readonly<Record<string, RequestRecord>>;

export const EMPTY_STORE: RequestStore = {};
