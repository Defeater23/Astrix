import { Secret } from './secret.js';
import { MAX_PROPOSAL_TTL_SECONDS } from './types.js';
import type { ProposalLimits } from './types.js';

/**
 * Environment-driven AI configuration (server side only). Nothing here is ever sent to the browser:
 * the frontend reads only `VITE_`-prefixed variables and none of the names below start with `VITE_`.
 */

export type AiProviderName = 'mock' | 'anthropic';

export interface AiConfig {
  provider: AiProviderName;
  /** Required for `anthropic`. Wrapped so it cannot be printed by accident. */
  apiKey: Secret | undefined;
  model: string | undefined;
  baseUrl: string;
  limits: ProposalLimits;
}

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigError';
  }
}

export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

const DEFAULTS = {
  timeoutMs: 20_000,
  maxOutputTokens: 512,
  maxRequestChars: 1_000,
  maxOutputChars: 8_000,
  proposalTtlSeconds: 3_600,
} as const;

type Env = Readonly<Record<string, string | undefined>>;

function readInt(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^[0-9]+$/.test(raw.trim())) {
    throw new AiConfigError(`${name} must be a whole number.`);
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new AiConfigError(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function readBaseUrl(env: Env): string {
  const raw = env.AI_API_BASE_URL?.trim();
  if (!raw) return DEFAULT_ANTHROPIC_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AiConfigError('AI_API_BASE_URL must be a valid URL.');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new AiConfigError('AI_API_BASE_URL must use https (http is allowed only for localhost).');
  }
  if (url.username || url.password) {
    throw new AiConfigError('AI_API_BASE_URL must not embed credentials.');
  }
  return url.origin;
}

/**
 * Reads configuration from an environment object (pass `process.env`). Defaults to the deterministic
 * mock so a fresh checkout never calls an external service. Error messages never include the key.
 */
export function loadAiConfig(env: Env): AiConfig {
  const providerRaw = (env.AI_PROVIDER ?? 'mock').trim().toLowerCase();
  if (providerRaw !== 'mock' && providerRaw !== 'anthropic') {
    throw new AiConfigError('AI_PROVIDER must be "mock" or "anthropic".');
  }
  const provider: AiProviderName = providerRaw;

  const limits: ProposalLimits = {
    timeoutMs: readInt(env, 'AI_TIMEOUT_MS', DEFAULTS.timeoutMs, 100, 120_000),
    maxOutputTokens: readInt(env, 'AI_MAX_OUTPUT_TOKENS', DEFAULTS.maxOutputTokens, 16, 4_096),
    maxRequestChars: readInt(env, 'AI_MAX_REQUEST_CHARS', DEFAULTS.maxRequestChars, 1, 4_000),
    maxOutputChars: DEFAULTS.maxOutputChars,
    proposalTtlSeconds: readInt(
      env,
      'AI_PROPOSAL_TTL_SECONDS',
      DEFAULTS.proposalTtlSeconds,
      60,
      MAX_PROPOSAL_TTL_SECONDS,
    ),
  };

  const baseUrl = readBaseUrl(env);
  const model = env.AI_MODEL?.trim() || undefined;
  const keyRaw = env.AI_API_KEY?.trim();
  const apiKey = keyRaw ? new Secret(keyRaw) : undefined;

  if (provider === 'anthropic') {
    if (!apiKey) throw new AiConfigError('AI_API_KEY is required when AI_PROVIDER=anthropic.');
    if (!model) throw new AiConfigError('AI_MODEL is required when AI_PROVIDER=anthropic.');
  }

  return { provider, apiKey, model, baseUrl, limits };
}

/** Safe-to-log view of the configuration. Never includes the key. */
export function describeConfig(config: AiConfig): Record<string, unknown> {
  return {
    provider: config.provider,
    model: config.model ?? null,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey ? '[set]' : '[not set]',
    limits: config.limits,
  };
}
