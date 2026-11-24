/**
 * Profile › Past jobs (Focus-first P.1): finished and cancelled jobs from both
 * sides, built from the reads the app already makes — the bounties you posted,
 * your offers with their bounties, the reviews you received, payment settlement
 * records, and your wallet's own refund records. No new endpoint or table.
 *
 * Money is only stated where something the app already trusts says it:
 *   - A hunter's take-home comes from calculateHunterEarnings, the same figure
 *     the job's own receipt (H.10) and the thread strip show. Wallet rows are
 *     not used for it: the poster's wallet logs `release` rows too, and Phase 2
 *     earnings sit in the Connect account, not the wallet ledger.
 *   - "Released" vs pending/unknown comes from confirmed payment settlement,
 *     never from the bounty's completed status alone.
 *   - "back to your balance" needs a `refund` record for that job in the
 *     wallet, on a wallet-funded (v1) job. A card-funded job refunds to the
 *     card, so it says "refunded" without a destination.
 * Without a record, the row says what happened and claims no money.
 *
 * Wording: "Released" is the wallet credit; "Paid" is kept for money that
 * reached a bank (Q-PAY-4), so no row here says "Paid".
 *
 * DESIGN-GAP (P.1):
 *  - the handoff's "Paid · $72 to your wallet" reads "Released · $72 to your
 *    wallet" (Q-PAY-4);
 *  - its "5 out of 5 · 1 review" shows no average below MIN_RATING_SAMPLE;
 *  - it lists disputed jobs, but a dispute is a record on an active job, not a
 *    bounty status: resolved disputes end completed or cancelled and show here;
 *  - take-home is today's fee (calculateHunterEarnings), the same figure the
 *    receipt shows; a job done under an older fee isn't re-read per job.
 * TODO(E): one list across both sides, and the fee actually charged per job.
 */
import { calculateHunterEarnings } from '../constants/fees';
import type { Bounty } from '../services/database.types';
import type { UserRating } from '../types';
import { isStripeNativeBounty } from '../utils/payment-architecture';
import { MIN_RATING_SAMPLE } from '../utils/trust-summary';
import { firstName, formatJobAmount, formatJobDay, getBountyCategoryIcon } from './format';
import type { IconName } from './types';

export type PastOutcome = 'completed' | 'cancelled';

/**
 * How a job ended, or null if it isn't a past job. Archiving is only offered
 * on a finished job (getJobManageActions, the hunter receipt) and tells the
 * user "You'll still find it in your history", so an archived job with a
 * completion time counts as finished. One removed from the list ('deleted')
 * stays out.
 */
export function pastOutcome(b: { status?: string | null; completed_at?: string | null }): PastOutcome | null {
  const status = String(b.status ?? '');
  if (status === 'completed' || status === 'cancelled') return status;
  if (status === 'archived' && b.completed_at) return 'completed';
  return null;
}

export type PastJobSide = 'did' | 'posted';

export interface PastJobRow {
  key: string;
  bountyId: string;
  side: PastJobSide;
  icon: IconName;
  title: string;
  /** "For Jordan K. · Saturday", "Sam T. · October", "September". */
  meta: string;
  /** What the amount column shows; null when there is no figure to stand behind. */
  amount: string | null;
  /** handoff `arow` st: done → check in green, cancel → cross in grey. */
  state: 'done' | 'cancel';
  status: string;
  /** "“Quick and tidy, cables hidden.” Jordan · 5 stars" — WORK YOU DID only. */
  quote: string | null;
  /** For newest-first ordering. */
  at: number;
}

export interface WalletRefundRecord {
  type: string;
  amount: number;
  details?: { bounty_id?: string | number | null } | null;
}

