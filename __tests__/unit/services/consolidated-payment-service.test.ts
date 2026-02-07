/**
 * Unit tests for Consolidated Payment Service
 * Tests Stripe PaymentIntent operations, payment methods, and customer management
 */

// Mock config first
jest.mock('../../../services/api/src/config', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_mock_key',
    },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-service-role-key',
    },
  },
}));

// Mock Supabase
const mockSupabaseClient = {
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({
          data: { id: 'user123', stripe_customer_id: 'cus_test123', email: 'test@example.com' },
          error: null,
        })),
        maybeSingle: jest.fn(() => Promise.resolve({
          data: { id: 'user123', stripe_customer_id: 'cus_test123' },
          error: null,
        })),
      })),
    })),
    update: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    })),
    insert: jest.fn(() => Promise.resolve({ error: null })),
  })),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

// Mock error handler
jest.mock('../../../services/api/src/middleware/error-handler', () => ({
  ExternalServiceError: class ExternalServiceError extends Error {
    constructor(message: string, public statusCode = 502) {
      super(message);
      this.name = 'ExternalServiceError';
    }
  },
  ValidationError: class ValidationError extends Error {
    constructor(message: string, public statusCode = 400) {
      super(message);
      this.name = 'ValidationError';
    }
  },
  handleStripeError: jest.fn((error: any) => {
    if (error.type === 'StripeCardError') {
      return new Error(`Card error: ${error.message}`);
    }
    return new Error(`Stripe error: ${error.message}`);
  }),
}));

// Mock Stripe - must be set up before service import
// Define mock data outside factory so it's accessible in tests
const mockStripePaymentIntent = {
  id: 'pi_test123',
  client_secret: 'pi_test123_secret_abc',
  amount: 5000,
  currency: 'usd',
  status: 'requires_payment_method',
  metadata: {},
};

const mockStripeCustomer = {
  id: 'cus_test123',
  email: 'test@example.com',
  metadata: {},
};

const mockStripePaymentMethod = {
  id: 'pm_test123',
  type: 'card',
  card: {
    brand: 'visa',
    last4: '4242',
    exp_month: 12,
    exp_year: 2025,
  },
};

const mockStripe = {
  customers: {
    create: jest.fn(async () => mockStripeCustomer),
    retrieve: jest.fn(async () => mockStripeCustomer),
  },
  paymentIntents: {
    create: jest.fn(async () => mockStripePaymentIntent),
    confirm: jest.fn(async () => ({ ...mockStripePaymentIntent, status: 'succeeded' })),
    retrieve: jest.fn(async () => mockStripePaymentIntent),
    cancel: jest.fn(async () => ({ ...mockStripePaymentIntent, status: 'canceled' })),
  },
  paymentMethods: {
    list: jest.fn(async () => ({ data: [mockStripePaymentMethod] })),
    attach: jest.fn(async () => mockStripePaymentMethod),
    detach: jest.fn(async () => mockStripePaymentMethod),
  },
  setupIntents: {
    create: jest.fn(async () => ({
      id: 'seti_test123',
      client_secret: 'seti_test123_secret_abc',
    })),
  },
};

jest.mock('stripe', () => {
  // Return a constructor function that returns the mock Stripe instance
  // Reference the mockStripe defined above (available due to hoisting)
  return jest.fn().mockImplementation(() => mockStripe);
});

// Import service after mocks are set up
import * as paymentService from '../../../services/api/src/services/consolidated-payment-service';

