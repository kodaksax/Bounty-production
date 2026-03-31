/**
 * Shared validation utilities for bounty creation flow.
 * These functions are used across StepCompensation and CreateBounty flow
 * to ensure consistent validation logic.
 */

/** Minimum number of characters required for a bounty description. */
const MIN_DESCRIPTION_LENGTH = 20;

/** Minimum escrow amount in cents ($1.00) */
const MIN_ESCROW_CENTS = 100;

/** Maximum escrow amount in cents ($10,000.00) */
const MAX_ESCROW_CENTS = 1_000_000;

/**
 * Safely converts a dollar amount to integer cents, rounding to avoid
 * floating-point precision errors (e.g. 19.99 * 100 = 1998.9999…).
 *
 * @param dollars - Amount in dollars
 * @returns Integer amount in cents
 */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
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
export function validateTitle(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    return 'Title is required';
  }
  if (trimmed.length < 5) {
    return 'Title must be at least 5 characters';
  }
  if (trimmed.length > 120) {
    return 'Title must not exceed 120 characters';
  }
  return null;
}

/**
 * Validates if the given amount is within the user's wallet balance.
 * Honor bounties skip balance validation as they don't require payment.
 * 
 * @param amount - The bounty amount to validate
 * @param balance - The user's current wallet balance
 * @param isForHonor - Whether this is an honor bounty (no payment)
 * @returns true if valid, false if amount exceeds balance
 */
export function validateBalance(amount: number, balance: number, isForHonor: boolean): boolean {
  if (isForHonor) return true;
  // Use a small epsilon for float comparison if needed, but balance is likely numbers
  return amount <= balance;
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
export function validateAmount(amount: number, isForHonor: boolean): string | null {
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

  if (amount < 1) {
    return 'The minimum bounty amount is $1.00';
  }

  if (amount > 10000) {
    return 'The maximum bounty amount is $10,000.00';
  }

  return null;
}
