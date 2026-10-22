/**
 * How a Stripe refund is reflected into Bounty's own records.
 *
 * Extracted as pure functions so the money-path rules are unit testable
 * without standing up the webhook, Stripe or a database.
 *
 * Why this exists: the webhook pins apiVersion 2023-10-16, and since
 * 2022-11-15 a Charge no longer embeds its `refunds` list unless the caller
 * expands it. Event payloads are never expanded, so `charge.refunds?.data`
 * was always undefined in `charge.refunded`. Two things followed:
 *
 *   - v2 (bounty_payments): every refund was written as `refund_pending` with
 *     no refund id and never advanced. In production five refunds that Stripe
 *     completed in September were still shown to posters as "on its way".
 *   - v1 (wallet): the handler logged "no refunds — skipping", so a deposit
 *     refunded in Stripe was never taken off the wallet balance. The refunded
 *     money stayed spendable.
 *
 * The fix is to read the refunds from Stripe when the event does not carry
 * them, and to let `refund.created` / `refund.updated` (whose object IS the
 * Refund) advance a v2 row, so a refund that is still pending when
 * `charge.refunded` fires is shown as refunded once it succeeds. Both paths
 * are idempotent: apply_refund is keyed on stripe_refund_id, and the
 * bounty_payments update only advances captured / refund_pending rows.
 */

/** The subset of a Stripe Refund these decisions depend on. */
export interface RefundLike {
  id: string;
  /** pending | requires_action | succeeded | failed | canceled */
  status: string | null;
  /** Smallest currency unit (cents). */
  amount: number;
  /** Unix seconds. Used only to order refunds. */
  created?: number;
  /** Stripe's refund reason; recorded in the v1 refund row's metadata. */
  reason?: string | null;
}

/** The subset of a Stripe Charge these decisions depend on. */
export interface ChargeRefundsView {
  id: string;
  refunds?: { data?: RefundLike[] | null } | null;
}

/** Refund statuses under which money is not (or no longer) going back. */
const DEAD_REFUND_STATUSES = new Set(['failed', 'canceled']);

/**
 * The refunds a `charge.refunded` event is about.
 *
 * Uses the embedded list when the payload has one (older API versions, or a
 * caller that expanded it) and otherwise asks Stripe. Never returns the empty
 * embedded list as an answer: an event that says "this charge was refunded"
 * with no refunds attached is exactly the case that used to be skipped.
 */
export async function resolveChargeRefunds(
  charge: ChargeRefundsView,
  listRefunds: (chargeId: string) => Promise<RefundLike[]>
): Promise<RefundLike[]> {
  const embedded = charge.refunds?.data;
  if (Array.isArray(embedded) && embedded.length > 0) return embedded;
  return await listRefunds(charge.id);
}

const byCreated = (a: RefundLike, b: RefundLike) => (a.created ?? 0) - (b.created ?? 0);

/**
 * Refunds on which money is leaving, or has left, the platform, oldest first:
 * everything except failed and canceled ones.
 *
 * These are what a v1 wallet balance is debited for. `charge.refunded` fires
 * once, when the refund is created, so a pending refund has to be applied
 * here or it never is; that is also what the handler did when the payload
 * still embedded its refunds. A pending refund that later fails is reported
 * by `refund.failed`, which pages.
 */
export function liveRefunds(refunds: RefundLike[]): RefundLike[] {
  return refunds.filter(r => !DEAD_REFUND_STATUSES.has(String(r.status))).sort(byCreated);
}

/** Refunds that have actually returned money to the customer, oldest first. */
export function succeededRefunds(refunds: RefundLike[]): RefundLike[] {
  return refunds.filter(r => r.status === 'succeeded').sort(byCreated);
}

export interface RefundCoverage {
  status: 'refunded' | 'refund_pending' | null;
  remainingCents: number;
  stripeRefundId: string | null;
}

/** Current Stripe refunds that cover a bounty payment and any amount still due. */
export function summarizeRefundCoverage(rowAmountDollars: number, refunds: RefundLike[]): RefundCoverage {
  const live = liveRefunds(refunds).filter(r =>
    ['succeeded', 'pending'].includes(String(r.status))
  );
  const succeeded = succeededRefunds(live);
  const totalCents = Math.round(Number(rowAmountDollars) * 100);
  const succeededCents = succeeded.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const liveCents = live.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  return {
    status:
      totalCents > 0 && succeededCents >= totalCents
        ? 'refunded'
        : totalCents > 0 && liveCents >= totalCents
          ? 'refund_pending'
          : null,
    remainingCents: Math.max(0, totalCents - liveCents),
    stripeRefundId: live[live.length - 1]?.id ?? null,
  };
}

export interface BountyPaymentRefundUpdate {
  status: 'refunded' | 'refund_pending';
  stripeRefundId: string | null;
}

/**
 * What a v2 bounty_payments row should become, given the refunds against its
 * charge. Returns null when nothing should change (no live refund at all).
 *
 * `refunded` only when refunds that succeeded cover the whole bounty amount.
 * Anything less (still pending, or partial) is `refund_pending`, which the
 * poster sees as "on its way" and which a later refund.updated can advance.
 */
export function bountyPaymentRefundUpdate(
  rowAmountDollars: number,
  refunds: RefundLike[]
): BountyPaymentRefundUpdate | null {
  const live = liveRefunds(refunds);
  if (live.length === 0) return null;

  const done = succeededRefunds(live);
  const succeededCents = done.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const rowCents = Math.round(Number(rowAmountDollars) * 100);

  if (rowCents > 0 && succeededCents >= rowCents) {
    return { status: 'refunded', stripeRefundId: done[done.length - 1].id };
  }
  return { status: 'refund_pending', stripeRefundId: live[live.length - 1].id };
}
