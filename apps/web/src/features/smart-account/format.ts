import { formatEther } from 'viem';
import { SUPPORTED_CHAINS } from '../wallet/chains';
import type { ReadResult } from './overview';

/** Native currency symbol reported by the chain definition (for example ETH). */
export function nativeSymbol(chainId: number): string {
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.nativeCurrency.symbol ?? 'native';
}

/**
 * Exact decimal string for a wei amount. formatEther works on bigint strings, so no floating-point
 * arithmetic is involved.
 */
export function formatNative(wei: bigint, chainId: number): string {
  return `${formatEther(wei)} ${nativeSymbol(chainId)}`;
}

export interface RenderedRead {
  text: string;
  /** True when the value could not be read; the UI shows the reason instead of a number. */
  unavailable: boolean;
}

export function renderBalance(
  result: ReadResult<bigint> | undefined,
  chainId: number,
  missingText = 'Unavailable',
): RenderedRead {
  if (!result) return { text: missingText, unavailable: true };
  if (!result.ok) return { text: `Unavailable: ${result.error}`, unavailable: true };
  return { text: formatNative(result.value, chainId), unavailable: false };
}
