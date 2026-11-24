/**
 * Small, pure formatting helpers for My Jobs copy. Kept separate so the copy
 * builders read as sentences rather than string plumbing.
 */
export { getBountyCategoryIcon, getBountyCoverUri } from '../utils/bounty-cover';

/** "$60", "$60.50", "For honor". Whole amounts drop the cents, as in the design. */
export function formatJobAmount(amount: number | null | undefined, isForHonor?: boolean | null): string {
  if (isForHonor) return 'For honor';
  const value = Number.isFinite(amount) ? Number(amount) : 0;
  const whole = Math.round(value * 100) % 100 === 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(value);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A day as people say it: "today", "yesterday", "Tuesday" within the last
 * week, otherwise "Mar 4". Returns null for a missing or invalid date so
 * callers can drop the clause instead of printing "Invalid Date".
 */
export function formatJobDay(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return WEEKDAYS[date.getDay()];
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** The first name of a display name, for warm, short copy ("Ada", not "Ada R."). */
export function firstName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

/** "1 person wants" / "3 people want". */
export function peopleWant(count: number): string {
  return count === 1 ? '1 person wants' : `${count} people want`;
}
