/**
 * "Today" / "Yesterday" / "12d ago" / "3mo ago" / "2y ago" for a user-visible
 * timestamp (e.g. a review date). Bucketed by whole days elapsed since `iso`,
 * using fixed 30-day months and 12-month years -- an approximation, not a
 * calendar-accurate diff, which is fine for a coarse "how long ago" label.
 *
 * Returns '' for a missing or unparseable ISO string rather than throwing or
 * rendering "Invalid Date", and treats any non-positive day count (including
 * a future timestamp, e.g. from clock skew) as "Today" rather than negative
 * days.
 */
export function formatRelativeDate(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/**
 * "just now" / "12m ago" / "3h ago" / "4d ago" / "2mo ago" / "1y ago" for when
 * a bounty was posted, derived from its real created_at. Finer than
 * formatRelativeDate because a feed's freshness is measured in hours.
 *
 * Returns '' for a missing or unparseable timestamp, so callers omit the line
 * instead of inventing one. A future timestamp (clock skew) reads "just now".
 */
export function formatPostedAgo(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
