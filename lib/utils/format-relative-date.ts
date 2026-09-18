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