describe('Consolidated Payment Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createPaymentIntent', () => {
    it('should create a payment intent with valid parameters', async () => {
      const options = {
        userId: 'user123',
        amountCents: 5000,
        currency: 'usd',
        description: 'Test payment',
        metadata: { bountyId: 'bounty123' },
      };

      const result = await paymentService.createPaymentIntent(options);

      expect(result).toEqual({
        clientSecret: 'pi_test123_secret_abc',
        paymentIntentId: 'pi_test123',
        amount: 5000,
        currency: 'usd',
      });

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5000,
          currency: 'usd',
          customer: 'cus_test123',
          description: 'Test payment',
          metadata: expect.objectContaining({
            bountyId: 'bounty123',
            user_id: 'user123',
          }),
        }),
        {}
      );
    });

    it('should use idempotency key when provided', async () => {
      const options = {
        userId: 'user123',
        amountCents: 5000,
        idempotencyKey: 'test-idempotency-key',
      };

      await paymentService.createPaymentIntent(options);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.any(Object),
        { idempotencyKey: 'test-idempotency-key' }
      );
    });

    it('should validate minimum amount', async () => {
      const options = {
        userId: 'user123',
        amountCents: 10, // Too small
      };

      await expect(paymentService.createPaymentIntent(options)).rejects.toThrow();
    });

    it('should create customer if not exists', async () => {
      // Mock user without Stripe customer
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'user123', stripe_customer_id: null, email: 'test@example.com' },
              error: null,
            })),
          })),
        })),
        update: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null })),
        })),
      }));

      const options = {
        userId: 'user123',
        amountCents: 5000,
      };

      await paymentService.createPaymentIntent(options);

      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        metadata: { userId: 'user123' },
      });
    });

    it('should handle Stripe errors gracefully', async () => {
      mockStripe.paymentIntents.create.mockRejectedValueOnce(
        new Error('Stripe API error')
      );

      const options = {
        userId: 'user123',
        amountCents: 5000,
      };

      await expect(paymentService.createPaymentIntent(options)).rejects.toThrow();
    });

    it('should use default currency when not specified', async () => {
      const options = {
        userId: 'user123',
        amountCents: 5000,
      };

      await paymentService.createPaymentIntent(options);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'usd',
        }),
        expect.any(Object)
      );
    });

    it('should use default payment method types when not specified', async () => {
      const options = {
        userId: 'user123',
        amountCents: 5000,
      };

      await paymentService.createPaymentIntent(options);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method_types: ['card'],
        }),
        expect.any(Object)
      );
    });
  });

  describe('confirmPaymentIntent', () => {
    it('should confirm a payment intent successfully', async () => {
      const result = await paymentService.confirmPaymentIntent(
        'pi_test123',
        'user123',
        'pm_test123'
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('succeeded');
      expect(mockStripe.paymentIntents.confirm).toHaveBeenCalledWith(
        'pi_test123',
        { payment_method: 'pm_test123' },
        {}
      );
    });

    it('should handle 3D Secure requirements', async () => {
      mockStripe.paymentIntents.confirm.mockResolvedValueOnce({
        ...mockStripePaymentIntent,
        status: 'requires_action',
        next_action: {
          type: 'use_stripe_sdk',
        },
      } as any);

      const result = await paymentService.confirmPaymentIntent(
        'pi_test123',
        'user123',
        'pm_test123'
      );

      expect(result.requiresAction).toBe(true);
    });

    it('should handle card declined error', async () => {
      mockStripe.paymentIntents.confirm.mockRejectedValueOnce({
        type: 'StripeCardError',
        code: 'card_declined',
        message: 'Your card was declined',
      });

      await expect(
        paymentService.confirmPaymentIntent('pi_test123', 'user123', 'pm_test123')
      ).rejects.toThrow();
    });

    it('should use idempotency key when provided', async () => {
      await paymentService.confirmPaymentIntent(
        'pi_test123',
        'user123',
        'pm_test123',
        'confirm-idempotency-key'
      );

      expect(mockStripe.paymentIntents.confirm).toHaveBeenCalledWith(
        'pi_test123',
        { payment_method: 'pm_test123' },
        { idempotencyKey: 'confirm-idempotency-key' }
      );
    });

    it('should confirm without payment method if already attached', async () => {
      await paymentService.confirmPaymentIntent(
        'pi_test123',
        'user123'
      );

      expect(mockStripe.paymentIntents.confirm).toHaveBeenCalledWith(
        'pi_test123',
        {},
        {}
      );
    });
  });

  describe('cancelPaymentIntent', () => {
    it('should cancel a payment intent successfully', async () => {
      await paymentService.cancelPaymentIntent('pi_test123', 'user123');

      expect(mockStripe.paymentIntents.cancel).toHaveBeenCalledWith(
        'pi_test123',
        {},
        {}
      );
    });

    it('should include cancellation reason when provided', async () => {
      await paymentService.cancelPaymentIntent(
        'pi_test123',
        'user123',
        'User cancelled'
      );

      expect(mockStripe.paymentIntents.cancel).toHaveBeenCalledWith(
        'pi_test123',
        { cancellation_reason: 'User cancelled' },
        {}
      );
    });

    it('should use idempotency key when provided', async () => {
      await paymentService.cancelPaymentIntent(
        'pi_test123',
        'user123',
        undefined,
        'cancel-idempotency-key'
      );

      expect(mockStripe.paymentIntents.cancel).toHaveBeenCalledWith(
        'pi_test123',
        {},
        { idempotencyKey: 'cancel-idempotency-key' }
      );
    });

    it('should handle already cancelled payment intent', async () => {
      mockStripe.paymentIntents.cancel.mockRejectedValueOnce({
        code: 'payment_intent_unexpected_state',
        message: 'Payment intent already canceled',
      });

      await expect(
        paymentService.cancelPaymentIntent('pi_test123', 'user123')
      ).rejects.toThrow();
    });
  });

  describe('getPaymentIntentStatus', () => {
    it('should retrieve payment intent status', async () => {
      const result = await paymentService.getPaymentIntentStatus('pi_test123', 'user123');

      expect(result.id).toBe('pi_test123');
      expect(result.status).toBe('requires_payment_method');
      expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_test123');
    });

    it('should handle non-existent payment intent', async () => {
      mockStripe.paymentIntents.retrieve.mockRejectedValueOnce({
        type: 'invalid_request_error',
        message: 'No such payment intent',
      });

      await expect(
        paymentService.getPaymentIntentStatus('pi_invalid', 'user123')
      ).rejects.toThrow();
    });
  });

  describe('createSetupIntent', () => {
    it('should create a setup intent for saving payment method', async () => {
      const result = await paymentService.createSetupIntent('user123');

      expect(result.clientSecret).toBe('seti_test123_secret_abc');
      expect(result.setupIntentId).toBe('seti_test123');
      expect(mockStripe.setupIntents.create).toHaveBeenCalledWith(
        {
          customer: 'cus_test123',
          payment_method_types: ['card'],
        },
        {}
      );
    });

    it('should use idempotency key when provided', async () => {
      await paymentService.createSetupIntent('user123', 'setup-idempotency-key');

      expect(mockStripe.setupIntents.create).toHaveBeenCalledWith(
        expect.any(Object),
        { idempotencyKey: 'setup-idempotency-key' }
      );
    });
  });

  describe('listPaymentMethods', () => {
    it('should list payment methods for a customer', async () => {
      const result = await paymentService.listPaymentMethods('user123');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'pm_test123',
        type: 'card',
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2025,
        },
      });

      expect(mockStripe.paymentMethods.list).toHaveBeenCalledWith({
        customer: 'cus_test123',
        type: 'card',
      });
    });

    it('should return empty array when no payment methods exist', async () => {
      mockStripe.paymentMethods.list.mockResolvedValueOnce({ data: [] });

      const result = await paymentService.listPaymentMethods('user123');

      expect(result).toEqual([]);
    });

    it('should handle customer without Stripe ID', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: { id: 'user123', stripe_customer_id: null },
              error: null,
            })),
          })),
        })),
      }));

      await expect(paymentService.listPaymentMethods('user123')).rejects.toThrow();
    });
  });

  describe('attachPaymentMethod', () => {
    it('should attach payment method to customer', async () => {
      const result = await paymentService.attachPaymentMethod('user123', 'pm_test123');

      expect(result.id).toBe('pm_test123');
      expect(mockStripe.paymentMethods.attach).toHaveBeenCalledWith('pm_test123', {
        customer: 'cus_test123',
      });
    });

    it('should handle already attached payment method', async () => {
      mockStripe.paymentMethods.attach.mockRejectedValueOnce({
        code: 'resource_already_exists',
        message: 'The PaymentMethod is already attached to a Customer',
      });

      await expect(
        paymentService.attachPaymentMethod('user123', 'pm_test123')
      ).rejects.toThrow();
    });
  });

  describe('detachPaymentMethod', () => {
    it('should detach payment method from customer', async () => {
      await paymentService.detachPaymentMethod('user123', 'pm_test123');

      expect(mockStripe.paymentMethods.detach).toHaveBeenCalledWith('pm_test123');
    });

    it('should handle non-existent payment method', async () => {
      mockStripe.paymentMethods.detach.mockRejectedValueOnce({
        type: 'invalid_request_error',
        message: 'No such payment method',
      });

      await expect(
        paymentService.detachPaymentMethod('user123', 'pm_invalid')
      ).rejects.toThrow();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle database errors when fetching user', async () => {
      mockSupabaseClient.from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({
              data: null,
              error: { message: 'Database error' },
            })),
          })),
        })),
      }));

      await expect(
        paymentService.createPaymentIntent({
          userId: 'user123',
          amountCents: 5000,
        })
      ).rejects.toThrow();
    });

    it('should handle network timeout errors', async () => {
      mockStripe.paymentIntents.create.mockRejectedValueOnce(
        new Error('ETIMEDOUT')
      );

      await expect(
        paymentService.createPaymentIntent({
          userId: 'user123',
          amountCents: 5000,
        })
      ).rejects.toThrow();
    });

    it('should handle insufficient funds error', async () => {
      mockStripe.paymentIntents.confirm.mockRejectedValueOnce({
        type: 'StripeCardError',
        code: 'insufficient_funds',
        message: 'Insufficient funds',
      });

      await expect(
        paymentService.confirmPaymentIntent('pi_test123', 'user123', 'pm_test123')
      ).rejects.toThrow();
    });

    it('should handle invalid amount errors', async () => {
      const options = {
        userId: 'user123',
        amountCents: -100, // Negative amount
      };

      await expect(paymentService.createPaymentIntent(options)).rejects.toThrow();
    });

    it('should handle authentication failures', async () => {
      mockStripe.paymentIntents.create.mockRejectedValueOnce({
        type: 'authentication_error',
        message: 'Invalid API key',
      });

      await expect(
        paymentService.createPaymentIntent({
          userId: 'user123',
          amountCents: 5000,
        })
      ).rejects.toThrow();
    });
  });
});
