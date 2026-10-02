/**
 * The poster's review deadline for submitted work (trust-spine audit T6).
 *
 * The server owns the clock: `completion_submissions.submitted_at` is stamped
 * by the database on insert, and `fn_process_completion_review_window`
 * (supabase/migrations/20261002120100_review_window_and_recourse_queue.sql)
 * reminds the poster at +24h / +48h and hands the bounty to Bounty support at
 * +72h. This file only renders that deadline, so both sides read the same
 * sentence. Keep REVIEW_WINDOW_HOURS equal to completion_review_policy.window_hours.
 *
 * Phase A: support reviews an overdue submission; nothing is released
 * automatically. Do not promise automatic payment in this copy.
 */

export const REVIEW_WINDOW_HOURS = 72;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** submitted_at + the review window, or null when there is no usable timestamp. */
export function getReviewDeadline(submittedAt: string | Date | null | undefined): Date | null {
  if (!submittedAt) return null;
  const start = submittedAt instanceof Date ? submittedAt : new Date(submittedAt);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + REVIEW_WINDOW_HOURS * 60 * 60 * 1000);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${m < 10 ? '0' : ''}${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * "today at 3:00 PM", "tomorrow at 9:05 AM", "Friday at 3:00 PM",
 * "yesterday at …", or "Oct 9 at 3:00 PM" beyond a week. Device-local time.
 */
export function formatReviewDeadline(deadline: Date, now: Date = new Date()): string {
  const days = Math.round((startOfDay(deadline) - startOfDay(now)) / DAY_MS);
  let day: string;
  if (days === 0) day = 'today';
  else if (days === 1) day = 'tomorrow';
  else if (days === -1) day = 'yesterday';
  else if (days > 1 && days < 7) day = WEEKDAYS[deadline.getDay()];
  else if (days < -1 && days > -7) day = `last ${WEEKDAYS[deadline.getDay()]}`;
  else day = `${MONTHS[deadline.getMonth()]} ${deadline.getDate()}`;
  return `${day} at ${clock(deadline)}`;
}

export interface ReviewDeadlineStatus {
  deadline: Date;
  /** Past the window: Bounty support is reviewing. */
  overdue: boolean;
  /** The sentence to show this viewer. */
  message: string;
}

/**
 * The deadline sentence for one viewer. Returns null when there is no pending
 * submission timestamp to measure from.
 */
export function getReviewDeadlineStatus(
  submittedAt: string | Date | null | undefined,
  viewer: 'poster' | 'hunter',
  now: Date = new Date()
): ReviewDeadlineStatus | null {
  const deadline = getReviewDeadline(submittedAt);
  if (!deadline) return null;
  const when = formatReviewDeadline(deadline, now);
  const overdue = now.getTime() >= deadline.getTime();

  let message: string;
  if (viewer === 'hunter') {
    message = overdue
      ? `The poster didn't respond by ${when}, so Bounty support is reviewing your work. We'll let you know what happens.`
      : `The poster has until ${when} to approve the work or raise a problem. If they don't respond, Bounty reviews it.`;
  } else {
    message = overdue
      ? `Your review window closed ${when}, so Bounty support is reviewing this. You can still approve the work or report a problem.`
      : `You have until ${when} to approve the work or report a problem. If you don't respond, Bounty reviews it.`;
  }
  return { deadline, overdue, message };
}
