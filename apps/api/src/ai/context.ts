import type { ProposalContext } from './types.js';

/**
 * The context is supplied by the application, not by the model, so a bad context is a programming
 * or configuration error: it throws instead of producing a proposal.
 */

export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SYMBOL_PATTERN = /^[A-Za-z0-9]{1,20}$/;

export class ProposalContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalContextError';
  }
}

export function validateContext(context: ProposalContext): void {
  const fail = (message: string): never => {
    throw new ProposalContextError(message);
  };
  if (!Number.isInteger(context.chainId) || context.chainId <= 0) fail('chainId must be a positive integer.');
  if (!context.supportedChainIds.includes(context.chainId)) {
    fail(`chainId ${context.chainId} is not in supportedChainIds.`);
  }
  for (const [name, value] of [
    ['account', context.account],
    ['agent', context.agent],
    ['owner', context.owner],
  ] as const) {
    if (!ADDRESS_PATTERN.test(value)) fail(`${name} must be a 20-byte hex address.`);
    if (value.toLowerCase() === ZERO_ADDRESS) fail(`${name} must not be the zero address.`);
  }
  if (!SYMBOL_PATTERN.test(context.nativeSymbol)) fail('nativeSymbol is invalid.');

  const seen = new Set<string>([context.nativeSymbol.toLowerCase()]);
  for (const token of context.tokens) {
    if (!SYMBOL_PATTERN.test(token.symbol)) fail(`Token symbol "${token.symbol}" is invalid.`);
    if (!ADDRESS_PATTERN.test(token.address) || token.address.toLowerCase() === ZERO_ADDRESS) {
      fail(`Token ${token.symbol} has an invalid address.`);
    }
    if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36) {
      fail(`Token ${token.symbol} decimals must be an integer from 0 to 36.`);
    }
    const key = token.symbol.toLowerCase();
    if (seen.has(key)) fail(`Token symbol "${token.symbol}" is duplicated or equals the native symbol.`);
    seen.add(key);
  }
}
