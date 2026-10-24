import { describe, expect, it } from 'vitest';
import {
  DEPLOYMENT_LABELS,
  deriveDeployment,
  deriveInitialization,
  hasContractCode,
} from './accountState';

describe('hasContractCode', () => {
  it('is false for empty code', () => {
    expect(hasContractCode('0x')).toBe(false);
  });

  it('is true when bytecode is present', () => {
    expect(hasContractCode('0x6080604052')).toBe(true);
  });

  it('is undefined when the read failed', () => {
    expect(hasContractCode(undefined)).toBeUndefined();
  });
});

describe('deriveDeployment', () => {
  it('reports not-configured regardless of code when no address is configured', () => {
    expect(deriveDeployment(false, '0x6080')).toBe('not-configured');
    expect(deriveDeployment(false, undefined)).toBe('not-configured');
  });

  it('reports unknown when the code read failed', () => {
    expect(deriveDeployment(true, undefined)).toBe('unknown');
  });

  it('reports counterfactual when there is no code', () => {
    expect(deriveDeployment(true, '0x')).toBe('counterfactual');
  });

  it('reports deployed when code exists', () => {
    expect(deriveDeployment(true, '0x6080604052')).toBe('deployed');
  });

  it('has a label for every state', () => {
    for (const state of ['not-configured', 'unknown', 'counterfactual', 'deployed'] as const) {
      expect(DEPLOYMENT_LABELS[state].length).toBeGreaterThan(0);
    }
  });
});

describe('deriveInitialization', () => {
  it('is never reported as initialized', () => {
    for (const state of ['not-configured', 'unknown', 'counterfactual', 'deployed'] as const) {
      expect(deriveInitialization(state).label.toLowerCase()).not.toBe('initialized');
    }
  });

  it('is not applicable for an undeployed account', () => {
    expect(deriveInitialization('counterfactual').kind).toBe('not-applicable');
  });

  it('is not determined for a deployed account until the implementation is integrated', () => {
    const result = deriveInitialization('deployed');
    expect(result.kind).toBe('not-determined');
    expect(result.reason).toMatch(/pinned account implementation/);
  });
});
