import { transitionBountyPaymentForTransfer } from '../../supabase/functions/_shared/bounty-payment-settlement-state';

describe('Phase 2 bounty payment transfer reconciliation', () => {
  it('moves a transfer-requested payment to released only on Stripe transfer.created', () => {
    expect(transitionBountyPaymentForTransfer('captured', 'created')).toBe('released');
    expect(transitionBountyPaymentForTransfer('release_pending', 'created')).toBe('released');
  });

  it('does not let a legacy transfer.paid event promote Phase 2 settlement', () => {
    expect(transitionBountyPaymentForTransfer('captured', 'paid')).toBeNull();
  });

  it('marks an in-flight transfer as failed without allowing old failures to overwrite success', () => {
    expect(transitionBountyPaymentForTransfer('release_pending', 'failed')).toBe('failed');
    expect(transitionBountyPaymentForTransfer('released', 'failed')).toBeNull();
  });

  it('records an authoritative reversal after an earlier successful transfer', () => {
    expect(transitionBountyPaymentForTransfer('released', 'reversed')).toBe('failed');
  });

  it('keeps a failed transfer terminal until the release endpoint deliberately starts a retry', () => {
    expect(transitionBountyPaymentForTransfer('failed', 'created')).toBeNull();
    expect(transitionBountyPaymentForTransfer('failed', 'paid')).toBeNull();
  });

  it('is replay-safe and terminal-state protected', () => {
    expect(transitionBountyPaymentForTransfer('released', 'paid')).toBeNull();
    expect(transitionBountyPaymentForTransfer('released', 'created')).toBeNull();
    expect(transitionBountyPaymentForTransfer('failed', 'paid')).toBeNull();
  });
});
