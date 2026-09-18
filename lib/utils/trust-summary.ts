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
