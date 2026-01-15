/**
 * Shared validation utilities for bounty creation flow.
 * These functions are used across StepCompensation and CreateBounty flow
 * to ensure consistent validation logic.
 */

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
