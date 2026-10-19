/**
 * Cancel an open, unhired bounty and give back anything held for it.
 *
 * This is the one path behind both the Inbox row's trash icon and the bounty
 * screen's "Cancel and refund" (SBA-10). It writes no refund logic of its own:
 * it calls the same endpoints the trash icon always has, which own the
 * owner-refund / acceptance race fix (#883, 20261013140000) — /wallet/refund
 * and /bounty-payments/cancel claim the bounty under the row lock the accept
 * RPCs take (fn_claim_owner_refund), so a refund and a hire can never both
 * win. Only after the refund settles is the bounty deleted.
 */
import type { Bounty } from './database.types';
import { analyticsService } from './analytics-service';
import { getBountyFundingRequirement } from './bounty-funding-service';
import { bountyPaymentsService } from './bounty-payments-service';
import { bountyService } from './bounty-service';
import { isPhase2Bounty, isV3Bounty } from '../utils/payment-architecture';
import { failureEventProps } from '../utils/stripe-error';

/** Where the refund goes. Matches settlement-vocabulary's refunded copy. */
export type RefundDestination = 'wallet' | 'original_payment_method';

export interface CancelRefundPlan {
  /** Dollars going back to the poster. 0 when nothing is held. */
  refundAmount: number;
  /** Null when nothing is refunded. */
  destination: RefundDestination | null;
}

type CancellableBounty = Pick<Bounty, 'id' | 'title' | 'amount' | 'is_for_honor' | 'status'> &
  Partial<Pick<Bounty, 'accepted_by'>> &
  Record<string, unknown>;

export interface CancelRefundDeps {
  /** WalletContext.refundEscrow — resolves false (never throws) on failure. */
  refundEscrow: (bountyId: string | number, title: string, refundPercentage: number) => Promise<boolean>;
}

/** The refund could not be completed, so the bounty was NOT deleted. */
export class BountyRefundFailedError extends Error {
  constructor(public readonly cause: unknown) {
    super('Could not refund escrowed funds. Please contact support before deleting.');
    this.name = 'BountyRefundFailedError';
  }
}

/** True while a poster may cancel the bounty themselves: open, nobody hired. */
export function canPosterCancelBounty(bounty: Pick<Bounty, 'status'> & { accepted_by?: unknown }): boolean {
  return bounty.status === 'open' && !bounty.accepted_by;
}

/**
 * What cancelling would give back. Asked of the SERVER rather than inferred
 * from funding_mode: an escrow can exist on an open at_accept bounty (e.g. one
 * created by an older build), and refusing to refund that would strand real
 * money. getBountyFundingRequirement reports already_funded from the canonical
 * wallet_transactions row, and its documented fallback when the RPC is
 * unavailable is already_funded=true — i.e. attempt the refund.
 */
export async function planCancelRefund(bounty: CancellableBounty): Promise<CancelRefundPlan> {
  const paid = !bounty.is_for_honor && Number(bounty.amount) > 0 && bounty.status === 'open';
  if (!paid) return { refundAmount: 0, destination: null };
  const { alreadyFunded } = await getBountyFundingRequirement(bounty.id);
  if (!alreadyFunded) return { refundAmount: 0, destination: null };
  return {
    refundAmount: Number(bounty.amount),
    destination: isPhase2Bounty(bounty as any) || isV3Bounty(bounty as any) ? 'original_payment_method' : 'wallet',
  };
}

function dollars(amount: number): string {
  return `$${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
}

/** The in-app confirmation: what happens, how much comes back, and where. */
export function describeCancelRefund(
  bounty: Pick<Bounty, 'is_for_honor'>,
  plan: CancelRefundPlan
): { title: string; message: string; confirmLabel: string } {
  const lead = "It comes off the feed right away, and this can't be undone.";
  if (plan.destination && plan.refundAmount > 0) {
    const where = plan.destination === 'wallet' ? 'your Bounty balance' : 'your original payment method';
    return {
      title: 'Cancel and refund?',
      message: `${lead} ${dollars(plan.refundAmount)} goes back to ${where}.`,
      confirmLabel: 'Cancel and refund',
    };
  }
  return {
    title: 'Cancel this bounty?',
    message: bounty.is_for_honor
      ? `${lead} It's a for-honor bounty, so no money is involved.`
      : `${lead} You haven't been charged for it, so there's nothing to refund.`,
    confirmLabel: 'Cancel bounty',
  };
}

/** The line shown once the cancellation has gone through. */
export function describeCancelRefundDone(plan: CancelRefundPlan): string {
  if (plan.destination && plan.refundAmount > 0) {
    const where = plan.destination === 'wallet' ? 'your Bounty balance' : 'your original payment method';
    return `It's off the feed, and ${dollars(plan.refundAmount)} is on its way back to ${where}.`;
  }
  return "It's off the feed.";
}

/**
 * Refund (when something is held), then delete. Throws
 * BountyRefundFailedError when the refund did not complete — the bounty is
 * left in place so no money is lost — and any other error if the delete
 * failed after a successful refund.
 */
export async function cancelAndRefundBounty(
  bounty: CancellableBounty,
  deps: CancelRefundDeps,
  plan?: CancelRefundPlan
): Promise<CancelRefundPlan> {
  const resolved = plan ?? (await planCancelRefund(bounty));

  if (resolved.destination) {
    const useV2 = isPhase2Bounty(bounty as any);
    const useV3 = isV3Bounty(bounty as any);
    const architecture = useV3 ? 'v3' : useV2 ? 'v2' : 'v1';
    try {
      await analyticsService.trackEvent('payment_architecture_routed', {
        bountyId: String(bounty.id),
        version: useV3 ? 3 : useV2 ? 2 : 1,
        context: 'cancel',
      });
    } catch {
      /* analytics is best-effort */
    }
    try {
      if (useV2 || useV3) {
        // Stripe-native escrow: cancels the PaymentIntent or v3 auth.
        // Only terminal states are safe to treat as a successful refund.
        const cancelResult = await bountyPaymentsService.cancelBountyPayment(String(bounty.id));
        if (cancelResult.status !== 'canceled' && cancelResult.status !== 'refunded') {
          throw new Error(`Escrow cancellation is still pending (${cancelResult.status})`);
        }
      } else {
        // refundEscrow signals failure by returning false, not by throwing —
        // so the boolean must be checked or a failed refund would still
        // delete the bounty and lose the money.
        const refunded = await deps.refundEscrow(bounty.id, bounty.title, 100); // 100% refund for unaccepted bounties
        if (!refunded) {
          throw new Error('Escrow refund did not complete');
        }
      }
      try {
        await analyticsService.trackEvent('escrow_refunded', {
          bountyId: String(bounty.id),
          architecture,
          amount: bounty.amount,
        });
      } catch {
        /* analytics is best-effort */
      }
    } catch (refundError) {
      console.error('Error refunding escrow:', refundError);
      try {
        await analyticsService.trackEvent('payment_failed', {
          bountyId: String(bounty.id),
          architecture,
          stage: 'cancel',
          ...failureEventProps(refundError),
        });
      } catch {
        /* analytics is best-effort */
      }
      throw new BountyRefundFailedError(refundError);
    }
  }

  const success = await bountyService.delete(bounty.id);
  if (!success) {
    throw new Error('Failed to delete bounty');
  }
  return resolved;
}
