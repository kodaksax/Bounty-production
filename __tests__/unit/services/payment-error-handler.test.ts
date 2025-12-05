/**
 * Unit tests for Payment Error Handler
 */

import {
  parsePaymentError,
  generateIdempotencyKey,
  checkDuplicatePayment,
  recordPaymentAttempt,
  completePaymentAttempt,
  getRecoveryInstructions,
  getPaymentErrorResponse,
  withPaymentRetry,
} from '../../../lib/services/payment-error-handler';

// Mock analytics service
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: jest.fn(),
  },
}));

describe('Payment Error Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parsePaymentError', () => {
    it('should categorize card_declined errors correctly', () => {
      const error = {
        type: 'card_error',
        code: 'card_declined',
        message: 'Your card was declined',
      };

      const result = parsePaymentError(error);

      expect(result.category).toBe('card_declined');
      expect(result.retryable).toBe(false);
      expect(result.recoveryAction).toBe('try_different_card');
    });

    it('should categorize insufficient_funds errors', () => {
      const error = {
        type: 'card_error',
        code: 'insufficient_funds',
        message: 'Insufficient funds',
      };

      const result = parsePaymentError(error);

      expect(result.category).toBe('card_declined');
      expect(result.code).toBe('insufficient_funds');
    });

    it('should categorize authentication_required errors', () => {
      const error = {
        type: 'card_error',
        code: 'authentication_required',
        message: 'Authentication required',
      };

      const result = parsePaymentError(error);

      expect(result.category).toBe('authentication_required');
      expect(result.recoveryAction).toBe('verify_identity');
    });

    it('should categorize rate_limit_error correctly', () => {
      const error = {
        type: 'rate_limit_error',
        message: 'Too many requests',
      };

      const result = parsePaymentError(error);

      expect(result.category).toBe('rate_limit');
      expect(result.retryable).toBe(true);
      expect(result.retryDelayMs).toBe(60000);
    });

    it('should categorize validation errors', () => {
      const error = {
        code: 'incorrect_number',
        message: 'Invalid card number',
      };

      const result = parsePaymentError(error);

      expect(result.category).toBe('validation');
      expect(result.recoveryAction).toBe('update_card');
    });

    it('should categorize network errors', () => {
      const error = {
        message: 'Network request failed',
      };

      const result = parsePaymentError(error);

      expect(result.category).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('should categorize fraud errors', () => {
      const error = {
        code: 'fraudulent',
        message: 'Fraud detected',
      };

      const result = parsePaymentError(error);

      expect(result.category).toBe('fraud');
      expect(result.recoveryAction).toBe('contact_support');
    });

    it('should categorize duplicate transaction errors', () => {
      const error = {
        type: 'idempotency_error',
        code: 'duplicate_transaction',
        message: 'Duplicate transaction',
      };

      const result = parsePaymentError(error);

      expect(result.category).toBe('duplicate');
      expect(result.recoveryAction).toBe('none');
    });

    it('should handle unknown errors', () => {
      const error = {
        message: 'Something unknown happened',
      };

      const result = parsePaymentError(error);

      expect(result.category).toBe('unknown');
      // Unknown errors may not be retryable by default
      expect(typeof result.retryable).toBe('boolean');
    });
  });

  describe('idempotency key management', () => {
    it('should generate unique idempotency keys', () => {
      const key1 = generateIdempotencyKey('user1', 100, 'deposit');
      const key2 = generateIdempotencyKey('user1', 100, 'deposit');

      expect(key1).not.toBe(key2);
      expect(key1).toContain('bountyexpo_pay_');
      expect(key1).toContain('user1');
    });

    it('should detect duplicate payments', () => {
      const key = generateIdempotencyKey('user1', 100, 'deposit');

      // First check should not be duplicate
      expect(checkDuplicatePayment(key)).toBe(false);

      // Record the payment attempt
      recordPaymentAttempt(key);

      // Second check should be duplicate
      expect(checkDuplicatePayment(key)).toBe(true);

      // Complete the payment
      completePaymentAttempt(key);

      // Third check should not be duplicate
      expect(checkDuplicatePayment(key)).toBe(false);
    });
  });

  describe('getRecoveryInstructions', () => {
    it('should return retry instructions', () => {
      const error = parsePaymentError({ type: 'api_error', message: 'Server error' });
      const instructions = getRecoveryInstructions(error);

      expect(instructions).toContain('wait');
    });

    it('should return update card instructions', () => {
      const error = parsePaymentError({ code: 'incorrect_cvc', message: 'Invalid CVC' });
      const instructions = getRecoveryInstructions(error);

      expect(instructions).toContain('card details');
    });

    it('should return verify identity instructions', () => {
      const error = parsePaymentError({ code: 'authentication_required', message: 'Auth required' });
      const instructions = getRecoveryInstructions(error);

      expect(instructions).toContain('verification');
    });
  });

  describe('getPaymentErrorResponse', () => {
    it('should return complete error response for UI', () => {
      const rawError = {
        type: 'card_error',
        code: 'card_declined',
        message: 'Card declined',
      };

      const response = getPaymentErrorResponse(rawError);

      expect(response.error).toBeDefined();
      expect(response.recoveryInstructions).toBeDefined();
      expect(response.showRetryButton).toBe(false);
      expect(response.showUpdateCardButton).toBe(true);
    });

    it('should show retry button for retryable errors', () => {
      const rawError = {
        type: 'api_error',
        message: 'Server error',
      };

      const response = getPaymentErrorResponse(rawError);

      expect(response.showRetryButton).toBe(true);
    });

    it('should show contact support for fraud errors', () => {
      const rawError = {
        code: 'fraudulent',
        message: 'Fraud detected',
      };

      const response = getPaymentErrorResponse(rawError);

      expect(response.showContactSupportButton).toBe(true);
    });
  });

  describe('withPaymentRetry', () => {
    it('should succeed on first try', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const result = await withPaymentRetry(operation, { maxRetries: 3 });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient errors', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce({ type: 'api_error', message: 'Server error' })
        .mockResolvedValueOnce('success');

      const result = await withPaymentRetry(operation, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 20 });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    }, 15000);

    it('should not retry on non-retryable errors', async () => {
      const cardError = { type: 'card_error', code: 'card_declined', message: 'Declined' };
      const operation = jest.fn().mockRejectedValue(cardError);

      await expect(withPaymentRetry(operation, { maxRetries: 3 })).rejects.toEqual(cardError);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries', async () => {
      const serverError = { type: 'api_error', message: 'Server error' };
      const operation = jest.fn().mockRejectedValue(serverError);

      await expect(
        withPaymentRetry(operation, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 20 })
      ).rejects.toEqual(serverError);
      expect(operation).toHaveBeenCalledTimes(2);
    }, 15000);
  });
});
