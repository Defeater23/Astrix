/**
 * Classifies provider/wallet errors into a small, testable set of kinds.
 * Errors are walked through their `cause` chain because wagmi and viem wrap
 * the original EIP-1193 provider error.
 */

export type WalletErrorKind =
  | 'user-rejected'
  | 'request-pending'
  | 'no-provider'
  | 'chain-not-added'
  | 'unsupported-chain'
  | 'unknown';

const MAX_DEPTH = 6;

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  cause?: unknown;
}

function asErrorLike(value: unknown): ErrorLike | undefined {
  return typeof value === 'object' && value !== null ? (value as ErrorLike) : undefined;
}

export function classifyWalletError(error: unknown): WalletErrorKind {
  let current = asErrorLike(error);
  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    const { name, code } = current;
    if (code === 4001 || name === 'UserRejectedRequestError') return 'user-rejected';
    if (code === -32002 || name === 'ResourceUnavailableRpcError') return 'request-pending';
    if (name === 'ConnectorNotFoundError') return 'no-provider';
    if (code === 4902 || name === 'SwitchChainError') return 'chain-not-added';
    if (name === 'ChainNotConfiguredError') return 'unsupported-chain';
    current = asErrorLike(current.cause);
  }
  return 'unknown';
}

const MESSAGES: Record<WalletErrorKind, string> = {
  'user-rejected': 'The request was rejected in MetaMask. Nothing was changed. You can try again.',
  'request-pending':
    'MetaMask already has a pending request. Open the MetaMask window and respond to it first.',
  'no-provider': 'MetaMask was not found in this browser. Install or enable the extension.',
  'chain-not-added':
    'MetaMask does not have this network yet, or the switch could not be completed. Add the network in MetaMask and retry.',
  'unsupported-chain': 'This network is not supported by the application.',
  unknown: 'The wallet reported an unexpected error. Nothing was changed. Try again.',
};

export function describeWalletError(kind: WalletErrorKind): string {
  return MESSAGES[kind];
}
