/**
 * Single source of truth for the status a bounty *displays* on its card.
 *
 * A bounty's `status` column is not the whole story: the badge a user sees also
 * depends on their role (poster vs hunter), on their own application's status,
 * on whether work has been submitted for review, and on whether the deadline
 * has passed. Those overlays used to be computed inline in BountyCard, while
 * the Postings screen filter chips matched on `bounty.status` alone — so a chip
 * labelled "In Progress" happily listed cards reading "REJECTED" or "SUBMITTED
 * FOR REVIEW".
 *
 * Everything that needs to reason about the *visible* status — the card badge
 * and the filter chips — must go through `getBountyDisplayStatus` so the two
 * can never drift apart again.
 */
import { isBountyDeadlinePassed } from './schedule-utils';

export type BountyDisplayStatus =
  /** Poster-facing: the hunter submitted work that is waiting on your review. */
  | 'review_needed'
  /** Hunter-facing: you submitted work that is waiting on the poster's review. */
  | 'submitted_for_review'
  | 'deadline_passed'
  /** Hunter-facing: your application is still pending on an open bounty. */
  | 'applied'
  /** Hunter-facing: your application was rejected. */
  | 'rejected'
  | 'open'
  | 'in_progress'
  | 'completed'
  | 'archived'
  | 'cancelled'
  | 'cancellation_requested';

export interface BountyDisplayStatusInput {
  /** The bounty's own status column plus the deadline used for the overlay. */
  bounty: { status?: string | null; end_date?: string | null };
  /** True when the viewer is the poster and a submission awaits their review. */
  reviewNeeded?: boolean;
  /** True when the viewer is the hunter and their submission awaits the poster. */
  submittedForReview?: boolean;
  /** The viewer's own request status for this bounty (pending/accepted/rejected). */
  requestStatus?: string | null;
}

/**
 * Resolves the badge a bounty card shows. Order matters: the earlier checks are
 * overlays that intentionally mask the underlying `bounty.status`.
 */
export function getBountyDisplayStatus({
  bounty,
  reviewNeeded,
  submittedForReview,
  requestStatus,
}: BountyDisplayStatusInput): BountyDisplayStatus {
  if (reviewNeeded) return 'review_needed';
  if (submittedForReview) return 'submitted_for_review';
  if (isBountyDeadlinePassed(bounty)) return 'deadline_passed';
  if (bounty.status === 'open' && requestStatus === 'pending') return 'applied';
  if (requestStatus === 'rejected') return 'rejected';
  switch (bounty.status) {
    case 'open':
      return 'open';
    case 'in_progress':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'archived':
      return 'archived';
    case 'cancelled':
      return 'cancelled';
    case 'cancellation_requested':
      return 'cancellation_requested';
    default:
      return 'open';
  }
}

/** Badge text shown on the card for each display status. */
export const BOUNTY_DISPLAY_STATUS_LABELS: Record<BountyDisplayStatus, string> = {
  review_needed: 'REVIEW NEEDED',
  submitted_for_review: 'SUBMITTED FOR REVIEW',
  deadline_passed: 'DEADLINE PASSED',
  applied: 'APPLIED',
  rejected: 'REJECTED',
  open: 'OPEN',
  in_progress: 'IN PROGRESS',
  completed: 'COMPLETED',
  archived: 'ARCHIVED',
  cancelled: 'CANCELLED',
  cancellation_requested: 'CANCELLATION PENDING',
};

/** Badge background color shown on the card for each display status. */
export const BOUNTY_DISPLAY_STATUS_COLORS: Record<BountyDisplayStatus, string> = {
  review_needed: '#fbbf24', // amber-400
  submitted_for_review: '#38bdf8', // sky-400
  deadline_passed: '#6b7280', // gray-500, same treatment as archived
  applied: '#3b82f6', // blue-500
  rejected: '#ef4444', // red-500
  open: '#059669', // emerald-600
  in_progress: '#fbbf24', // amber-400
  completed: '#6366f1', // indigo-500
  archived: '#6b7280', // gray-500
  cancelled: '#ef4444', // red-500
  cancellation_requested: '#f97316', // orange-500
};
