import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANTHROPIC_API_VERSION, AnthropicProvider } from './adapters/anthropic.js';
import { CONTEXT, LIMITS, RECIPIENT, fixedDeps } from './fixtures.js';
import { generateProposal } from './proposal.js';
import { ProviderError } from './provider.js';
import { Secret } from './secret.js';

const KEY = 'test-placeholder-key-not-real';
const request = { system: 'sys', user: 'usr', maxOutputTokens: 100 };
const signal = () => new AbortController().signal;

interface Captured { url: string; init: RequestInit }
function provider(handler: (captured: Captured) => Response | Promise<Response>, captured: Captured[] = []) {
  const fakeFetch = ((url: string, init: RequestInit) => {
    const entry = { url: String(url), init };
    captured.push(entry);
    return Promise.resolve(handler(entry));
  }) as unknown as typeof fetch;
  return new AnthropicProvider({ apiKey: new Secret(KEY), model: 'model-x', baseUrl: 'https://api.example.test/', fetch: fakeFetch });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = async (p: AnthropicProvider, signalValue = signal()) => {
  try { await p.complete(request, { signal: signalValue }); } catch (error) { return error; }
  throw new Error('expected a failure');
};

describe('AnthropicProvider (unit tests with an injected fetch; never calls the live API)', () => {
  it('sends the documented request shape and returns the text', async () => {
    const captured: Captured[] = [];
    const result = await provider(() => json({ content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] }), captured).complete(request, { signal: signal() });
    assert.equal(result.text, '{"a":1}');
    const [call] = captured;
    assert.ok(call);
    assert.equal(call.url, 'https://api.example.test/v1/messages');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.redirect, 'error');
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers['x-api-key'], KEY);
    assert.equal(headers['anthropic-version'], ANTHROPIC_API_VERSION);
    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    assert.deepEqual(body, { model: 'model-x', max_tokens: 100, system: 'sys', messages: [{ role: 'user', content: 'usr' }] });
    assert.ok(!('tools' in body) && !('tool_choice' in body), 'the model is given no tools');
    assert.ok(!String(call.init.body).includes(KEY), 'key must be in the header only');
  });

  it('labels itself as an llm source with the model name', () => {
    assert.deepEqual(provider(() => json({})).source, { kind: 'llm', provider: 'anthropic', model: 'model-x' });
  });

  it('maps HTTP failures to kinds and never leaks the response body or key', async () => {
    const echo = (status: number) => json({ error: { message: `bad key ${KEY}` } }, status);
    const limited = await failure(provider(() => echo(429)));
    assert.ok(limited instanceof ProviderError && limited.kind === 'rate_limited' && limited.status === 429);
    for (const status of [400, 401, 500, 503]) {
      const error = await failure(provider(() => echo(status)));
      assert.ok(error instanceof ProviderError && error.kind === 'http_error' && error.status === status);
      assert.ok(!error.message.includes(KEY));
    }
  });

  it('rejects unusable 200 responses', async () => {
    const notJson = await failure(provider(() => new Response('<html>', { status: 200 })));
    assert.ok(notJson instanceof ProviderError && notJson.kind === 'bad_response');
    for (const body of [null, {}, { content: 'x' }, { content: [] }, { content: [{ type: 'tool_use', id: 'x' }] }, { content: [{ type: 'text', text: 5 }] }]) {
      const error = await failure(provider(() => json(body)));
      assert.ok(error instanceof ProviderError && error.kind === 'bad_response', JSON.stringify(body));
    }
  });

  it('maps network failures and aborts, without echoing the underlying message', async () => {
    const network = await failure(new AnthropicProvider({ apiKey: new Secret(KEY), model: 'm', baseUrl: 'https://x.test', fetch: (() => Promise.reject(new Error(`connect failed with ${KEY}`))) as unknown as typeof fetch }));
    assert.ok(network instanceof ProviderError && network.kind === 'network_error' && !network.message.includes(KEY));

    const controller = new AbortController();
    controller.abort();
    const aborted = await failure(new AnthropicProvider({ apiKey: new Secret(KEY), model: 'm', baseUrl: 'https://x.test', fetch: (() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }))) as unknown as typeof fetch }), controller.signal);
    assert.ok(aborted instanceof ProviderError && aborted.kind === 'timeout');
  });

  it('works end to end through generateProposal and labels the result as llm', async () => {
    const reply = { outcome: 'proposal', operation: 'native_transfer', asset: 'ETH', recipient: RECIPIENT, amount: '1', purpose: 'Test' };
    const llm = provider(() => json({ content: [{ type: 'text', text: JSON.stringify(reply) }] }));
    const proposal = await generateProposal(fixedDeps(llm), { request: `send 1 ETH to ${RECIPIENT}`, context: CONTEXT });
    assert.equal(proposal.status, 'proposed');
    assert.equal(proposal.source.kind, 'llm');
    assert.equal(proposal.authorization, 'none');
    assert.ok(!JSON.stringify(proposal).includes(KEY));
  });

  it('a provider HTTP error becomes a provider_error proposal with no key in it', async () => {
    const llm = provider(() => json({ error: KEY }, 500));
    const proposal = await generateProposal(fixedDeps(llm), { request: `send 1 ETH to ${RECIPIENT}`, context: CONTEXT });
    assert.equal(proposal.status, 'provider_error');
    assert.ok(!JSON.stringify(proposal).includes(KEY));
  });

  it('enforces the deadline when fetch never answers', async () => {
    const stuck = new AnthropicProvider({ apiKey: new Secret(KEY), model: 'm', baseUrl: 'https://x.test', fetch: (() => new Promise(() => undefined)) as unknown as typeof fetch });
    const proposal = await generateProposal(fixedDeps(stuck, { ...LIMITS, timeoutMs: 40 }), { request: `send 1 ETH to ${RECIPIENT}`, context: CONTEXT });
    assert.equal(proposal.status, 'provider_error');
  });
});
