import type { Address, Hex } from 'viem';
import { ENTRYPOINT_V07_ABI } from './entryPoint';
import type { ChainReader } from './overview';

/**
 * Minimal structural view of a viem public client. Declared here so the adapter depends only on
 * the three standard read calls it uses. All three are plain read-only RPC operations.
 */
export interface ReaderClient {
  getBalance(args: { address: Address }): Promise<bigint>;
  request(args: { method: 'eth_getCode'; params: [Address, 'latest'] }): Promise<Hex>;
  readContract(args: {
    address: Address;
    abi: typeof ENTRYPOINT_V07_ABI;
    functionName: 'balanceOf';
    args: [Address];
  }): Promise<bigint>;
}

export function createChainReader(client: ReaderClient): ChainReader {
  return {
    getBalance: (address) => client.getBalance({ address }),
    getCode: (address) => client.request({ method: 'eth_getCode', params: [address, 'latest'] }),
    getEntryPointDeposit: (entryPoint, account) =>
      client.readContract({
        address: entryPoint,
        abi: ENTRYPOINT_V07_ABI,
        functionName: 'balanceOf',
        args: [account],
      }),
  };
}
