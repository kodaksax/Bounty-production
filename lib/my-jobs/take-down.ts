/**
 * J.4 "Take this job down": what it says about money, shared by the poster's
 * workspace and My Jobs so both tell the same truth.
 */
import { describeCancelRefund, planCancelRefund, type CancelRefundPlan } from '../services/bounty-cancel-refund';
import { getBountyFundingRequirement } from '../services/bounty-funding-service';
import type { Bounty } from '../services/database.types';
import type { OpenJobCharge } from '../utils/poster-stage-copy';
import type { StageMoney } from '../utils/stage-copy-types';

/**
 * What to tell the poster about money on an open, unhired job.
 *
 * `plan` is planCancelRefund's answer, unchanged, and is the only thing a
 * take-down ever acts on. `charge` is for wording only. When
 * fn_get_bounty_funding_requirement can't be read, getBountyFundingRequirement
 * answers "already funded" (so a take-down still tries the refund rather than
 * stranding money), which would make an unpaid pay-when-you-choose job look
 * paid. So for an at_accept job a "held" answer is re-read: a real reply
 * echoes the job's own funding_mode, while that fallback says 'at_post'.
 * Anything not confirmed is 'unknown', never 'held'.
 */
export async function readOpenJobMoney(
  bounty: Bounty
): Promise<{ plan: CancelRefundPlan; charge: Exclude<OpenJobCharge, 'checking'> }> {
  const plan = await planCancelRefund(bounty);
  if (!plan.destination || plan.refundAmount <= 0) return { plan, charge: 'not_charged' };
  if (bounty.funding_mode !== 'at_accept') return { plan, charge: 'held' };
  const req = await getBountyFundingRequirement(bounty.id);
  const confirmed = req.fundingMode === 'at_accept' && req.alreadyFunded;
  return { plan, charge: confirmed ? 'held' : 'unknown' };
}

/**
 * J.4, the take-down confirmation, honest about money by case:
 * - money held: the planner's own "Cancel and refund?" with the amount and
 *   where it goes (describeCancelRefund);
 * - charge not confirmed: says so, and what would come back if it was;
 * - nothing charged: the handoff's copy, "You haven't been charged, so
 *   there's nothing to refund."
 * The plan it confirms, and so what happens, is the same either way.
 * TODO(E) Q-PRD-4: tell the people who offered, and an undo (J.4).
 */
export function describeTakeDown(
  bounty: Pick<Bounty, 'is_for_honor'>,
  plan: CancelRefundPlan,
  charge: OpenJobCharge
): { title: string; body: string; money: StageMoney | null; confirmLabel: string; cancelLabel: string } {
  const refunds = !!plan.destination && plan.refundAmount > 0;
  const body = "It will be removed, along with any offers. This can't be undone.";
  const cancelLabel = 'Keep my job';
  if (refunds) {
    const where = plan.destination === 'wallet' ? 'your Bounty balance' : 'your original payment method';
    const amount = `$${plan.refundAmount % 1 === 0 ? plan.refundAmount.toFixed(0) : plan.refundAmount.toFixed(2)}`;
    if (charge === 'held') {
      const base = describeCancelRefund(bounty, plan);
      return { title: base.title, body, money: { kind: 'released', text: `${amount} goes back to ${where}.` }, confirmLabel: base.confirmLabel, cancelLabel };
    }
    return {
      title: 'Take this job down?',
      body,
      money: { kind: 'warn', text: `We couldn't confirm whether you've been charged for it. If you were, ${amount} goes back to ${where}.` },
      confirmLabel: 'Yes, take it down',
      cancelLabel,
    };
  }
  return {
    title: 'Take this job down?',
    body,
    money: {
      kind: 'none',
      text: bounty.is_for_honor
        ? "It's a for-honor bounty, so no money is involved."
        : "You haven't been charged, so there's nothing to refund.",
    },
    confirmLabel: 'Yes, take it down',
    cancelLabel,
  };
}
