import { MockAiProvider } from './adapters/mock.js';
import type { MockAdapterOptions } from './adapters/mock.js';
import type { AiProvider } from './provider.js';
import type { ProposalContext, ProposalLimits } from './types.js';

/** Shared deterministic fixtures for tests and the demo. All addresses and values are fake. */
export const ACCOUNT = '0x1111111111111111111111111111111111111111';
export const AGENT = '0x2222222222222222222222222222222222222222';
export const OWNER = '0x3333333333333333333333333333333333333333';
export const RECIPIENT = '0x4444444444444444444444444444444444444444';
export const USDC = '0x5555555555555555555555555555555555555555';
export const EVIL = '0x6666666666666666666666666666666666666666';

export const CONTEXT: ProposalContext = {
  chainId: 11155111,
  supportedChainIds: [11155111, 31337],
  account: ACCOUNT,
  agent: AGENT,
  owner: OWNER,
  nativeSymbol: 'ETH',
  tokens: [{ symbol: 'USDC', address: USDC, decimals: 6 }],
};

export const LIMITS: ProposalLimits = {
  timeoutMs: 1_000,
  maxOutputTokens: 512,
  maxRequestChars: 1_000,
  maxOutputChars: 8_000,
  proposalTtlSeconds: 3_600,
};

export const FIXED_NOW = 1_800_000_000;

export function fixedDeps(provider: AiProvider = new MockAiProvider(), limits = LIMITS) {
  let counter = 0;
  return {
    provider,
    limits,
    newId: () => `prop-test-${++counter}`,
    nowSeconds: () => FIXED_NOW,
  };
}

export function mock(options?: MockAdapterOptions): MockAiProvider {
  return new MockAiProvider(options);
}
