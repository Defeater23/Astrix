import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { describe, it } from 'node:test';
import { AiConfigError, describeConfig, loadAiConfig } from './config.js';
import { createProvider } from './factory.js';
import { Secret, redact } from './secret.js';

const KEY = 'test-placeholder-key-not-real';

describe('loadAiConfig', () => {
  it('defaults to the mock provider with no key and safe limits', () => {
    const config = loadAiConfig({});
    assert.equal(config.provider, 'mock');
    assert.equal(config.apiKey, undefined);
    assert.equal(config.limits.timeoutMs, 20_000);
    assert.equal(config.limits.proposalTtlSeconds, 3_600);
    assert.equal(createProvider(config).source.kind, 'mock');
  });

  it('treats the empty placeholders from .env.example as unset', () => {
    const config = loadAiConfig({ AI_PROVIDER: 'mock', AI_API_KEY: '', AI_MODEL: '', AI_API_BASE_URL: '', AI_TIMEOUT_MS: '20000' });
    assert.equal(config.apiKey, undefined);
    assert.equal(config.model, undefined);
  });

  it('requires a key and a model for anthropic', () => {
    assert.throws(() => loadAiConfig({ AI_PROVIDER: 'anthropic', AI_MODEL: 'm' }), /AI_API_KEY/);
    assert.throws(() => loadAiConfig({ AI_PROVIDER: 'anthropic', AI_API_KEY: KEY }), /AI_MODEL/);
    const config = loadAiConfig({ AI_PROVIDER: 'Anthropic', AI_API_KEY: KEY, AI_MODEL: 'model-x' });
    assert.equal(config.provider, 'anthropic');
    assert.deepEqual(createProvider(config).source, { kind: 'llm', provider: 'anthropic', model: 'model-x' });
  });

  it('rejects unknown providers and invalid numbers', () => {
    assert.throws(() => loadAiConfig({ AI_PROVIDER: 'openai' }), AiConfigError);
    for (const [name, value] of [
      ['AI_TIMEOUT_MS', 'abc'], ['AI_TIMEOUT_MS', '5'], ['AI_TIMEOUT_MS', '-1'], ['AI_TIMEOUT_MS', '1.5'],
      ['AI_MAX_OUTPUT_TOKENS', '0'], ['AI_MAX_REQUEST_CHARS', '999999'],
      ['AI_PROPOSAL_TTL_SECONDS', '10'], ['AI_PROPOSAL_TTL_SECONDS', String(7 * 86_400 + 1)],
    ] as const) {
      assert.throws(() => loadAiConfig({ [name]: value }), AiConfigError, `${name}=${value}`);
    }
    assert.equal(loadAiConfig({ AI_PROPOSAL_TTL_SECONDS: String(7 * 86_400) }).limits.proposalTtlSeconds, 7 * 86_400);
  });

  it('only allows https base URLs (http for localhost) without embedded credentials', () => {
    assert.throws(() => loadAiConfig({ AI_API_BASE_URL: 'http://example.com' }), AiConfigError);
    assert.throws(() => loadAiConfig({ AI_API_BASE_URL: 'not a url' }), AiConfigError);
    assert.throws(() => loadAiConfig({ AI_API_BASE_URL: 'https://user:pw@example.com' }), AiConfigError);
    assert.equal(loadAiConfig({ AI_API_BASE_URL: 'http://localhost:8080/x' }).baseUrl, 'http://localhost:8080');
    assert.equal(loadAiConfig({ AI_API_BASE_URL: 'https://proxy.example.com/' }).baseUrl, 'https://proxy.example.com');
  });

  it('never prints the key: not in JSON, strings, inspect, describeConfig or error messages', () => {
    const config = loadAiConfig({ AI_PROVIDER: 'anthropic', AI_API_KEY: KEY, AI_MODEL: 'model-x' });
    for (const text of [JSON.stringify(config), String(config.apiKey), `${config.apiKey}`, inspect(config, { depth: 5 }), JSON.stringify(describeConfig(config))]) {
      assert.ok(!text.includes(KEY), 'key leaked');
    }
    assert.equal(config.apiKey?.reveal(), KEY);
    assert.throws(() => loadAiConfig({ AI_PROVIDER: 'anthropic', AI_API_KEY: KEY, AI_TIMEOUT_MS: 'bad' }), (error: Error) => !error.message.includes(KEY));
  });

  it('redact removes every occurrence of a secret', () => {
    assert.equal(redact(`a ${KEY} b ${KEY}`, new Secret(KEY)), 'a [redacted] b [redacted]');
    assert.equal(redact('plain', undefined), 'plain');
  });
});
