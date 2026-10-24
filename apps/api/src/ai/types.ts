/**
 * Module 8A types: the AI transaction-proposal schema and the trusted context it is built from.
 *
 * A proposal is ADVISORY DATA. It carries `authorization: 'none'` on purpose: producing a proposal
 * never authorizes, signs, approves or submits anything. Only the owner's signature verified by the
 * smart account and the on-chain policy (Modules 5 to 7) can authorize execution.
 *
 * The typed operations deliberately mirror the first three kinds of `TypedOperation` in
 * `apps/web/src/features/requests/types.ts` (Module 7B), so Module 8B can map a proposal onto a 7B
 * request without translation. `contract_call` is NOT supported in 8A (fails closed).
 */

export const AI_PROPOSAL_SCHEMA_VERSION = 1;

/** Typed operation. Amounts are exact integer base units as decimal strings, never floats. */
export type ProposalOperation =
  | { kind: 'native_transfer'; recipient: string; amountWei: string }
  | { kind: 'erc20_transfer'; token: string; recipient: string; amountBaseUnits: string }
  | { kind: 'erc20_approve'; token: string; spender: string; amountBaseUnits: string };

export type ProposalOperationKind = ProposalOperation['kind'];

export const SUPPORTED_OPERATION_KINDS: readonly ProposalOperationKind[] = [
  'native_transfer',
  'erc20_transfer',
  'erc20_approve',
];

/**
 * Outcome of proposal generation.
 * - `proposed`: passed every Module 8A check. NOT policy-checked, NOT approved, NOT executed.
 * - `invalid`: the request or the model output failed validation; no operation is attached.
 * - `unsupported`: the request asks for something outside the supported operation set.
 * - `provider_error`: the AI provider failed (timeout, HTTP error, misconfiguration, ...).
 */
export type ProposalStatus = 'proposed' | 'invalid' | 'unsupported' | 'provider_error';

export type MessageSeverity = 'error' | 'warning' | 'info';

export type ProposalMessageCode =
  // Input
  | 'REQUEST_EMPTY'
  | 'REQUEST_TOO_LONG'
  | 'REQUEST_INVALID_CHARACTERS'
  // Provider
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_HTTP_ERROR'
  | 'PROVIDER_NETWORK_ERROR'
  | 'PROVIDER_BAD_RESPONSE'
  | 'PROVIDER_ERROR'
  // Model output shape
  | 'OUTPUT_TOO_LARGE'
  | 'OUTPUT_NOT_JSON'
  | 'OUTPUT_NOT_OBJECT'
  | 'OUTPUT_UNKNOWN_FIELD'
  | 'OUTPUT_MISSING_FIELD'
  | 'OUTPUT_INVALID_FIELD'
  // Semantics
  | 'OPERATION_UNSUPPORTED'
  | 'MODEL_DECLINED'
  | 'CHAIN_MISMATCH'
  | 'ASSET_UNKNOWN'
  | 'ASSET_OPERATION_MISMATCH'
  | 'TOKEN_ADDRESS_MISMATCH'
  | 'AMOUNT_INVALID'
  | 'AMOUNT_ZERO'
  | 'AMOUNT_PRECISION'
  | 'AMOUNT_TOO_LARGE'
  | 'ADDRESS_INVALID'
  | 'PROHIBITED_ZERO_ADDRESS'
  | 'PROHIBITED_SELF_RECIPIENT'
  | 'UNLIMITED_ALLOWANCE'
  | 'PURPOSE_INVALID'
  // Always-present notes
  | 'MOCK_OUTPUT'
  | 'NOT_AUTHORIZATION';

export interface ProposalMessage {
  severity: MessageSeverity;
  code: ProposalMessageCode;
  message: string;
  /** Dotted path of the offending model-output field, where applicable. */
  path?: string;
}

/** Who produced the structured output. `mock` is never an LLM. */
export interface ProposalSource {
  kind: 'mock' | 'llm';
  /** Adapter name, e.g. `mock` or `anthropic`. */
  provider: string;
  /** Model identifier for `llm` sources. Absent for the mock. */
  model?: string;
}

/** Asset the operation moves. Resolved from the TRUSTED registry, never taken from the model. */
export interface ProposalAsset {
  type: 'native' | 'erc20';
  symbol: string;
  /** Integer 0 to 36. */
  decimals: number;
  /** Lowercase token address; absent for the native asset. */
  address?: string;
}

export interface AiTransactionProposal {
  schemaVersion: typeof AI_PROPOSAL_SCHEMA_VERSION;
  proposalId: string;
  /** Unix seconds (UTC). */
  createdAt: number;
  /** Unix seconds (UTC). Set by the application from configuration, never by the model. */
  expiresAt: number;
  status: ProposalStatus;
  /** Always `none`: a proposal is not an authorization of any kind. */
  authorization: 'none';
  source: ProposalSource;
  /** The natural-language request exactly as received. */
  originalRequest: string;
  /** Trusted context, copied from the application, never from the model. */
  chainId: number;
  account: string;
  agent: string;
  owner: string;
  /** Present only when `status` is `proposed`. */
  operation?: ProposalOperation;
  asset?: ProposalAsset;
  /** Model-supplied explanation, validated as plain text. Agent-supplied text, shown as such. */
  purpose?: string;
  messages: ProposalMessage[];
}

/** A token the application trusts on one chain. Decimals come from here, never from the model. */
export interface TrustedToken {
  symbol: string;
  address: string;
  decimals: number;
}

/**
 * Trusted, application-supplied context. Nothing in here is ever taken from model output, and the
 * model never sees account, agent or owner addresses.
 */
export interface ProposalContext {
  chainId: number;
  supportedChainIds: readonly number[];
  account: string;
  agent: string;
  owner: string;
  /** Native asset symbol on this chain (for example `ETH`). Always 18 decimals. */
  nativeSymbol: string;
  /** Tokens the application trusts on `chainId`. Unknown tokens fail closed. */
  tokens: readonly TrustedToken[];
}

/** Limits that bound proposal generation. Produced by `loadAiConfig` or set explicitly in tests. */
export interface ProposalLimits {
  timeoutMs: number;
  maxOutputTokens: number;
  maxRequestChars: number;
  maxOutputChars: number;
  /** Seconds the proposal stays valid. 1 to 7 days (matches the Module 7B maximum lifetime). */
  proposalTtlSeconds: number;
}

export const MAX_PROPOSAL_TTL_SECONDS = 7 * 86_400;
export const PURPOSE_MAX_LENGTH = 500;
export const MAX_UINT256 = (1n << 256n) - 1n;
