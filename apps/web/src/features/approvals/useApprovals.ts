import { useCallback, useEffect, useState } from 'react';
import type { WalletState } from '../wallet/state';
import {
  browserStorage,
  decisionStorageKey,
  deriveStatus,
  loadDecisions,
  saveDecisions,
  withDecision,
} from './decisions';
import { isDisplayableRequest } from './guard';
import type {
  ApprovalRequest,
  ApprovalRequestSource,
  ApprovalScope,
  DecisionRecord,
  LocalDecision,
} from './types';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseApprovals {
  loadStatus: LoadStatus;
  error: string | undefined;
  requests: ApprovalRequest[];
  /** Requests the source returned that could not be displayed safely. */
  dropped: number;
  decisions: DecisionRecord[];
  /** Stored decisions that were unreadable and ignored. */
  droppedDecisions: number;
  corruptDecisions: boolean;
  nowSeconds: number;
  reload: () => void;
  /** Returns an error message, or undefined on success. */
  decide: (requestId: string, decision: LocalDecision) => string | undefined;
  /** Returns an error message, or undefined on success. */
  resetDecisions: () => string | undefined;
}

const TICK_MS = 30_000;
const SAVE_FAILED =
  'Could not save to this browser (storage unavailable or full). Nothing changed.';

function currentSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

interface Loaded {
  key: string;
  requests: ApprovalRequest[];
  dropped: number;
}

/**
 * Loads requests from a source and keeps the owner's local UI decisions. A decision here is
 * recorded in this browser only; it is not a signature and authorizes nothing.
 */
export function useApprovals(wallet: WalletState, source: ApprovalRequestSource): UseApprovals {
  const scope: ApprovalScope | undefined =
    wallet.kind === 'connected-supported'
      ? { owner: wallet.address, chainId: wallet.chainId }
      : undefined;
  const key = scope ? decisionStorageKey(scope.chainId, scope.owner) : undefined;

  const [nowSeconds, setNowSeconds] = useState(currentSeconds);
  const [reloadCount, setReloadCount] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [failure, setFailure] = useState<{ key: string; message: string } | undefined>(undefined);
  const [store, setStore] = useState<
    { key: string; decisions: DecisionRecord[]; dropped: number; corrupt: boolean } | undefined
  >(undefined);

  useEffect(() => {
    const timer = window.setInterval(() => setNowSeconds(currentSeconds()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!key) {
      setStore(undefined);
      return;
    }
    setStore({ key, ...loadDecisions(browserStorage(), key) });
  }, [key]);

  const owner = scope?.owner;
  const chainId = scope?.chainId;
  useEffect(() => {
    if (!key || owner === undefined || chainId === undefined) {
      setLoaded(undefined);
      setFailure(undefined);
      return;
    }
    let cancelled = false;
    setLoaded(undefined);
    setFailure(undefined);
    source
      .list({ owner, chainId }, currentSeconds())
      .then((items) => {
        if (cancelled) return;
        const requests = items.filter(isDisplayableRequest);
        setLoaded({ key, requests, dropped: items.length - requests.length });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setFailure({
          key,
          message: cause instanceof Error ? cause.message : 'The request source failed.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [key, owner, chainId, source, reloadCount]);

  const currentLoaded = key !== undefined && loaded?.key === key ? loaded : undefined;
  const currentFailure = key !== undefined && failure?.key === key ? failure : undefined;
  const currentStore = key !== undefined && store?.key === key ? store : undefined;

  const commit = useCallback(
    (next: DecisionRecord[]): boolean => {
      if (!key) return false;
      if (!saveDecisions(browserStorage(), key, next)) return false;
      setStore({ key, decisions: next, dropped: 0, corrupt: false });
      return true;
    },
    [key],
  );

  const decide = useCallback(
    (requestId: string, decision: LocalDecision): string | undefined => {
      if (!currentLoaded || !currentStore) return 'Connect a wallet on a supported network first.';
      const request = currentLoaded.requests.find((r) => r.id === requestId);
      if (!request) return 'That request no longer exists.';
      const now = currentSeconds();
      if (request.operation.chainId !== chainId) {
        return `This request is for chain ID ${request.operation.chainId}, not the connected network.`;
      }
      const derived = deriveStatus(request, currentStore.decisions, now);
      if (derived.status === 'expired') return 'This request has expired.';
      if (derived.status !== 'pending') return 'A decision is already recorded for this request.';
      const next = withDecision(currentStore.decisions, request, decision, now);
      return commit(next) ? undefined : SAVE_FAILED;
    },
    [currentLoaded, currentStore, chainId, commit],
  );

  const resetDecisions = useCallback((): string | undefined => {
    return commit([]) ? undefined : SAVE_FAILED;
  }, [commit]);

  const loadStatus: LoadStatus = !key
    ? 'idle'
    : currentFailure
      ? 'error'
      : currentLoaded && currentStore
        ? 'ready'
        : 'loading';

  return {
    loadStatus,
    error: currentFailure?.message,
    requests: currentLoaded?.requests ?? [],
    dropped: currentLoaded?.dropped ?? 0,
    decisions: currentStore?.decisions ?? [],
    droppedDecisions: currentStore?.dropped ?? 0,
    corruptDecisions: currentStore?.corrupt ?? false,
    nowSeconds,
    reload: () => setReloadCount((count) => count + 1),
    decide,
    resetDecisions,
  };
}
