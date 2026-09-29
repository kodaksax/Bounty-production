/**
 * Shared validation utilities for bounty creation flow.
 * These functions are used across StepCompensation and CreateBounty flow
 * to ensure consistent validation logic.
 */

/** Minimum number of characters required for a bounty description. */
const MIN_DESCRIPTION_LENGTH = 20;

/** Minimum escrow amount in cents ($1.00) */
export const MIN_ESCROW_CENTS = 100;

/** Maximum escrow amount in cents ($10,000.00) */
export const MAX_ESCROW_CENTS = 1_000_000;

/**
 * Safely converts a dollar amount to integer cents, rounding to avoid
 * floating-point precision errors (e.g. 19.99 * 100 = 1998.9999…).
 *
 * @param dollars - Amount in dollars
 * @returns Integer amount in cents
 */
export function toCents(dollars: number): number {
  // Normalize to two decimal places before converting to cents to avoid
  // floating-point precision issues at half-cent boundaries (e.g. 1.005).
  const normalized = Number(dollars.toFixed(2));
  return Math.round(normalized * 100);
}

/**
 * Validates that an escrow amount in cents is within acceptable bounds.
 *
 * @param amountCents - The amount in cents to validate
 * @returns Error message string if invalid, null if valid
 */
export function validateEscrowAmount(amountCents: number): string | null {
  if (!Number.isFinite(amountCents) || !Number.isInteger(amountCents)) {
    return 'Escrow amount must be a whole number of cents';
  }
  if (amountCents < MIN_ESCROW_CENTS) {
    return `Escrow amount must be at least $${(MIN_ESCROW_CENTS / 100).toFixed(2)}`;
  }
  if (amountCents > MAX_ESCROW_CENTS) {
    return `Escrow amount must not exceed $${(MAX_ESCROW_CENTS / 100).toFixed(2)}`;
  }
  return null;
}

/**
 * Validates that a Stripe PaymentIntent ID has the expected format.
 *
 * @param id - The payment intent ID to validate
 * @returns true if the ID looks like a valid PaymentIntent ID
 */
export function isValidPaymentIntentId(id: string | undefined | null): boolean {
  return typeof id === 'string' && /^pi_[a-zA-Z0-9]{8,}$/.test(id);
}

/**
 * Validates a bounty title. Uses trimmed length so whitespace-padded
 * strings are rejected.
 *
 * @param value - The raw title string
 * @returns Error message string if invalid, null if valid
 */
export const TITLE_VALIDATION_MESSAGES = {
  required: 'Title is required',
  tooShort: 'Title must be at least 5 characters',
  tooLong: 'Title must not exceed 120 characters',
} as const;

export function validateTitle(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    return TITLE_VALIDATION_MESSAGES.required;
  }
  if (trimmed.length < 5) {
    return TITLE_VALIDATION_MESSAGES.tooShort;
  }
  if (trimmed.length > 120) {
    return TITLE_VALIDATION_MESSAGES.tooLong;
  }
  return null;
}

/**
 * Validates if the given amount is within the user's wallet balance.
 * Honor bounties skip balance validation as they don't require payment.
 *
 * Compares in integer cents (via toCents), not raw floats. Dollar amounts
 * built up through repeated addition (e.g. several sequential wallet
 * deposits: 0.1 + 0.1 + 0.1) can drift to values like 0.30000000000000004 in
 * IEEE-754 doubles, which would make a naive `amount <= balance` compare
 * fail even when the two are equal to the cent. Cents are exact integers, so
 * this comparison has no such boundary case.
 *
 * @param amount - The bounty amount to validate
 * @param balance - The user's current wallet balance
 * @param isForHonor - Whether this is an honor bounty (no payment)
 * @returns true if valid, false if amount exceeds balance
 */
export function validateBalance(amount: number, balance: number, isForHonor: boolean): boolean {
  if (isForHonor) return true;
  return toCents(amount) <= toCents(balance);
}

/**
 * The additional amount (in dollars) a poster's wallet needs before it covers
 * `amount` — the single source of truth for "how much do I need to add"
 * everywhere it's shown (the amount step's warning, the insufficient-balance
 * screen's breakdown, the top-up screen's pre-filled amount).
 *
 * `amount needed = max(0, bounty amount − available balance)`, computed in
 * integer cents for the same precision reason as validateBalance — never
 * returns a spurious $0.01 (or negative) remainder from float drift.
 *
 * @param amount - The bounty amount
 * @param balance - The user's current wallet balance
 * @returns Amount still needed, in dollars, never negative
 */
export function getAmountNeeded(amount: number, balance: number): number {
  return Math.max(0, toCents(amount) - toCents(balance)) / 100;
}

