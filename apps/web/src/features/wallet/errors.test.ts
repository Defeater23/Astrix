import { describe, expect, it } from 'vitest';
import { classifyWalletError, describeWalletError } from './errors';

describe('classifyWalletError', () => {
  it('detects user rejection by code and by name', () => {
    expect(classifyWalletError({ code: 4001 })).toBe('user-rejected');
    expect(classifyWalletError({ name: 'UserRejectedRequestError' })).toBe('user-rejected');
  });

  it('detects a pending request', () => {
    expect(classifyWalletError({ code: -32002 })).toBe('request-pending');
  });

  it('detects a missing provider', () => {
    expect(classifyWalletError({ name: 'ConnectorNotFoundError' })).toBe('no-provider');
  });

  it('detects chain problems', () => {
    expect(classifyWalletError({ code: 4902 })).toBe('chain-not-added');
    expect(classifyWalletError({ name: 'ChainNotConfiguredError' })).toBe('unsupported-chain');
  });

  it('walks the cause chain of wrapped errors', () => {
    const wrapped = { name: 'ConnectError', cause: { name: 'Wrapper', cause: { code: 4001 } } };
    expect(classifyWalletError(wrapped)).toBe('user-rejected');
  });

  it('returns unknown for anything else and tolerates non-objects', () => {
    expect(classifyWalletError(new Error('boom'))).toBe('unknown');
    expect(classifyWalletError(null)).toBe('unknown');
    expect(classifyWalletError('text')).toBe('unknown');
  });

  it('does not loop forever on circular causes', () => {
    const circular: { cause?: unknown } = {};
    circular.cause = circular;
    expect(classifyWalletError(circular)).toBe('unknown');
  });

  it('has a message for every kind', () => {
    for (const kind of [
      'user-rejected',
      'request-pending',
      'no-provider',
      'chain-not-added',
      'unsupported-chain',
      'unknown',
    ] as const) {
      expect(describeWalletError(kind).length).toBeGreaterThan(10);
    }
  });
});
