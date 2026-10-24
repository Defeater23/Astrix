import type { Address } from 'viem';

/**
 * ERC-4337 EntryPoint v0.7, the version this project targets (see docs/SMART_ACCOUNT.md).
 *
 * The address is the canonical deterministic address published in the viem / permissionless
 * documentation for EntryPoint v0.7. The viem docs state that the account implementation, factory,
 * bundler and paymaster must all support the same EntryPoint, so this constant is the single
 * place the version is pinned in the frontend.
 */
export const ENTRYPOINT_VERSION = '0.7';

export const ENTRYPOINT_V07_ADDRESS: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

/**
 * The only EntryPoint function this module reads: the deposit an account holds in the
 * EntryPoint (IStakeManager.balanceOf). Further functions are added in the module that uses them.
 */
export const ENTRYPOINT_V07_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
