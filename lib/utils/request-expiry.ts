/**
 * How long an application waits for the poster before it closes on its own.
 *
 * The server owns this rule: fn_expire_bounty_requests reads
 * `posting_policy_config.request_expiry_hours` (an application the poster has
 * not engaged with) and `request_interacted_expiry_hours` (one they have, e.g.
 * by messaging the hunter), and closes the request with
 * rejection_source = 'system_expiry'. These defaults are the same COALESCE
 * fallbacks that function uses, so the copy is right even before the live
 * values load (see hooks/useRequestExpiryPolicy.ts).
 *
 * A system closure is never a rejection: nothing in the app or the database
 * scores a hunter on closed applications.
 */

export const DEFAULT_REQUEST_EXPIRY_HOURS = 72;
export const DEFAULT_REQUEST_INTERACTED_EXPIRY_HOURS = 168;

export interface RequestExpiryPolicy {
  /** Hours a pending application waits when the poster never engaged. */
  expiryHours: number;
  /** Hours after the poster's last engagement before it closes. */
  interactedExpiryHours: number;
}

export const DEFAULT_REQUEST_EXPIRY_POLICY: RequestExpiryPolicy = {
  expiryHours: DEFAULT_REQUEST_EXPIRY_HOURS,
  interactedExpiryHours: DEFAULT_REQUEST_INTERACTED_EXPIRY_HOURS,
};

/** A positive whole number of hours, or null. */
export function parseExpiryHours(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 72 → "3 days", 24 → "1 day", 36 → "36 hours", 1 → "1 hour". */
export function formatExpiryWindow(hours: number): string {
  const h = parseExpiryHours(hours) ?? DEFAULT_REQUEST_EXPIRY_HOURS;
  if (h % 24 === 0) {
    const days = h / 24;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/**
 * The hunter's "what happens if they never answer" line for a pending
 * application. `posterInteracted` is bounty_requests.poster_interacted_at being
 * set; when it is unknown the base window is described.
 */
export function describeApplicationWindow(
  posterName: string,
  policy: RequestExpiryPolicy = DEFAULT_REQUEST_EXPIRY_POLICY,
  posterInteracted?: boolean | null
): string {
  const name = posterName.charAt(0).toUpperCase() + posterName.slice(1);
  const closes = "If they don't, your application closes automatically, and that doesn't count against you.";
  if (posterInteracted) {
    return `${name} has been in touch, so they have up to ${formatExpiryWindow(
      policy.interactedExpiryHours
    )} from then to decide. ${closes}`;
  }
  return `${name} has ${formatExpiryWindow(policy.expiryHours)} to decide. ${closes}`;
}
