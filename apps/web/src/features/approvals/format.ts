/** Exact, integer-only formatting. No floating-point arithmetic is used for token amounts. */

/** Exact decimal string for a base-unit amount, e.g. (1500000n, 6) -> "1.5". */
export function formatUnitsExact(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
    throw new RangeError('decimals must be an integer from 0 to 77');
  }
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** "2026-10-24 18:00:00 UTC". */
export function formatUtc(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function span(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days`;
}

export interface ExpiryInfo {
  expired: boolean;
  /** UTC timestamp plus a relative phrase, e.g. "... (in 59 min)". */
  text: string;
}

export function describeExpiry(expiresAt: number, nowSeconds: number): ExpiryInfo {
  const expired = expiresAt <= nowSeconds;
  const relative = expired
    ? `expired ${span(nowSeconds - expiresAt)} ago`
    : `in ${span(expiresAt - nowSeconds)}`;
  return { expired, text: `${formatUtc(expiresAt)} (${relative})` };
}
