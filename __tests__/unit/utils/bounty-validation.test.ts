/**
 * Unit tests for Bounty Validation Utilities
 */

import { validateBalance, getAmountNeeded, getInsufficientBalanceMessage, validateAmount, validateTitle } from '../../../lib/utils/bounty-validation';

describe('Bounty Validation Utils', () => {
  describe('validateTitle', () => {
    it('should reject empty string', () => {
      expect(validateTitle('')).toBe('Title is required');
    });

    it('should reject null and undefined', () => {
      expect(validateTitle(null)).toBe('Title is required');
      expect(validateTitle(undefined)).toBe('Title is required');
    });

    it('should reject whitespace-only string', () => {
      expect(validateTitle('   ')).toBe('Title is required');
    });

    it('should reject title shorter than 5 trimmed characters', () => {
      expect(validateTitle('abcd')).toBe('Title must be at least 5 characters');
    });

    it('should reject whitespace-padded title with fewer than 5 real characters', () => {
      // "  ab " is 5 raw chars but only 2 trimmed
      expect(validateTitle('  ab ')).toBe('Title must be at least 5 characters');
    });

    it('should accept valid title', () => {
      expect(validateTitle('Help me move furniture')).toBeNull();
    });

    it('should accept title with exactly 5 trimmed characters', () => {
      expect(validateTitle('abcde')).toBeNull();
    });

    it('should reject title exceeding 120 trimmed characters', () => {
      const longTitle = 'a'.repeat(121);
      expect(validateTitle(longTitle)).toBe('Title must not exceed 120 characters');
    });

    it('should accept title with exactly 120 trimmed characters', () => {
      const title = 'a'.repeat(120);
      expect(validateTitle(title)).toBeNull();
    });
  });

  describe('validateBalance', () => {
    it('should return true when amount is within balance', () => {
      const result = validateBalance(50, 100, false);
      expect(result).toBe(true);
    });

    it('should return true when amount equals balance', () => {
      const result = validateBalance(100, 100, false);
      expect(result).toBe(true);
    });

    it('should return false when amount exceeds balance', () => {
      const result = validateBalance(150, 100, false);
      expect(result).toBe(false);
    });

    it('should always return true for honor bounties regardless of balance', () => {
      const result = validateBalance(1000, 10, true);
      expect(result).toBe(true);
    });

    it('should handle zero balance for paid bounties', () => {
      const result = validateBalance(50, 0, false);
      expect(result).toBe(false);
    });

    it('should handle zero balance for honor bounties', () => {
      const result = validateBalance(0, 0, true);
      expect(result).toBe(true);
    });

    // Regression coverage: a bounty funded via several sequential deposits
    // (e.g. two $5 top-ups for a $10 bounty) can accumulate float drift —
    // 5 + 5 is exact, but 0.1 + 0.1 + 0.1 is not (0.30000000000000004 in
    // IEEE-754). A naive `amount <= balance` compare would wrongly reject an
    // exactly-funded bounty in cases like this.
    it('recognizes balance built from float-imprecise sequential deposits as sufficient', () => {
      const balanceAfterThreeDeposits = 0.1 + 0.1 + 0.1; // 0.30000000000000004, not 0.3
      expect(validateBalance(0.3, balanceAfterThreeDeposits, false)).toBe(true);
    });

    it('recognizes the exact $5 + $5 = $10 case as fully funded', () => {
      const balanceAfterTwoDeposits = 0 + 5 + 5;
      expect(validateBalance(10, balanceAfterTwoDeposits, false)).toBe(true);
    });

    it('treats an overfunded balance as sufficient', () => {
      expect(validateBalance(10, 15, false)).toBe(true);
    });
  });

  describe('getAmountNeeded', () => {
    it('returns the full amount when balance is zero', () => {
      expect(getAmountNeeded(10, 0)).toBe(10);
    });

    it('returns the remaining shortfall for a partial balance', () => {
      expect(getAmountNeeded(10, 5)).toBe(5);
    });

    it('returns exactly 0 once balance equals the amount', () => {
      expect(getAmountNeeded(10, 10)).toBe(0);
    });

    it('returns exactly 0 (never negative) once balance exceeds the amount', () => {
      expect(getAmountNeeded(10, 15)).toBe(0);
    });

    it('returns exactly 0 for balance built from float-imprecise sequential deposits', () => {
      // Mirrors the $5 + $5 = $10 repro: after two additions, naive float
      // subtraction can leave a residue like 0.000000000000007105 instead of 0.
      const balanceAfterTwoDeposits = 0 + 5 + 5;
      expect(getAmountNeeded(10, balanceAfterTwoDeposits)).toBe(0);
    });

    it('never returns a spurious sub-cent remainder for classic float-drift inputs', () => {
      const balanceAfterThreeDeposits = 0.1 + 0.1 + 0.1; // 0.30000000000000004
      expect(getAmountNeeded(0.3, balanceAfterThreeDeposits)).toBe(0);
    });
  });

  describe('getInsufficientBalanceMessage', () => {
    it('should format error message with amount and balance', () => {
      const result = getInsufficientBalanceMessage(150, 100);
      expect(result).toContain('$150');
      expect(result).toContain('$100.00');
      expect(result).toContain('exceeds your current balance');
    });

    it('should format balance with two decimal places', () => {
      const result = getInsufficientBalanceMessage(100, 75.5);
      expect(result).toContain('$75.50');
    });

    it('should suggest adding funds', () => {
      const result = getInsufficientBalanceMessage(200, 50);
      expect(result).toContain('add funds to your wallet');
    });

    it('should suggest choosing a lower amount', () => {
      const result = getInsufficientBalanceMessage(200, 50);
      expect(result).toContain('choose a lower amount');
    });
  });

  describe('validateAmount', () => {
    it('should return null for valid paid bounty amount', () => {
      const result = validateAmount(50, false);
      expect(result).toBeNull();
    });

    it('should return null for honor bounties with any amount', () => {
      const result = validateAmount(0, true);
      expect(result).toBeNull();
    });

    it('should return error for paid bounty with zero amount', () => {
      const result = validateAmount(0, false);
      expect(result).toBe('The minimum bounty amount is $1.00');
    });

    it('should return error for paid bounty with amount less than 1', () => {
      const result = validateAmount(0.5, false);
      expect(result).toBe('The minimum bounty amount is $1.00');
    });

    it('should accept amount of exactly 1 dollar', () => {
      const result = validateAmount(1, false);
      expect(result).toBeNull();
    });

    it('should accept large amounts', () => {
      const result = validateAmount(10000, false);
      expect(result).toBeNull();
    });

    it('should handle negative amounts for paid bounties', () => {
      const result = validateAmount(-10, false);
      expect(result).toBe('The minimum bounty amount is $1.00');
    });

    it('should return error for negative amounts for honor bounties', () => {
      // Negative amounts are now rejected for honor bounties as well
      const result = validateAmount(-10, true);
      expect(result).toBe('Amount must be at least $0');
    });
  });

  describe('validateAmount minimumAmount parameter', () => {
    // The composer passes the live value of
    // `public.posting_policy_config.minimum_amount` so a poster is told the
    // floor here instead of being refused by
    // `trg_bounties_enforce_posting_policy` at publish. These cases pin the
    // coercion rules that keep the client's message matching the server's gate.

    it('should enforce a custom minimum above the default', () => {
      expect(validateAmount(4.99, false, 5)).toBe('The minimum bounty amount is $5.00');
      expect(validateAmount(5, false, 5)).toBeNull();
      expect(validateAmount(5.01, false, 5)).toBeNull();
    });

    it('should still reject amounts below the default when a lower minimum is passed', () => {
      // A configured minimum below $1 is honoured — the floor is policy, not a
      // hardcoded constant.
      expect(validateAmount(0.5, false, 0.25)).toBeNull();
      expect(validateAmount(0.2, false, 0.25)).toBe('The minimum bounty amount is $0.25');
    });

    it('should format a decimal minimum to two decimal places', () => {
      expect(validateAmount(2, false, 2.5)).toBe('The minimum bounty amount is $2.50');
      expect(validateAmount(2.5, false, 2.5)).toBeNull();
    });

    it('should round a minimum with more than two decimals in the message only', () => {
      // 2.555 formats as $2.56 but the comparison uses the exact value, so an
      // amount between the two still fails with the rounded message.
      expect(validateAmount(2.554, false, 2.555)).toBe('The minimum bounty amount is $2.56');
      expect(validateAmount(2.555, false, 2.555)).toBeNull();
    });

    it('should fall back to $1 for a NaN minimum', () => {
      expect(validateAmount(0.5, false, NaN)).toBe('The minimum bounty amount is $1.00');
      expect(validateAmount(1, false, NaN)).toBeNull();
    });

    it('should fall back to $1 for a non-finite minimum', () => {
      expect(validateAmount(0.5, false, Infinity)).toBe('The minimum bounty amount is $1.00');
      expect(validateAmount(1, false, -Infinity)).toBeNull();
    });

    it('should fall back to $1 for a zero minimum', () => {
      // A $0 minimum would re-open the free-post hole this gate exists to
      // close, so it is treated as unset rather than honoured.
      expect(validateAmount(0, false, 0)).toBe('The minimum bounty amount is $1.00');
      expect(validateAmount(0.99, false, 0)).toBe('The minimum bounty amount is $1.00');
    });

    it('should fall back to $1 for a negative minimum', () => {
      expect(validateAmount(0.5, false, -5)).toBe('The minimum bounty amount is $1.00');
      expect(validateAmount(1, false, -5)).toBeNull();
    });

    it('should still enforce the $10,000 maximum regardless of the minimum', () => {
      expect(validateAmount(10001, false, 5)).toBe('The maximum bounty amount is $10,000.00');
      expect(validateAmount(10000, false, 5)).toBeNull();
    });

    it('should still reject a non-numeric amount before applying the minimum', () => {
      expect(validateAmount(NaN, false, 5)).toBe('Please enter a valid amount');
    });

    it('should ignore the minimum for honor bounties, which must be exactly $0', () => {
      // The minimum is a PAID-bounty floor. An honor bounty is $0 by
      // definition, and a configured minimum must never make $0 "valid" for a
      // paid post nor make an honor post require money.
      expect(validateAmount(0, true, 5)).toBeNull();
      expect(validateAmount(5, true, 5)).toBe('Honor bounties must have a $0 amount');
      expect(validateAmount(0.01, true, 5)).toBe('Honor bounties must have a $0 amount');
      expect(validateAmount(-0.01, true, 5)).toBe('Amount must be at least $0');
    });
  });
});
