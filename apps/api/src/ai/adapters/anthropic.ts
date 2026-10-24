import { ProviderError } from '../provider.js';
import type {
  AiProvider,
  CompletionOptions,
  CompletionRequest,
  CompletionResult,
} from '../provider.js';
import { Secret } from '../secret.js';
import type { ProposalSource } from '../types.js';

/**
 * Adapter for the Anthropic Messages HTTP API (`POST /v1/messages`), called with plain `fetch` so no
 * SDK method is assumed. It is the only place that knows the vendor's wire format.
 *
 * Safety properties:
 * - The API key is read only here, from a `Secret`, and is sent only in the `x-api-key` header.
 * - Redirects are refused so the key can never be forwarded to another host.
 * - Errors carry a kind and an HTTP status only. Response bodies and header values are never copied
 *   into errors, logs or results.
 * - No tools, no `tool_choice`, no system capability: the model returns text and nothing else.
 *
 * STATUS: unit-tested with an injected `fetch`. NOT exercised against the live API in 8A.
 */

export const ANTHROPIC_API_VERSION = '2023-06-01';

export interface AnthropicProviderOptions {
  apiKey: Secret;
  model: string;
  /** Origin only, for example `https://api.anthropic.com`. */
  baseUrl: string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export class AnthropicProvider implements AiProvider {
  readonly source: ProposalSource;
  readonly #apiKey: Secret;
  readonly #model: string;
  readonly #url: string;
  readonly #fetch: typeof fetch;

  constructor(options: AnthropicProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#url = `${options.baseUrl.replace(/\/+$/, '')}/v1/messages`;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.source = { kind: 'llm', provider: 'anthropic', model: options.model };
  }

  async complete(request: CompletionRequest, options: CompletionOptions): Promise<CompletionResult> {
    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: 'POST',
        redirect: 'error',
        signal: options.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.#apiKey.reveal(),
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify({
          model: this.#model,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
        }),
      });
    } catch (failure) {
      if (options.signal.aborted || (failure instanceof Error && failure.name === 'AbortError')) {
        throw new ProviderError('timeout', 'The request to the AI provider timed out.');
      }
      throw new ProviderError('network_error', 'The AI provider could not be reached.');
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new ProviderError('rate_limited', 'The AI provider is rate limiting requests.', 429);
      }
      throw new ProviderError('http_error', `The AI provider answered with HTTP ${response.status}.`, response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderError('bad_response', 'The AI provider returned a body that is not JSON.');
    }
    const text = extractText(body);
    if (text === undefined) {
      throw new ProviderError('bad_response', 'The AI provider response had no text content.');
    }
    return { text };
  }
}

function extractText(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.length > 0 ? parts.join('') : undefined;
}
