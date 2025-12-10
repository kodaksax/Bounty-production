/**
 * Unit tests for Bounty Validation Utilities
 */

import { validateBalance, getInsufficientBalanceMessage, validateAmount } from '../../../lib/utils/bounty-validation';

describe('Bounty Validation Utils', () => {
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
      expect(result).toBe('Amount must be at least $1');
    });

    it('should return error for paid bounty with amount less than 1', () => {
      const result = validateAmount(0.5, false);
      expect(result).toBe('Amount must be at least $1');
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
      expect(result).toBe('Amount must be at least $1');
    });

    it('should return error for negative amounts for honor bounties', () => {
      // Negative amounts are now rejected for honor bounties as well
      const result = validateAmount(-10, true);
      expect(result).toBe('Amount must be at least $0');
    });
  });
});
