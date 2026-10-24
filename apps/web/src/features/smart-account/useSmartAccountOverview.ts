import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { usePublicClient } from 'wagmi';
import type { WalletState } from '../wallet/state';
import { createChainReader } from './chainReader';
import type { ReaderClient } from './chainReader';
import { ENTRYPOINT_V07_ADDRESS } from './entryPoint';
import type { SmartAccountOverview } from './overview';
import { fetchOverview } from './overview';
import type { SmartAccountConfig } from './smartAccountConfig';
import { smartAccountConfig } from './smartAccountConfig';

export type OverviewStatus = 'disabled' | 'loading' | 'error' | 'success';

export interface OverviewQuery {
  status: OverviewStatus;
  data: SmartAccountOverview | undefined;
  errorMessage: string | undefined;
  isFetching: boolean;
  /** Epoch milliseconds of the last successful read. */
  updatedAt: number | undefined;
  refetch: () => void;
}

/**
 * Reads owner balance, smart-account state and EntryPoint presence from the chain the wallet is
 * connected to. Reads only happen on a supported chain with a connected wallet; otherwise the
 * status is "disabled" and nothing is shown as data. There is no automatic polling: values are
 * read on load, when the account or chain changes, and when the user presses Refresh.
 */
export function useSmartAccountOverview(
  state: WalletState,
  config: SmartAccountConfig = smartAccountConfig,
): OverviewQuery {
  const chainId = state.kind === 'connected-supported' ? state.chainId : undefined;
  const owner = state.kind === 'connected-supported' ? (state.address as Address) : undefined;
  const client = usePublicClient({ chainId });
  const account = chainId !== undefined ? config.addresses[chainId] : undefined;
  const enabled = chainId !== undefined && owner !== undefined && client !== undefined;

  const query = useQuery({
    queryKey: ['smart-account-overview', chainId, owner, account],
    enabled,
    queryFn: async () => {
      if (chainId === undefined || owner === undefined || client === undefined) {
        throw new Error('Wallet is not connected to a supported network.');
      }
      // Typing boundary: the wagmi client satisfies this structural view of three read calls.
      const reader = createChainReader(client as unknown as ReaderClient);
      return fetchOverview(reader, {
        chainId,
        owner,
        account,
        entryPoint: ENTRYPOINT_V07_ADDRESS,
      });
    },
  });

  const status: OverviewStatus = !enabled
    ? 'disabled'
    : query.isError
      ? 'error'
      : query.data
        ? 'success'
        : 'loading';

  return {
    status,
    data: enabled ? query.data : undefined,
    errorMessage: query.error instanceof Error ? query.error.message : undefined,
    isFetching: query.isFetching,
    updatedAt: query.dataUpdatedAt > 0 ? query.dataUpdatedAt : undefined,
    refetch: () => {
      void query.refetch();
    },
  };
}
