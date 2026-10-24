import type { Address, Hex } from 'viem';

/**
 * Chain reads for the wallet overview. Every value is either read from the selected chain or
 * reported as an error; nothing is estimated, cached across chains or invented.
 */

export type ReadResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ChainReader {
  getBalance(address: Address): Promise<bigint>;
  /** Returns "0x" when there is no code at the address. */
  getCode(address: Address): Promise<Hex>;
  /** EntryPoint deposit held for an account. */
  getEntryPointDeposit(entryPoint: Address, account: Address): Promise<bigint>;
}

export interface SmartAccountOverview {
  chainId: number;
  owner: Address;
  /** Configured smart-account address for this chain, if any. */
  account: Address | undefined;
  entryPoint: Address;
  ownerBalance: ReadResult<bigint>;
  entryPointCode: ReadResult<Hex>;
  /** The following are undefined when no smart account is configured for the chain. */
  accountCode: ReadResult<Hex> | undefined;
  accountBalance: ReadResult<bigint> | undefined;
  entryPointDeposit: ReadResult<bigint> | undefined;
}

const MAX_ERROR_LENGTH = 200;

export function describeReadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split('\n')[0]?.trim() ?? '';
  const text = firstLine.length > 0 ? firstLine : 'Unknown error';
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text;
}

export async function settle<T>(promise: Promise<T>): Promise<ReadResult<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error: describeReadError(error) };
  }
}

export interface FetchOverviewInput {
  chainId: number;
  owner: Address;
  account: Address | undefined;
  entryPoint: Address;
}

export async function fetchOverview(
  reader: ChainReader,
  input: FetchOverviewInput,
): Promise<SmartAccountOverview> {
  const { chainId, owner, account, entryPoint } = input;

  const [ownerBalance, entryPointCode, accountCode, accountBalance] = await Promise.all([
    settle(reader.getBalance(owner)),
    settle(reader.getCode(entryPoint)),
    account ? settle(reader.getCode(account)) : Promise.resolve(undefined),
    account ? settle(reader.getBalance(account)) : Promise.resolve(undefined),
  ]);

  let entryPointDeposit: ReadResult<bigint> | undefined;
  if (account) {
    if (!entryPointCode.ok) {
      entryPointDeposit = { ok: false, error: 'EntryPoint code could not be read.' };
    } else if (entryPointCode.value.length <= 2) {
      entryPointDeposit = { ok: false, error: 'No EntryPoint contract found on this chain.' };
    } else {
      entryPointDeposit = await settle(reader.getEntryPointDeposit(entryPoint, account));
    }
  }

  return {
    chainId,
    owner,
    account,
    entryPoint,
    ownerBalance,
    entryPointCode,
    accountCode,
    accountBalance,
    entryPointDeposit,
  };
}
