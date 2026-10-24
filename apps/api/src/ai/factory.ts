import { AnthropicProvider } from './adapters/anthropic.js';
import { MockAiProvider } from './adapters/mock.js';
import type { MockAdapterOptions } from './adapters/mock.js';
import type { AiConfig } from './config.js';
import { ProviderError } from './provider.js';
import type { AiProvider } from './provider.js';

/** Builds the provider named by the configuration. The only place that maps names to adapters. */
export function createProvider(
  config: AiConfig,
  extras: { mock?: MockAdapterOptions; fetch?: typeof fetch } = {},
): AiProvider {
  if (config.provider === 'mock') return new MockAiProvider(extras.mock);
  if (!config.apiKey || !config.model) {
    throw new ProviderError('not_configured', 'The anthropic provider needs AI_API_KEY and AI_MODEL.');
  }
  return new AnthropicProvider({
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
    ...(extras.fetch ? { fetch: extras.fetch } : {}),
  });
}