/** Refunds the wallet recorded, per job (positive amounts only). */
export function refundsByBounty(transactions: readonly WalletRefundRecord[] | null | undefined): Map<string, number> {
  const refunds = new Map<string, number>();
  for (const tx of transactions ?? []) {
    if (tx?.type !== 'refund' || !(tx.amount > 0)) continue;
    const id = tx.details?.bounty_id;
    if (id == null || id === '') continue;
    refunds.set(String(id), (refunds.get(String(id)) ?? 0) + tx.amount);
  }
  return refunds;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * When a past job ended, as the design writes it: "Today", "Yesterday",
 * "Saturday" within the last week, the month this year ("October"), and the
 * month and year before that ("October 2025").
 */
export function formatPastDay(iso: string | null | undefined, now: Date = new Date()): string | null {
  // formatJobDay: "today", "yesterday" or a weekday within the week, else "Mar 4".
  const near = formatJobDay(iso, now);
  if (!near || !iso) return null;
  if (!/\d/.test(near)) return capitalize(near);
  const date = new Date(iso);
  const month = MONTH_NAMES[date.getMonth()];
  return date.getFullYear() === now.getFullYear() ? month : `${month} ${date.getFullYear()}`;
}

/**
 * When the job ended. A cancelled job has no end time of its own, so it uses
 * the row's last update (selected by FEED_SAFE_BOUNTY_COLUMNS, not declared on
 * the Bounty type).
 */
function endedAt(b: Bounty & { updated_at?: string | null }): string | null {
  return b.completed_at ?? b.updated_at ?? b.created_at ?? null;
}

function stars(score: number): string {
  return `${score} ${score === 1 ? 'star' : 'stars'}`;
}

/** The review a poster left about your work on this job, as the row's quote line. */
function quoteFor(review: UserRating | undefined): string | null {
  if (!review) return null;
  const who = firstName(review.raterName);
  const tail = [who, stars(review.score)].filter(Boolean).join(' · ');
  const comment = review.comment?.trim();
  return comment ? `“${comment}” ${tail}` : tail;
}

export interface PastJobsInput {
  viewerId: string;
  /** Bounties you posted (any status; past ones are picked out here). */
  posted: readonly Bounty[];
  /** Your offers, each with its bounty. */
  offers: readonly { bounty?: Bounty | null }[];
  /** bountyId → the chosen helper's name, for jobs you posted. */
  helperNames?: ReadonlyMap<string, string>;
  /** Reviews you received. */
  reviews?: readonly UserRating[] | null;
  /** From refundsByBounty. */
  refunds?: ReadonlyMap<string, number>;
  /** Confirmed payment settlement, separate from the bounty's completed status. */
  paymentStates?: ReadonlyMap<string, 'released' | 'pending' | 'unknown'>;
  now?: Date;
}

export interface PastJobs {
  work: PastJobRow[];
  posted: PastJobRow[];
  /** Take-home from finished paid work you did (calculateHunterEarnings). */
  earned: number;
}

export function buildPastJobs({
  viewerId,
  posted,
  offers,
  helperNames,
  reviews,
  refunds,
  paymentStates,
  now = new Date(),
}: PastJobsInput): PastJobs {
  const me = String(viewerId);
  const reviewByBounty = new Map<string, UserRating>();
  for (const r of reviews ?? []) {
    if (r.bountyId == null) continue;
    // Only what a poster said about your work belongs on a WORK YOU DID row.
    if (r.raterRole && r.raterRole !== 'poster') continue;
    if (!reviewByBounty.has(String(r.bountyId))) reviewByBounty.set(String(r.bountyId), r);
  }

  let earned = 0;
  const seen = new Set<string>();
  const work: PastJobRow[] = [];
  for (const offer of offers) {
    const b = offer?.bounty;
    const outcome = b ? pastOutcome(b) : null;
    if (!b || !outcome || String(b.accepted_by ?? '') !== me) continue;
    const id = String(b.id);
    if (seen.has(id)) continue;
    seen.add(id);

    const honor = !!b.is_for_honor;
    const done = outcome === 'completed';
    const poster = b.username?.trim() || null;
    const meta = [poster ? `For ${poster}` : null, formatPastDay(endedAt(b), now)].filter(Boolean).join(' · ');
    let amount: string | null = null;
    let status = 'Cancelled';
    if (done && honor) {
      amount = 'For honor';
      status = 'Finished for honor';
    } else if (done) {
      const { net } = calculateHunterEarnings(b.amount);
      earned += net;
      amount = formatJobAmount(net);
      const settlement = paymentStates?.get(id) ?? 'unknown';
      status =
        settlement === 'released'
          ? `Released · ${amount} to your wallet`
          : settlement === 'pending'
            ? `Approved · ${amount} on its way to your wallet`
            : `Approved · ${amount} settlement unconfirmed`;
    }
    work.push({
      key: `did:${id}`,
      bountyId: id,
      side: 'did',
      icon: getBountyCategoryIcon(b.category) as IconName,
      title: b.title,
      meta,
      amount,
      state: done ? 'done' : 'cancel',
      status,
      quote: done ? quoteFor(reviewByBounty.get(id)) : null,
      at: new Date(endedAt(b) ?? 0).getTime() || 0,
    });
  }

  const postedRows: PastJobRow[] = [];
  for (const b of posted) {
    const outcome = pastOutcome(b);
    if (!outcome) continue;
    const id = String(b.id);
    const honor = !!b.is_for_honor;
    const done = outcome === 'completed';
    const helper = helperNames?.get(id) ?? null;
    const helperFirst = firstName(helper) ?? 'your helper';
    const meta = [helper, formatPastDay(endedAt(b), now)].filter(Boolean).join(' · ');
    const amount = formatJobAmount(b.amount, honor);
    let status: string;
    if (done) {
      const settlement = paymentStates?.get(id) ?? 'unknown';
      status = honor
        ? 'Finished'
        : settlement === 'released'
          ? `Finished · ${amount} released to ${helperFirst}`
          : settlement === 'pending'
            ? `Finished · ${amount} release pending to ${helperFirst}`
            : `Finished · ${amount} settlement unconfirmed`;
    } else {
      const refund = honor ? undefined : refunds?.get(id);
      status =
        refund == null
          ? 'Cancelled'
          : isStripeNativeBounty(b)
            ? `Cancelled · ${formatJobAmount(refund)} refunded`
            : `Cancelled · ${formatJobAmount(refund)} back to your balance`;
    }
    postedRows.push({
      key: `posted:${id}`,
      bountyId: id,
      side: 'posted',
      icon: getBountyCategoryIcon(b.category) as IconName,
      title: b.title,
      meta,
      amount,
      state: done ? 'done' : 'cancel',
      status,
      quote: null,
      at: new Date(endedAt(b) ?? 0).getTime() || 0,
    });
  }

  const newestFirst = (a: PastJobRow, z: PastJobRow) => z.at - a.at;
  return { work: work.sort(newestFirst), posted: postedRows.sort(newestFirst), earned };
}

export interface RatingFact {
  label: string;
  value: string;
  /** Below the review threshold, the value is shown in the secondary colour. */
  muted: boolean;
}

function formatAverage(avg: number): string {
  const rounded = Math.round(avg * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function ratingValue(average: number | null, count: number): string {
  if (count <= 0) return 'No reviews yet';
  // MIN_RATING_SAMPLE: no average until there are enough reviews to mean something.
  if (count < MIN_RATING_SAMPLE || average == null) return `${count} ${count === 1 ? 'review' : 'reviews'} so far`;
  return `${formatAverage(average)} out of 5 · ${count} reviews`;
}

/**
 * "Your rating as a helper: 4.9 out of 5 · 12 reviews".
 *
 * get_profile_activity_stats counts every review you received, from either
 * side. The helper-only figure comes from the review list (get_user_reviews,
 * whose rows carry rater_role) when that list is complete; otherwise the
 * fact falls back to the overall figure under a neutral label rather than
 * calling it a helper rating.
 */
export function describeRatingFact({
  reviews,
  aggregate,
  workedAsHelper,
  didIds,
  postedIds,
}: {
  reviews: readonly UserRating[] | null | undefined;
  aggregate: { averageRating: number; ratingCount: number } | null | undefined;
  /** Whether the account has done any work; a poster-only account gets the overall rating. */
  workedAsHelper: boolean;
  didIds: ReadonlySet<string>;
  postedIds: ReadonlySet<string>;
}): RatingFact {
  const overall = (): RatingFact => {
    const count = aggregate?.ratingCount ?? reviews?.length ?? 0;
    const average =
      aggregate && aggregate.ratingCount > 0
        ? aggregate.averageRating
        : reviews && reviews.length > 0
          ? reviews.reduce((sum, r) => sum + r.score, 0) / reviews.length
          : null;
    return { label: 'Your rating', value: ratingValue(average, count), muted: count < MIN_RATING_SAMPLE };
  };
  if (!workedAsHelper) return overall();

  const list = reviews ?? null;
  const total = aggregate?.ratingCount ?? 0;
  if (!list || list.length < total) return overall();
  let helper = 0;
  let sum = 0;
  for (const r of list) {
    const id = r.bountyId != null ? String(r.bountyId) : '';
    const role = r.raterRole ?? (didIds.has(id) ? 'poster' : postedIds.has(id) ? 'hunter' : null);
    if (role == null) return overall();
    if (role === 'poster') {
      helper += 1;
      sum += r.score;
    }
  }
  return {
    label: 'Your rating as a helper',
    value: ratingValue(helper > 0 ? sum / helper : null, helper),
    muted: helper < MIN_RATING_SAMPLE,
  };
}
