import type { Address, Hex } from 'viem';

/**
 * Spending policy types (Module 5).
 *
 * IMPORTANT: a policy here is a DRAFT stored in this browser. It is not submitted to or enforced
 * by the smart account. "Submitted" and "confirmed" exist as names in the plan but cannot be
 * reached in this module, and stored records claiming them are rejected on load.
 */

export type PolicyState = 'draft';

export interface PolicyRecord {
  /** Agent this policy belongs to (AgentRecord.id). */
  agentId: string;
  /** Maximum native value per transaction, in wei (decimal string). */
  perTxLimitWei: string;
  /** Maximum cumulative native value per UTC calendar day, in wei (decimal string). */
  dailyLimitWei: string;
  recipients: Address[];
  tokens: Address[];
  contracts: Address[];
  /** 4-byte function selectors, lower-case hex such as 0xa9059cbb. */
  selectors: Hex[];
  state: PolicyState;
  updatedAt: number;
}

export type ProposalKind = 'native' | 'token' | 'call';

/** A transaction an agent might propose, reduced to what the draft rules examine. */
export interface Proposal {
  kind: ProposalKind;
  /** Recipient for native and token transfers; target contract for calls. */
  to: Address;
  /** Native value in wei sent with the transaction (zero for token transfers). */
  valueWei: bigint;
  /** Token contract, for token transfers. */
  token?: Address;
  /** Function selector, for contract calls. */
  selector?: Hex;
}