/**
 * Returns a user-friendly error message for insufficient balance.
 *
 * @param amount - The bounty amount
 * @param balance - The user's current wallet balance
 * @returns Formatted error message string
 */
export function getInsufficientBalanceMessage(amount: number, balance: number): string {
  return `The amount ($${amount}) exceeds your current balance ($${balance.toFixed(2)}). Please add funds to your wallet or choose a lower amount.`;
}

/**
 * Validates a bounty description. Uses trimmed length so whitespace-padded
 * strings are rejected.
 *
 * @param value - The raw description string
 * @returns Error message string if invalid, null if valid
 */
export function validateDescription(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    return 'Description is required';
  }
  if (trimmed.length < MIN_DESCRIPTION_LENGTH) {
    return `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters`;
  }
  return null;
}

/**
 * Validates if the bounty amount meets minimum requirements.
 * 
 * @param amount - The bounty amount to validate
 * @param isForHonor - Whether this is an honor bounty
 * @returns Error message string if invalid, null if valid
 */
/**
 * @param minimumAmount Minimum paid bounty, in dollars. Mirrors
 *   `public.posting_policy_config.minimum_amount`, which
 *   `trg_bounties_enforce_posting_policy` enforces at insert. Defaults to the
 *   historical $1 floor so existing callers that do not pass it keep their
 *   current behaviour; the composer passes the real policy value so a poster
 *   is told the minimum here rather than being refused at publish.
 */
export function validateAmount(
  amount: number,
  isForHonor: boolean,
  minimumAmount = 1
): string | null {
  if (isForHonor) {
    if (amount < 0) {
      return 'Amount must be at least $0';
    }
    if (amount > 0) {
      return 'Honor bounties must have a $0 amount';
    }
    return null;
  }

  if (amount === undefined || amount === null || isNaN(amount)) {
    return 'Please enter a valid amount';
  }

  const floor = Number.isFinite(minimumAmount) && minimumAmount > 0 ? minimumAmount : 1;
  if (amount < floor) {
    return `The minimum bounty amount is $${floor.toFixed(2)}`;
  }

  if (amount > 10000) {
    return 'The maximum bounty amount is $10,000.00';
  }

  return null;
}

/**
 * Off-platform contact detection for poster-written text (title, description).
 *
 * Scammers and promoters use the free-text fields of a post to move people
 * off the app — a phone number to text, an email to write to, a site to visit.
 * Each pattern below targets one of those channels:
 *
 * - PHONE: seven or more digits in a run, allowing the separators people put
 *   inside a phone number (spaces, dots, dashes, parentheses). Ordinary
 *   numbers in a task — "2 bags", "3pm", "55 inch TV", "$1,200" — stay well
 *   under seven consecutive digits and are not flagged.
 * - EMAIL: anything shaped like local@domain.tld.
 * - LINK: an explicit scheme or www. prefix, or a bare domain on a common TLD
 *   ("bit.ly/x", "mysite.com"). The TLD list is deliberately the handful that
 *   show up in promotional text, not the full registry, so a sentence that
 *   ends with "...in the U.S." or "e.g." is not treated as a link.
 */
const PHONE_PATTERN = /(?:\d[\s().-]*){7,}/;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const LINK_PATTERN =
  /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|me|ly|gg|xyz|info|biz|us|tv|link|site|online|shop|store|dev|ai|edu)\b(?:\/\S*)?/i;

/** The single error shown wherever contact info is refused, so every composer says the same thing. */
export const CONTACT_INFO_ERROR =
  "Numbers, links, or emails were detected. This bounty can't be posted with them — scammers and promoters use these fields to reach people off the app. Remove them and try again.";

/**
 * True when `value` contains a phone number, email address, or website link.
 * Exposed separately from validateContactInfo for callers that want the
 * boolean (analytics, inline hints) rather than the error string.
 */
export function containsContactInfo(value: string | undefined | null): boolean {
  const text = value ?? '';
  if (text.length === 0) return false;
  return PHONE_PATTERN.test(text) || EMAIL_PATTERN.test(text) || LINK_PATTERN.test(text);
}

/**
 * Validates poster-written text for off-platform contact details. Follows the
 * same contract as validateTitle / validateAmount: error string when the text
 * must be refused, null when it is fine. Pass every free-text field the poster
 * controls (title and description) — checking one and not the other just
 * moves the phone number.
 *
 * @param values - One or more raw strings to scan
 * @returns CONTACT_INFO_ERROR if any value contains contact info, null otherwise
 */
export function validateContactInfo(...values: (string | undefined | null)[]): string | null {
  return values.some(containsContactInfo) ? CONTACT_INFO_ERROR : null;
}
