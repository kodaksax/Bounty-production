/**
 * Shared "how do I know this hunter is legit" formatting for the poster-facing
 * trust layer (applicant cards, profile headers). Centralized so the
 * small-sample rating rule can't drift between call sites.
 */

export interface HunterTrustInput {
  /** Bounties this user completed AS THE HUNTER (get_profile_activity_stats.hunter_completed). */
  hunterCompleted?: number | null;
  averageRating?: number | null;
  ratingCount?: number | null;
}

/** Ratings below this count are too small a sample to present as meaningful. */
export const MIN_RATING_SAMPLE = 3;

/**
 * "3 bounties done · ★4.9 (4)" / "3 bounties done" / "New to Bounty".
 *
 * Never renders a bare "★0" or an average built from fewer than
 * MIN_RATING_SAMPLE ratings -- a 5-star rating from one job reads as
 * meaningful when it's actually noise. Below the threshold, the rating is
 * omitted entirely rather than shown as unreliable; the completed-jobs count
 * (if any) still stands on its own.
 *
 * averageRating is only rendered when it's a finite number > 0 -- a null
 * (no average available, e.g. an upstream RPC hiccup) or a corrupt/zero
 * value must never be conflated with a real "0 stars" and printed as
 * "★0.0", even if ratingCount alone clears the sample threshold.
 */
export function formatHunterTrustSummary(input: HunterTrustInput): string {
  const hunterCompleted = Math.max(0, Number(input.hunterCompleted) || 0);
  const ratingCount = Math.max(0, Number(input.ratingCount) || 0);
  const averageRating = input.averageRating;

  const parts: string[] = [];
  if (hunterCompleted > 0) {
    parts.push(`${hunterCompleted} bount${hunterCompleted === 1 ? 'y' : 'ies'} done`);
  }
  if (
    ratingCount >= MIN_RATING_SAMPLE &&
    typeof averageRating === 'number' &&
    Number.isFinite(averageRating) &&
    averageRating > 0
  ) {
    parts.push(`★${averageRating.toFixed(1)} (${ratingCount})`);
  }

  if (parts.length === 0) return 'New to Bounty';
  return parts.join(' · ');
}

export interface PosterTrustInput {
  /** Bounties this user POSTED that reached 'completed' (get_profile_activity_stats.bounties_completed). */
  bountiesCompleted?: number | null;
  averageRating?: number | null;
  ratingCount?: number | null;
}

/**
 * "3 completed bounties · ★4.8 (4)" / "3 completed bounties" /
 * "No completed bounties yet".
 *
 * The hunter-facing counterpart of formatHunterTrustSummary, with the same
 * MIN_RATING_SAMPLE rule. A poster with no history says so plainly rather
 * than falling back to something that reads as credibility: a hunter weighing
 * an unfunded bounty from a day-old account needs to see exactly that.
 * "Completed" is the bounty's status, not a verified payout, so the copy
 * never says "paid".
 */
export function formatPosterTrustSummary(input: PosterTrustInput): string {
  const completed = Math.max(0, Number(input.bountiesCompleted) || 0);
  const ratingCount = Math.max(0, Number(input.ratingCount) || 0);
  const averageRating = input.averageRating;

  const parts: string[] = [];
  parts.push(
    completed > 0
      ? `${completed} completed bount${completed === 1 ? 'y' : 'ies'}`
      : 'No completed bounties yet'
  );
  if (
    ratingCount >= MIN_RATING_SAMPLE &&
    typeof averageRating === 'number' &&
    Number.isFinite(averageRating) &&
    averageRating > 0
  ) {
    parts.push(`★${averageRating.toFixed(1)} (${ratingCount})`);
  }
  return parts.join(' · ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Joined today" / "Joined 3 days ago" / "Joined Mar 2026" from an account's
 * created_at. Recent accounts get a day count rather than a month, because
 * "Joined Oct 2026" on a 1-day-old account hides the one thing a hunter
 * needs to know. Returns '' for a missing or unparseable timestamp.
 */
export function formatAccountAge(createdAt?: string | null, now: number = Date.now()): string {
  if (!createdAt) return '';
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return '';
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return 'Joined today';
  if (days === 1) return 'Joined yesterday';
  if (days < 30) return `Joined ${days} days ago`;
  const d = new Date(t);
  return `Joined ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
