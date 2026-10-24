import { describe, expect, it } from 'vitest';
import { deriveStatus, isFinal } from './status';

const HASH = '0xabc';
const accepted = { attempted: true, bundlerAccepted: true, userOpHash: HASH };

describe('deriveStatus', () => {
  it('is not_submitted with no evidence', () => {
    expect(deriveStatus({})).toBe('not_submitted');
  });

  it('is pending once the bundler accepted a hash, never confirmed', () => {
    expect(deriveStatus({ submission: accepted })).toBe('pending');
  });

  it('is confirmed only with a successful receipt AND a successful UserOperationEvent', () => {
    const inclusion = { transactionHash: '0x1', blockNumber: 1, txStatus: 'success' as const };
    expect(deriveStatus({ submission: accepted, inclusion: { ...inclusion, userOpSuccess: true } })).toBe('confirmed');
    expect(deriveStatus({ submission: accepted, inclusion })).toBe('pending');
  });

  it('is reverted when the bundle reverted or the operation itself failed', () => {
    expect(
      deriveStatus({ inclusion: { transactionHash: '0x1', blockNumber: 1, txStatus: 'reverted' } }),
    ).toBe('reverted');
    expect(
      deriveStatus({
        inclusion: { transactionHash: '0x1', blockNumber: 1, txStatus: 'success', userOpSuccess: false },
      }),
    ).toBe('reverted');
  });

  it('is policy_rejected on simulation or mined policy-revert evidence', () => {
    expect(deriveStatus({ policyRejection: { source: 'simulation', reason: 'DailyLimitExceeded' } })).toBe(
      'policy_rejected',
    );
    expect(
      deriveStatus({
        policyRejection: { source: 'onchain', reason: 'DailyLimitExceeded' },
        inclusion: { transactionHash: '0x1', blockNumber: 1, txStatus: 'success', userOpSuccess: false },
      }),
    ).toBe('policy_rejected');
  });

  it('distinguishes user rejection, client validation failure, bundler failure and unexpected errors', () => {
    expect(deriveStatus({ userRejectedSignature: true })).toBe('user_rejected');
    expect(
      deriveStatus({ clientRejections: [{ code: 'EXPIRED', message: 'Operation has expired.' }] }),
    ).toBe('validation_failed');
    expect(deriveStatus({ submission: { attempted: true, error: 'bundler down' } })).toBe('submission_failed');
    expect(deriveStatus({ submission: { attempted: true, bundlerAccepted: false } })).toBe('submission_failed');
    expect(deriveStatus({ unexpectedError: 'boom' })).toBe('error');
  });

  it('does not treat a client-side rejection as policy rejection', () => {
    expect(
      deriveStatus({ clientRejections: [{ code: 'POLICY_PREVIEW_DENIED', message: 'x' }] }),
    ).toBe('validation_failed');
  });

  it('only confirmed and reverted are final', () => {
    expect(isFinal('confirmed')).toBe(true);
    expect(isFinal('reverted')).toBe(true);
    expect(isFinal('pending')).toBe(false);
    expect(isFinal('submission_failed')).toBe(false);
  });
});
