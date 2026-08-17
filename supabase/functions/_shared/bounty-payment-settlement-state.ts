export type BountyPaymentSettlementStatus =
  | 'pending_payment'
  | 'authorized'
  | 'captured'
  | 'release_pending'
  | 'released'
  | 'refund_pending'
  | 'refunded'
  | 'canceled'
  | 'disputed'
  | 'failed';

export type StripeTransferEvent = 'created' | 'paid' | 'failed' | 'reversed';

export function transitionBountyPaymentForTransfer(
  current: BountyPaymentSettlementStatus,
  event: StripeTransferEvent
): BountyPaymentSettlementStatus | null {
  switch (event) {
    case 'created':
      return current === 'captured' || current === 'authorized' || current === 'release_pending'
        ? 'released'
        : null;
    case 'paid':
      // Stripe's public Connect Transfer lifecycle has transfer.created and
      // transfer.reversed, not transfer.paid. Kept as a no-op so any legacy
      // synthetic event cannot overwrite a terminal Phase 2 state.
      return null;
    case 'failed':
      return current === 'captured' || current === 'authorized' || current === 'release_pending'
        ? 'failed'
        : null;
    case 'reversed':
      return current === 'release_pending' || current === 'released' ? 'failed' : null;
  }
}
