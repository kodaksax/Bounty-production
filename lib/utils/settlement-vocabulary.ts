/**
 * Client mirror of supabase/functions/_shared/settlement-state.ts.
 *
 * WHY THIS IS DUPLICATED RATHER THAN IMPORTED
 * The canonical module lives under supabase/functions/_shared so the Edge
 * Functions (Deno) can import it. Nothing in the React Native bundle imports
 * from that directory today, and pulling it into Metro's module graph to save
 * one file is not worth the bundler risk on a payment path.
 *
 * The duplication is held honest by __tests__/unit/settlement-state.test.ts,
 * which imports BOTH modules and asserts they produce identical output across
 * the full type x state matrix. If you edit one, edit the other; the test will
 * tell you if you forgot.
 *
 * See ADR 0001 §2.7.
 */

export type SettlementState =
  | 'ledger_only'
  | 'stripe_pending'
  | 'stripe_settled'
  | 'stripe_failed';

export type SettlementTone = 'neutral' | 'pending' | 'success';

export interface SettlementDescription {
  label: string;
  detail: string;
  tone: SettlementTone;
}

/**
 * The single source of user-facing settlement language on the client.
 *
 * The word "Paid" appears in exactly two branches, both guarded by
 * `state === 'stripe_settled'`. That is the invariant, and it is what makes it
 * checkable rather than a matter of reviewer diligence.
 */
export function describeSettlement(
  type: string,
  state: SettlementState
): SettlementDescription {
  switch (type) {
    case 'release':
      return state === 'stripe_settled'
        ? {
            label: 'Paid',
            detail: 'Sent to the hunter’s bank account via Stripe.',
            tone: 'success',
          }
        : {
            label: 'Added to balance',
            detail:
              'Available in the hunter’s Bounty balance. They’ll need to set up payouts to move it to a bank account.',
            tone: 'neutral',
          };

    case 'withdrawal':
      switch (state) {
        case 'stripe_settled':
          return { label: 'Paid', detail: 'Arrived in your bank account.', tone: 'success' };
        case 'stripe_pending':
          return {
            label: 'On its way',
            detail: 'Sent to your bank. This typically takes 1-2 business days.',
            tone: 'pending',
          };
        case 'stripe_failed':
          return {
            label: 'Failed',
            detail:
              'This payout did not reach your bank. The funds were returned to your Bounty balance.',
            tone: 'neutral',
          };
        default:
          return {
            label: 'Unconfirmed',
            detail:
              'We could not confirm this payout reached your bank. Please contact support.',
            tone: 'neutral',
          };
      }

    case 'deposit':
      return state === 'stripe_settled'
        ? { label: 'Added', detail: 'Funds added to your Bounty balance.', tone: 'success' }
        : { label: 'Pending', detail: 'This deposit has not been confirmed yet.', tone: 'pending' };

    case 'escrow':
      return {
        label: 'Held',
        detail: 'Reserved from your balance until the bounty is completed.',
        tone: 'neutral',
      };

    case 'refund':
      return state === 'stripe_settled'
        ? { label: 'Refunded', detail: 'Returned to your original payment method.', tone: 'success' }
        : {
            label: 'Returned to balance',
            detail: 'Returned to your Bounty balance.',
            tone: 'neutral',
          };

    default:
      return {
        label: 'Recorded',
        detail: 'This adjustment was applied to your balance.',
        tone: 'neutral',
      };
  }
}

/** Guard for any UI about to claim settlement. */
export function mayDescribeAsPaid(state: SettlementState | null | undefined): boolean {
  return state === 'stripe_settled';
}
