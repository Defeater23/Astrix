import { useCallback, useEffect, useState } from 'react';
import { browserStorage } from '../agents/storage';
import type { WalletState } from '../wallet/state';
import { loadPolicies, policyStorageKey, savePolicies } from './storage';
import type { PolicyRecord } from './types';
import type { PolicyErrors, PolicyInput } from './validation';
import { validatePolicy } from './validation';

export type SavePolicyOutcome = { ok: true } | { ok: false; errors: PolicyErrors };

export interface UsePolicies {
  /** Undefined until a supported-network wallet is connected and drafts are loaded. */
  policies: PolicyRecord[] | undefined;
  dropped: number;
  corrupt: boolean;
  saveDraft: (agentId: string, input: PolicyInput) => SavePolicyOutcome;
}

interface Loaded {
  key: string;
  policies: PolicyRecord[];
  dropped: number;
  corrupt: boolean;
}

/** Local policy drafts for the connected owner and chain. Nothing here talks to the chain. */
export function usePolicies(wallet: WalletState): UsePolicies {
  const scope = wallet.kind === 'connected-supported' ? wallet : undefined;
  const key = scope ? policyStorageKey(scope.chainId, scope.address) : undefined;
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);

  useEffect(() => {
    if (!key) {
      setLoaded(undefined);
      return;
    }
    setLoaded({ key, ...loadPolicies(browserStorage(), key) });
  }, [key]);

  const current = key !== undefined && loaded?.key === key ? loaded : undefined;

  const saveDraft = useCallback(
    (agentId: string, input: PolicyInput): SavePolicyOutcome => {
      if (!key || !current) {
        return { ok: false, errors: { form: 'Connect a wallet on a supported network first.' } };
      }
      const result = validatePolicy(input);
      if (!result.ok) return result;
      const record: PolicyRecord = {
        agentId,
        ...result.value,
        state: 'draft',
        updatedAt: Math.floor(Date.now() / 1000),
      };
      const next = [...current.policies.filter((policy) => policy.agentId !== agentId), record];
      if (!savePolicies(browserStorage(), key, next)) {
        return {
          ok: false,
          errors: {
            form: 'Could not save to this browser (storage unavailable or full). Nothing changed.',
          },
        };
      }
      setLoaded({ key, policies: next, dropped: 0, corrupt: false });
      return { ok: true };
    },
    [key, current],
  );

  return {
    policies: current?.policies,
    dropped: current?.dropped ?? 0,
    corrupt: current?.corrupt ?? false,
    saveDraft,
  };
}
