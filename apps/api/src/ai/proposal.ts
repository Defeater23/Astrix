import { randomUUID } from 'node:crypto';
import { validateContext } from './context.js';
import { interpretModelOutput } from './modelOutput.js';
import { buildCompletionRequest, checkRequestText } from './prompt.js';
import { ProviderError } from './provider.js';
import type { AiProvider } from './provider.js';
import { AI_PROPOSAL_SCHEMA_VERSION } from './types.js';
import type {
  AiTransactionProposal,
  ProposalContext,
  ProposalLimits,
  ProposalMessage,
  ProposalMessageCode,
} from './types.js';

/**
 * Orchestrates one proposal: validate input, ask the provider (bounded by a deadline), validate the
 * untrusted output against the trusted context, and return a record. It never signs, approves,
 * mutates policy or submits anything, and it has no access to any capability that could. Expected
 * failures (bad input, bad model output, provider errors) come back as a proposal with a non-
 * `proposed` status; only a bad application context throws.
 */

export interface ProposalDeps {
  provider: AiProvider;
  limits: ProposalLimits;
  /** Injectable for deterministic tests and demos. */
  newId?: () => string;
  /** Injectable clock, unix seconds. */
  nowSeconds?: () => number;
}

export interface ProposalInput {
  request: string;
  context: ProposalContext;
}

const NOT_AUTHORIZATION: ProposalMessage = {
  severity: 'info',
  code: 'NOT_AUTHORIZATION',
  message:
    'This is a proposal only. It is not policy-checked, not approved, not signed and not executed. Only the owner approval and on-chain policy can authorize execution.',
};

const MOCK_NOTE: ProposalMessage = {
  severity: 'info',
  code: 'MOCK_OUTPUT',
  message: 'Produced by the deterministic mock adapter, not by a language model.',
};

const PROVIDER_MESSAGES: Record<string, { code: ProposalMessageCode; message: string }> = {
  not_configured: { code: 'PROVIDER_NOT_CONFIGURED', message: 'The AI provider is not configured.' },
  timeout: { code: 'PROVIDER_TIMEOUT', message: 'The AI provider did not answer in time.' },
  rate_limited: { code: 'PROVIDER_RATE_LIMITED', message: 'The AI provider is rate limiting requests.' },
  http_error: { code: 'PROVIDER_HTTP_ERROR', message: 'The AI provider returned an error.' },
  network_error: { code: 'PROVIDER_NETWORK_ERROR', message: 'The AI provider could not be reached.' },
  bad_response: { code: 'PROVIDER_BAD_RESPONSE', message: 'The AI provider returned an unusable response.' },
};

class DeadlineExceeded extends Error {}

function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DeadlineExceeded());
    }, timeoutMs);
  });
  // `run` is invoked inside a promise so a synchronous throw becomes a rejection.
  const work = new Promise<T>((resolve, reject) => {
    run(controller.signal).then(resolve, reject);
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function describeProviderFailure(failure: unknown): ProposalMessage {
  // Only the error KIND is used. Raw error text can carry secrets or response bodies and is dropped.
  const kind = failure instanceof DeadlineExceeded ? 'timeout' : failure instanceof ProviderError ? failure.kind : undefined;
  const mapped = kind ? PROVIDER_MESSAGES[kind] : undefined;
  return {
    severity: 'error',
    code: mapped?.code ?? 'PROVIDER_ERROR',
    message: mapped?.message ?? 'The AI provider failed.',
  };
}

export async function generateProposal(
  deps: ProposalDeps,
  input: ProposalInput,
): Promise<AiTransactionProposal> {
  const { context } = input;
  validateContext(context);

  const now = Math.floor((deps.nowSeconds ?? (() => Date.now() / 1000))());
  const base: AiTransactionProposal = {
    schemaVersion: AI_PROPOSAL_SCHEMA_VERSION,
    proposalId: (deps.newId ?? (() => `prop-${randomUUID()}`))(),
    createdAt: now,
    expiresAt: now + deps.limits.proposalTtlSeconds,
    status: 'invalid',
    authorization: 'none',
    source: deps.provider.source,
    originalRequest: typeof input.request === 'string' ? input.request : '',
    chainId: context.chainId,
    account: context.account.toLowerCase(),
    agent: context.agent.toLowerCase(),
    owner: context.owner.toLowerCase(),
    messages: [NOT_AUTHORIZATION, ...(deps.provider.source.kind === 'mock' ? [MOCK_NOTE] : [])],
  };

  const requestProblems = checkRequestText(input.request, deps.limits);
  if (requestProblems.length > 0) {
    return { ...base, status: 'invalid', messages: [...base.messages, ...requestProblems] };
  }

  const completion = buildCompletionRequest(input.request, context, deps.limits);
  let text: unknown;
  try {
    const result = await withDeadline(
      (signal) => deps.provider.complete(completion, { signal }),
      deps.limits.timeoutMs,
    );
    text = (result as { text?: unknown } | null | undefined)?.text;
  } catch (failure) {
    return {
      ...base,
      status: 'provider_error',
      messages: [...base.messages, describeProviderFailure(failure)],
    };
  }

  const interpreted = interpretModelOutput(text, context, deps.limits.maxOutputChars);
  if (interpreted.status === 'proposed') {
    return {
      ...base,
      status: 'proposed',
      operation: interpreted.operation,
      asset: interpreted.asset,
      purpose: interpreted.purpose,
      messages: [...base.messages, ...interpreted.messages],
    };
  }
  return { ...base, status: interpreted.status, messages: [...base.messages, ...interpreted.messages] };
}
