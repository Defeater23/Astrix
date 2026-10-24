import type { Address } from 'viem';

/**
 * Agent registry types (Module 4).
 *
 * IMPORTANT: in Module 4 an agent record is a local, browser-only record. It is NOT written to
 * the smart account and nothing here is enforced on-chain. A "paused" or "revoked" agent here
 * means only that this application marks it so; the signer's on-chain authority is unchanged
 * until account-layer enforcement exists (see MODULE_HANDOVER.md).
 */

/** Status that is stored. "Expired" is never stored; it is derived from the expiry time. */
export type StoredAgentStatus = 'active' | 'paused' | 'revoked';

/** Status shown to the user, derived from the stored status and the current time. */
export type AgentStatus = 'active' | 'paused' | 'expired' | 'revoked';

export type AgentAction = 'pause' | 'resume' | 'revoke';

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  /** Public address of the agent's signing key. Never a private key. */
  signer: Address;
  /** Unix seconds (UTC), or null when the agent has no expiry. */
  expiresAt: number | null;
  status: StoredAgentStatus;
  /** Unix seconds (UTC). */
  createdAt: number;
  updatedAt: number;
}
