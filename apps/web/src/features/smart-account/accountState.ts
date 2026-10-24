import type { Hex } from 'viem';

/**
 * Pure derivation of the smart-account state shown in the UI. It uses only facts read from the
 * chain (contract code at an address) plus whether an address is configured. It never infers
 * "initialized" from deployment, because that needs the pinned account implementation's ABI.
 */

export type AccountDeployment = 'not-configured' | 'unknown' | 'counterfactual' | 'deployed';

/** True when the code string contains bytecode. Returns undefined if the read failed. */
export function hasContractCode(code: Hex | string | undefined): boolean | undefined {
  if (code === undefined) return undefined;
  return code.length > 2;
}

export function deriveDeployment(
  isConfigured: boolean,
  code: Hex | string | undefined,
): AccountDeployment {
  if (!isConfigured) return 'not-configured';
  const present = hasContractCode(code);
  if (present === undefined) return 'unknown';
  return present ? 'deployed' : 'counterfactual';
}

export const DEPLOYMENT_LABELS: Record<AccountDeployment, string> = {
  'not-configured': 'Not configured',
  unknown: 'Unknown',
  counterfactual: 'Counterfactual (not deployed)',
  deployed: 'Deployed (code present)',
};

export const DEPLOYMENT_DETAILS: Record<AccountDeployment, string> = {
  'not-configured': 'No smart-account address is configured for this network.',
  unknown: 'The code at this address could not be read, so deployment state is not known.',
  counterfactual:
    'No contract code exists at this address yet. It can receive funds, but the account contract has not been deployed.',
  deployed:
    'Contract code exists at this address. The code has not been checked against a specific account implementation.',
};

export type InitializationKind = 'not-applicable' | 'not-determined';

export interface InitializationState {
  kind: InitializationKind;
  label: string;
  reason: string;
}

/**
 * Initialization state is deliberately never reported as "initialized". Reading it requires the
 * ABI of the pinned account implementation, which is integrated in a later module.
 */
export function deriveInitialization(deployment: AccountDeployment): InitializationState {
  if (deployment === 'counterfactual') {
    return {
      kind: 'not-applicable',
      label: 'Not applicable',
      reason: 'The account is not deployed, so it cannot be initialized yet.',
    };
  }
  return {
    kind: 'not-determined',
    label: 'Not determined',
    reason:
      'Reading initialization state requires the pinned account implementation, which is not integrated yet.',
  };
}
