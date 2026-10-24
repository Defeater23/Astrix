import type { ProposalSource } from './types.js';

/**
 * Provider abstraction. Application logic depends only on this interface; each vendor lives behind
 * an adapter in `adapters/`. A provider receives text only: it is never given keys, signing
 * capabilities, account/owner addresses, or any tool that could submit a transaction.
 */

export interface CompletionRequest {
  /** Fixed instructions built by the application. */
  system: string;
  /** The delimited, validated natural-language request. */
  user: string;
  maxOutputTokens: number;
}

export interface CompletionResult {
  /** Raw model text. Untrusted until parsed and validated. */
  text: string;
}

export interface CompletionOptions {
  /** Aborted on timeout. Adapters should honour it; the orchestrator also enforces the deadline. */
  signal: AbortSignal;
}

export interface AiProvider {
  /** Identifies the producer so mock output can never be mistaken for LLM output. */
  readonly source: ProposalSource;
  complete(request: CompletionRequest, options: CompletionOptions): Promise<CompletionResult>;
}

export type ProviderErrorKind =
  | 'not_configured'
  | 'timeout'
  | 'rate_limited'
  | 'http_error'
  | 'network_error'
  | 'bad_response';

/** Error raised by adapters. Messages must never contain secrets or raw provider response bodies. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number | undefined;

  constructor(kind: ProviderErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
  }
}
