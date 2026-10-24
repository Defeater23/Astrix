import { ProviderError } from '../provider.js';
import type { AiProvider, CompletionRequest, CompletionResult } from '../provider.js';
import { REQUEST_CLOSE_TAG, REQUEST_OPEN_TAG } from '../prompt.js';
import type { ProposalSource } from '../types.js';

/**
 * Deterministic scripted adapter for reproducible demos and automated tests. It is NOT an LLM and is
 * always labelled `mock` (`source.kind === 'mock'`, plus a MOCK_OUTPUT message on every proposal).
 *
 * Its output goes through exactly the same parsing and validation as real model output, so mock mode
 * exercises the real safety checks. For a given request it always returns the same text.
 */

export type MockScript = string | ProviderError | { hang: true };

export interface MockAdapterOptions {
  /** Exact (whitespace-normalised) request text to scripted reply, error, or a never-ending call. */
  scripts?: Readonly<Record<string, MockScript>>;
  /** Native asset symbol the rules treat as a native transfer. Default `ETH`. */
  nativeSymbol?: string;
}

const AMOUNT = '(\\d+(?:\\.\\d+)?)';
const SYMBOL = '([A-Za-z0-9]{1,20})';
const ADDRESS = '(0x[0-9a-fA-F]{40})';
const BECAUSE = '(?:\\s+because\\s+(.{1,200}))?';
const TRANSFER = new RegExp(`^(?:please\\s+)?(?:send|transfer|pay)\\s+${AMOUNT}\\s+${SYMBOL}\\s+to\\s+${ADDRESS}${BECAUSE}$`, 'i');
const APPROVE = new RegExp(`^(?:please\\s+)?approve\\s+${AMOUNT}\\s+${SYMBOL}\\s+(?:for|to)\\s+${ADDRESS}${BECAUSE}$`, 'i');

function normalise(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function extractRequest(user: string): string {
  const start = user.indexOf(REQUEST_OPEN_TAG);
  const end = user.lastIndexOf(REQUEST_CLOSE_TAG);
  if (start === -1 || end === -1 || end <= start) return normalise(user);
  return normalise(user.slice(start + REQUEST_OPEN_TAG.length, end));
}

export class MockAiProvider implements AiProvider {
  readonly source: ProposalSource = { kind: 'mock', provider: 'mock' };
  /** Every request received, so tests can assert exactly what a provider is ever shown. */
  readonly calls: CompletionRequest[] = [];
  readonly #scripts: Readonly<Record<string, MockScript>>;
  readonly #nativeSymbol: string;

  constructor(options: MockAdapterOptions = {}) {
    this.#scripts = options.scripts ?? {};
    this.#nativeSymbol = (options.nativeSymbol ?? 'ETH').toUpperCase();
  }

  complete(request: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(request);
    const text = extractRequest(request.user);

    const scripted = Object.hasOwn(this.#scripts, text) ? this.#scripts[text] : undefined;
    if (scripted !== undefined) {
      if (scripted instanceof ProviderError) return Promise.reject(scripted);
      if (typeof scripted === 'object') return new Promise<CompletionResult>(() => undefined);
      return Promise.resolve({ text: scripted });
    }
    return Promise.resolve({ text: JSON.stringify(this.#interpret(text)) });
  }

  #interpret(text: string): Record<string, string> {
    const transfer = TRANSFER.exec(text);
    if (transfer) {
      const [, amount = '', symbol = '', recipient = '', because] = transfer;
      const asset = symbol.toUpperCase();
      return {
        outcome: 'proposal',
        operation: asset === this.#nativeSymbol ? 'native_transfer' : 'erc20_transfer',
        asset,
        recipient,
        amount,
        purpose: because ?? 'Transfer requested in natural language (mock interpretation).',
      };
    }
    const approve = APPROVE.exec(text);
    if (approve) {
      const [, amount = '', symbol = '', spender = '', because] = approve;
      return {
        outcome: 'proposal',
        operation: 'erc20_approve',
        asset: symbol.toUpperCase(),
        spender,
        amount,
        purpose: because ?? 'Allowance requested in natural language (mock interpretation).',
      };
    }
    return {
      outcome: 'unsupported',
      reason: 'The mock adapter only understands "send|transfer|pay <amount> <SYMBOL> to <0x address>" and "approve <amount> <SYMBOL> for <0x address>".',
    };
  }
}
