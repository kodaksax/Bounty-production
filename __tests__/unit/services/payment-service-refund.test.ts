/**
 * Unit tests for PaymentService.refundEscrow
 */

// Mock stripe-service before importing payment-service
jest.mock('../../../lib/services/stripe-service', () => ({
  stripeService: {
    refundEscrow: jest.fn(),
    releaseEscrow: jest.fn(),
    initialize: jest.fn(),
    createPaymentIntent: jest.fn(),
    confirmPayment: jest.fn(),
  },
  StripePaymentMethod: {},
}));

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

jest.mock('../../../lib/services/performance-service', () => ({
  performanceService: {
    startMeasurement: jest.fn(),
    endMeasurement: jest.fn(),
  },
}));

jest.mock('../../../lib/security/payment-security-config', () => ({
  isSCARequired: jest.fn().mockReturnValue(false),
  PAYMENT_SECURITY_CONFIG: { maxTransactionAmount: 999999, minTransactionAmount: 50 },
  validatePaymentSecurity: jest.fn().mockReturnValue({ isValid: true }),
}));

import { paymentService } from '../../../lib/services/payment-service';
import { stripeService } from '../../../lib/services/stripe-service';

describe('PaymentService.refundEscrow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return success when stripeService.refundEscrow succeeds', async () => {
    (stripeService.refundEscrow as jest.Mock).mockResolvedValue({
      paymentIntentId: 'pi_refund_123',
      refundAmount: 5000,
      status: 'refunded',
    });

    const result = await paymentService.refundEscrow('escrow-123', 'auth-token');

    expect(result).toEqual({
      success: true,
      paymentIntentId: 'pi_refund_123',
      refundAmount: 5000,
    });
    expect(stripeService.refundEscrow).toHaveBeenCalledWith('escrow-123', 'auth-token');
  });

  it('should return failure when stripeService.refundEscrow throws', async () => {
    (stripeService.refundEscrow as jest.Mock).mockRejectedValue(
      new Error('Stripe API error')
    );

    const result = await paymentService.refundEscrow('escrow-fail');

    expect(result).toEqual({
      success: false,
      error: { message: 'Stripe API error' },
    });
  });

  it('should use default error message when error has no message', async () => {
    (stripeService.refundEscrow as jest.Mock).mockRejectedValue({});

    const result = await paymentService.refundEscrow('escrow-no-msg');

    expect(result).toEqual({
      success: false,
      error: { message: 'Failed to refund escrow' },
    });
  });
});
