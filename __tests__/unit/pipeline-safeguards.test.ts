/**
 * Unit tests for pipeline safeguards added across the bounty pipeline
 * Tests validation, idempotency guards, and error recovery at each stage
 */

import {
  toCents,
  validateEscrowAmount,
  isValidPaymentIntentId,
} from '../../lib/utils/bounty-validation';

// ─── bounty-validation.ts helpers ───────────────────────────────────

describe('toCents', () => {
  it('should convert whole dollars to cents', () => {
    expect(toCents(1)).toBe(100);
    expect(toCents(25)).toBe(2500);
    expect(toCents(0)).toBe(0);
  });

  it('should handle fractional dollars', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0.50)).toBe(50);
    expect(toCents(99.01)).toBe(9901);
  });

  it('should round correctly to avoid float precision issues', () => {
    // 19.99 * 100 = 1998.9999... without rounding
    expect(toCents(19.99)).toBe(1999);
    // 1.005 * 100 = 100.4999... due to IEEE754, Math.round gives 100
    expect(toCents(1.005)).toBe(100);
    expect(toCents(0.1 + 0.2)).toBe(30); // classic float precision test
  });

  it('should handle negative amounts', () => {
    expect(toCents(-5)).toBe(-500);
  });
});

describe('validateEscrowAmount', () => {
  it('should accept valid escrow amounts', () => {
    expect(validateEscrowAmount(100)).toBeNull();       // $1.00
    expect(validateEscrowAmount(500)).toBeNull();       // $5.00
    expect(validateEscrowAmount(1_000_000)).toBeNull(); // $10,000.00 max
  });

  it('should reject amount below minimum ($1.00)', () => {
    expect(validateEscrowAmount(50)).toMatch(/at least/);
    expect(validateEscrowAmount(99)).toMatch(/at least/);
    expect(validateEscrowAmount(0)).toMatch(/at least/);
  });

  it('should reject amount above maximum ($10,000)', () => {
    expect(validateEscrowAmount(1_000_001)).toMatch(/must not exceed/);
    expect(validateEscrowAmount(5_000_000)).toMatch(/must not exceed/);
  });

  it('should reject non-integer cents', () => {
    expect(validateEscrowAmount(100.5)).toMatch(/whole number/);
    expect(validateEscrowAmount(NaN)).toMatch(/whole number/);
    expect(validateEscrowAmount(Infinity)).toMatch(/whole number/);
  });
});

describe('isValidPaymentIntentId', () => {
  it('should accept valid Stripe PaymentIntent IDs', () => {
    expect(isValidPaymentIntentId('pi_1234567890abcdef')).toBe(true);
    expect(isValidPaymentIntentId('pi_ABCDEFGH')).toBe(true);
    expect(isValidPaymentIntentId('pi_3MtwBwLkdIwHu7ix28a3tqPa')).toBe(true);
  });

  it('should reject invalid IDs', () => {
    expect(isValidPaymentIntentId('')).toBe(false);
    expect(isValidPaymentIntentId('escrow-123')).toBe(false);
    expect(isValidPaymentIntentId('pi_')).toBe(false); // too short after prefix
    expect(isValidPaymentIntentId('pi_12')).toBe(false); // too short
    expect(isValidPaymentIntentId('ch_1234567890')).toBe(false); // wrong prefix
  });

  it('should reject null and undefined', () => {
    expect(isValidPaymentIntentId(null)).toBe(false);
    expect(isValidPaymentIntentId(undefined)).toBe(false);
  });
});

// ─── PaymentService client-side validation ──────────────────────────

jest.mock('../../lib/services/stripe-service', () => ({
  stripeService: {
    createEscrow: jest.fn(),
    releaseEscrow: jest.fn(),
    refundEscrow: jest.fn(),
    initialize: jest.fn(),
    createPaymentIntent: jest.fn(),
    confirmPayment: jest.fn(),
    handleNextAction: jest.fn(),
    confirmPaymentSecure: jest.fn(),
    createPaymentIntentSecure: jest.fn(),
  },
  StripePaymentMethod: {},
}));

jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

jest.mock('../../lib/services/performance-service', () => ({
  performanceService: {
    startMeasurement: jest.fn(),
    endMeasurement: jest.fn(),
  },
}));

jest.mock('../../lib/security/payment-security-config', () => ({
  isSCARequired: jest.fn().mockReturnValue(false),
  PAYMENT_SECURITY_CONFIG: { maxTransactionAmount: 999999, minTransactionAmount: 50 },
  validatePaymentSecurity: jest.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
}));

import { paymentService } from '../../lib/services/payment-service';

describe('PaymentService.createEscrow validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reject when bountyId is missing', async () => {
    const result = await paymentService.createEscrow({
      bountyId: '',
      amount: 25,
      posterId: 'poster1',
      hunterId: 'hunter1',
      userId: 'poster1',
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('validation_error');
    expect(result.error?.message).toMatch(/Missing required/);
  });

  it('should reject when poster equals hunter', async () => {
    const result = await paymentService.createEscrow({
      bountyId: 'b1',
      amount: 25,
      posterId: 'user1',
      hunterId: 'user1',
      userId: 'user1',
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('validation_error');
    expect(result.error?.message).toMatch(/different users/);
  });

  it('should reject amount below $1', async () => {
    const result = await paymentService.createEscrow({
      bountyId: 'b1',
      amount: 0.50,
      posterId: 'poster1',
      hunterId: 'hunter1',
      userId: 'poster1',
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('validation_error');
    expect(result.error?.message).toMatch(/at least \$1/);
  });

  it('should reject amount above $10,000', async () => {
    const result = await paymentService.createEscrow({
      bountyId: 'b1',
      amount: 15000,
      posterId: 'poster1',
      hunterId: 'hunter1',
      userId: 'poster1',
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('validation_error');
    expect(result.error?.message).toMatch(/must not exceed/);
  });
});

describe('PaymentService.releaseEscrow validation', () => {
  it('should reject empty escrowId', async () => {
    const result = await paymentService.releaseEscrow('');

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/required/i);
  });
});

describe('PaymentService.refundEscrow validation', () => {
  it('should reject empty escrowId', async () => {
    const result = await paymentService.refundEscrow('');

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/required/i);
  });
});
