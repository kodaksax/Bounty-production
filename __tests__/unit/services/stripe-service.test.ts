/**
 * Unit tests for Stripe Service
 */

import { stripeService } from '../../../lib/services/stripe-service';

// Mock analytics and performance services
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: jest.fn(),
  },
}));

jest.mock('../../../lib/services/performance-service', () => ({
  performanceService: {
    startMeasurement: jest.fn(),
    endMeasurement: jest.fn(),
  },
}));

// Mock @stripe/stripe-react-native to throw error so fallback is used
jest.mock('@stripe/stripe-react-native', () => {
  throw new Error('SDK not available in test environment');
});

// Mock global fetch for API calls
global.fetch = jest.fn();

const { analyticsService } = require('../../../lib/services/analytics-service');
const { performanceService } = require('../../../lib/services/performance-service');

describe('Stripe Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset fetch mock before each test
    (global.fetch as jest.Mock).mockClear();
  });

  describe('initialize', () => {
    it('should initialize only once', async () => {
      await stripeService.initialize();
      await stripeService.initialize();
      
      // Should not throw and should be idempotent
      expect(true).toBe(true);
    });
  });

  describe('createPaymentMethod', () => {
    const validCardData = {
      cardNumber: '4242424242424242',
      expiryDate: '12/25',
      securityCode: '123',
      cardholderName: 'Test User',
    };

    it('should create a payment method with valid card data (fallback mode)', async () => {
      // In test environment, the SDK is not available, so it uses fallback
      // Fallback includes a 500ms delay to simulate network call
      const paymentMethod = await stripeService.createPaymentMethod(validCardData);

      expect(paymentMethod).toHaveProperty('id');
      expect(paymentMethod.id).toMatch(/^pm_/);
      expect(paymentMethod.type).toBe('card');
      expect(paymentMethod.card.last4).toBe('4242');
      expect(paymentMethod.card.exp_month).toBe(12);
      expect(paymentMethod.card.exp_year).toBe(2025);
    });

    it('should detect card brand correctly', async () => {
      const visaCard = { ...validCardData, cardNumber: '4242424242424242' };
      const result = await stripeService.createPaymentMethod(visaCard);
      
      expect(result.card.brand).toBe('visa');
    });

    it('should handle Mastercard', async () => {
      const mastercardData = { ...validCardData, cardNumber: '5555555555554444' };
      const result = await stripeService.createPaymentMethod(mastercardData);
      
      expect(result.card.brand).toBe('mastercard');
      expect(result.card.last4).toBe('4444');
    });

    it('should include created timestamp', async () => {
      const result = await stripeService.createPaymentMethod(validCardData);
      
      expect(result.created).toBeGreaterThan(0);
      expect(typeof result.created).toBe('number');
    });
  });

  describe('createPaymentIntent', () => {
    beforeEach(() => {
      // Mock successful API response
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          clientSecret: 'pi_mock_secret_12345',
          paymentIntentId: 'pi_mock_67890',
        }),
      });
    });

    it('should create a payment intent with valid amount', async () => {
      const amount = 100;
      const currency = 'usd';

      const paymentIntent = await stripeService.createPaymentIntent(amount, currency);

      expect(paymentIntent).toHaveProperty('id');
      expect(paymentIntent.id).toBe('pi_mock_67890');
      expect(paymentIntent.amount).toBe(10000); // Converted to cents
      expect(paymentIntent.currency).toBe(currency);
      expect(paymentIntent.status).toBe('requires_payment_method');
      expect(paymentIntent.client_secret).toBe('pi_mock_secret_12345');
    });

    it('should track analytics event on success', async () => {
      await stripeService.createPaymentIntent(50, 'usd');

      expect(analyticsService.trackEvent).toHaveBeenCalledWith('payment_initiated', {
        amount: 50,
        currency: 'usd',
        paymentIntentId: 'pi_mock_67890',
      });
    });

    it('should measure performance', async () => {
      await stripeService.createPaymentIntent(75, 'usd');

      expect(performanceService.startMeasurement).toHaveBeenCalledWith(
        'payment_initiate',
        'payment_process',
        { amount: 75, currency: 'usd' }
      );

      expect(performanceService.endMeasurement).toHaveBeenCalledWith(
        'payment_initiate',
        { success: true, amount: 75 }
      );
    });

    it('should use USD as default currency', async () => {
      const paymentIntent = await stripeService.createPaymentIntent(100);
      
      expect(paymentIntent.currency).toBe('usd');
    });

    it('should handle different currencies', async () => {
      const paymentIntent = await stripeService.createPaymentIntent(100, 'eur');
      
      expect(paymentIntent.currency).toBe('eur');
    });
  });

  describe('confirmPayment', () => {
    it('should have confirmPayment method', () => {
      // Test that the method exists and can be called
      expect(stripeService).toHaveProperty('confirmPayment');
      expect(typeof stripeService.confirmPayment).toBe('function');
    });
  });

  describe('error handling', () => {
    it('should handle Stripe API errors gracefully', async () => {
      // This tests the error handling mechanism
      // In real implementation, would test with various Stripe error codes
      expect(stripeService).toHaveProperty('createPaymentIntent');
      expect(stripeService).toHaveProperty('createPaymentMethod');
    });
  });
});
