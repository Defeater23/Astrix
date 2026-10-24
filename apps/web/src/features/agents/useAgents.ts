import { useCallback, useEffect, useState } from 'react';
import type { WalletState } from '../wallet/state';
import { createAgent, transitionAgent } from './lifecycle';
import { agentStorageKey, browserStorage, loadAgents, saveAgents } from './storage';
import type { AgentAction, AgentRecord } from './types';
import type { RegistrationErrors, RegistrationInput } from './validation';
import { validateRegistration } from './validation';

export type RegisterOutcome =
  { ok: true; agent: AgentRecord } | { ok: false; errors: RegistrationErrors };

export interface UseAgents {
  /** Undefined until a supported-network wallet is connected and records are loaded. */
  agents: AgentRecord[] | undefined;
  dropped: number;
  corrupt: boolean;
  nowSeconds: number;
  register: (input: RegistrationInput) => RegisterOutcome;
  /** Returns an error message, or undefined on success. */
  transition: (action: AgentAction, id: string) => string | undefined;
}

interface Loaded {
  key: string;
  agents: AgentRecord[];
  dropped: number;
  corrupt: boolean;
}

const TICK_MS = 30_000;
const SAVE_FAILED =
  'Could not save to this browser (storage unavailable or full). Nothing changed.';

function newAgentId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function currentSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Local agent registry for the connected owner and chain. Every mutation is validated by the
 * pure rules in validation.ts and lifecycle.ts, persisted first, and only then shown; a failed
 * save leaves the displayed state unchanged. Nothing here talks to the chain.
 */
export function useAgents(wallet: WalletState): UseAgents {
  const scope = wallet.kind === 'connected-supported' ? wallet : undefined;
  const owner = scope?.address;
  const key = scope ? agentStorageKey(scope.chainId, scope.address) : undefined;

  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [nowSeconds, setNowSeconds] = useState(currentSeconds);

  useEffect(() => {
    const timer = window.setInterval(() => setNowSeconds(currentSeconds()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!key) {
      setLoaded(undefined);
      return;
    }
    setLoaded({ key, ...loadAgents(browserStorage(), key) });
  }, [key]);

  const current = key !== undefined && loaded?.key === key ? loaded : undefined;

  const commit = useCallback(
    (next: AgentRecord[]): boolean => {
      if (!key) return false;
      if (!saveAgents(browserStorage(), key, next)) return false;
      setLoaded({ key, agents: next, dropped: 0, corrupt: false });
      return true;
    },
    [key],
  );

  const register = useCallback(
    (input: RegistrationInput): RegisterOutcome => {
      if (!owner || !current) {
        return {
          ok: false,
          errors: { form: 'Connect a wallet on a supported network first.' },
        };
      }
      const now = currentSeconds();
      const result = validateRegistration(input, {
        owner,
        existing: current.agents,
        nowSeconds: now,
      });
      if (!result.ok) return result;
      const agent = createAgent(result.value, { id: newAgentId(), nowSeconds: now });
      if (!commit([...current.agents, agent])) return { ok: false, errors: { form: SAVE_FAILED } };
      return { ok: true, agent };
    },
    [owner, current, commit],
  );

  const transition = useCallback(
    (action: AgentAction, id: string): string | undefined => {
      if (!current) return 'Connect a wallet on a supported network first.';
      const target = current.agents.find((agent) => agent.id === id);
      if (!target) return 'That agent no longer exists.';
      const result = transitionAgent(target, action, currentSeconds());
      if (!result.ok) return result.reason;
      const next = current.agents.map((agent) => (agent.id === id ? result.agent : agent));
      return commit(next) ? undefined : SAVE_FAILED;
    },
    [current, commit],
  );

  return {
    agents: current?.agents,
    dropped: current?.dropped ?? 0,
    corrupt: current?.corrupt ?? false,
    nowSeconds,
    register,
    transition,
  };
}
