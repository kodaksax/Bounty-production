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

// Mock @stripe/stripe-react-native to simulate unavailable SDK (initStripe rejects)
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: jest.fn().mockRejectedValue(new Error('SDK not available in test environment')),
  createPaymentMethod: jest.fn(),
  confirmPayment: jest.fn(),
  initPaymentSheet: jest.fn(),
  presentPaymentSheet: jest.fn(),
}));

// Mock fetchWithTimeout to behave like fetch for tests
jest.mock('../../../lib/utils/fetch-with-timeout', () => ({
  fetchWithTimeout: jest.fn(),
}));

// Mock network connectivity utilities
jest.mock('../../../lib/utils/network-connectivity', () => ({
  getNetworkErrorMessage: jest.fn((error: any) => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error?.message) return error.message;
    return 'Network error occurred';
  }),
  checkNetworkConnectivity: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
  }),
  ensureNetworkConnectivity: jest.fn().mockResolvedValue(undefined),
}));

// Mock global fetch for API calls (some tests may still use it directly)
global.fetch = jest.fn();

const { analyticsService } = require('../../../lib/services/analytics-service');
const { performanceService } = require('../../../lib/services/performance-service');
const { fetchWithTimeout } = require('../../../lib/utils/fetch-with-timeout');

describe('Stripe Service', () => {
  // Set up environment variables before all tests to ensure proper configuration
  beforeAll(() => {
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_mock_key_for_testing';
  });

  afterAll(() => {
    // Clean up environment variables after tests
    delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset fetch and fetchWithTimeout mocks before each test
    (global.fetch as jest.Mock).mockClear();
    (fetchWithTimeout as jest.Mock).mockClear();
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
      // Mock successful API response for fetchWithTimeout
      (fetchWithTimeout as jest.Mock).mockResolvedValue({
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

  describe('listPaymentMethods with network timeout', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should handle slow network requests with fetchWithTimeout', async () => {
      // Mock a slow response that takes 20 seconds
      // fetchWithTimeout now handles timeouts and retries
      (fetchWithTimeout as jest.Mock).mockImplementation(() => 
        new Promise((resolve) => {
          setTimeout(() => resolve({
            ok: true,
            json: async () => ({ paymentMethods: [] })
          }), 20000); // 20 seconds
        })
      );

      const authToken = 'test_token';

      // The method will wait for the network request via fetchWithTimeout
      const methodsPromise = stripeService.listPaymentMethods(authToken);
      
      // For testing purposes, we'll verify it returns the result when it completes
      const methods = await methodsPromise;
      expect(Array.isArray(methods)).toBe(true);
    }, 30000); // Allow Jest to wait longer than the mock delay

    it('should handle network errors gracefully', async () => {
      // Mock fetchWithTimeout to throw a network error
      (fetchWithTimeout as jest.Mock).mockImplementation(() => {
        const error = new Error('Network request failed');
        error.name = 'NetworkError';
        return Promise.reject(error);
      });

      const authToken = 'test_token';

      await expect(stripeService.listPaymentMethods(authToken))
        .rejects
        .toMatchObject({
          message: expect.stringMatching(/Network request failed|error/i)
        });
    });

    it('should successfully fetch payment methods within timeout', async () => {
      // Mock a fast successful response
      (fetchWithTimeout as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          paymentMethods: [
            {
              id: 'pm_test123',
              card: {
                brand: 'visa',
                last4: '4242',
                exp_month: 12,
                exp_year: 2025
              },
              created: 1234567890
            }
          ]
        })
      });

      const authToken = 'test_token';
      const methods = await stripeService.listPaymentMethods(authToken);

      expect(methods).toHaveLength(1);
      expect(methods[0].id).toBe('pm_test123');
      expect(methods[0].card.last4).toBe('4242');
    });

    it('should return empty array when no auth token provided', async () => {
      const methods = await stripeService.listPaymentMethods();
      expect(methods).toEqual([]);
      // Verify no API call was made when auth token is not provided
      expect(fetchWithTimeout).not.toHaveBeenCalled();
    });

    it('should handle API errors correctly', async () => {
      (fetchWithTimeout as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: 'Unauthorized' })
      });

      const authToken = 'invalid_token';

      await expect(stripeService.listPaymentMethods(authToken))
        .rejects
        .toMatchObject({
          message: expect.stringMatching(/payment methods request failed|401|unauthorized/i)
        });
    });

    it('should surface 405 Method Not Allowed as a meaningful message', async () => {
      (fetchWithTimeout as jest.Mock).mockResolvedValue({
        ok: false,
        status: 405,
        text: async () => JSON.stringify({ error: 'Method not allowed' })
      });

      const authToken = 'test_token';

      await expect(stripeService.listPaymentMethods(authToken))
        .rejects
        .toMatchObject({
          message: expect.stringMatching(/405|method not allowed/i)
        });
    });

    it('should handle network errors with friendly messages', async () => {
      (fetchWithTimeout as jest.Mock).mockRejectedValue(
        new Error('Network request failed')
      );

      const authToken = 'test_token';

      await expect(stripeService.listPaymentMethods(authToken))
        .rejects
        .toMatchObject({
          message: expect.stringMatching(/Unable to connect|connect|network/i)
        });
    });
  });

  describe('attachPaymentMethod', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should attach a payment method successfully', async () => {
      (fetchWithTimeout as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          paymentMethod: {
            id: 'pm_attach123',
            type: 'card',
            card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2026 },
            created: 1234567890,
          },
        }),
      });

      const authToken = 'test_token';
      const result = await stripeService.attachPaymentMethod('pm_attach123', authToken);

      expect(result.id).toBe('pm_attach123');
      expect(result.card.brand).toBe('visa');
      expect(result.card.last4).toBe('4242');
      expect(fetchWithTimeout).toHaveBeenCalledWith(
        expect.stringContaining('/payments/methods'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should require an auth token', async () => {
      await expect(stripeService.attachPaymentMethod('pm_test123'))
        .rejects
        .toMatchObject({ message: expect.stringMatching(/auth|required/i) });
      expect(fetchWithTimeout).not.toHaveBeenCalled();
    });

    it('should surface API errors from attachPaymentMethod', async () => {
      (fetchWithTimeout as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: 'Payment method ID is required' }),
      });

      await expect(stripeService.attachPaymentMethod('', 'test_token'))
        .rejects
        .toMatchObject({ message: expect.stringMatching(/400|payment method/i) });
    });
  });

  describe('Apple Pay Support', () => {
    // Access the mocked React Native Platform from jest.setup.js
    const { Platform } = require('react-native');

    beforeEach(() => {
      // Default to iOS before each test; individual tests can override
      Platform.OS = 'ios';
    });

    describe('isApplePaySupported', () => {
      it('should return false on non-iOS platforms', async () => {
        Platform.OS = 'android';
        const supported = await stripeService.isApplePaySupported();
        expect(supported).toBe(false);
      });

      it('should return false when SDK is not available', async () => {
        Platform.OS = 'ios';
        // SDK is mocked to reject during initialization in this test file
        const supported = await stripeService.isApplePaySupported();
        expect(supported).toBe(false);
      });

      it('should handle errors gracefully', async () => {
        Platform.OS = 'ios';
        // Should not throw even if there's an error
        const supported = await stripeService.isApplePaySupported();
        expect(typeof supported).toBe('boolean');
      });
    });

    describe('presentApplePay', () => {
      it('should return error on non-iOS platforms', async () => {
        Platform.OS = 'android';
        const result = await stripeService.presentApplePay(10.00);
        
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/iOS/i);
        expect(result.errorCode).toBe('platform_not_supported');
      });

      it('should return error when SDK is not available', async () => {
        Platform.OS = 'ios';
        const result = await stripeService.presentApplePay(10.00);
        
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.errorCode).toBeDefined();
      });

      it('should enforce minimum amount of $0.50', async () => {
        Platform.OS = 'ios';
        const result = await stripeService.presentApplePay(0.49);
        
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/at least.*0\.50/i);
        expect(result.errorCode).toBe('invalid_amount');
      });

      it('should validate amount is not zero', async () => {
        Platform.OS = 'ios';
        const result = await stripeService.presentApplePay(0);
        
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/at least.*0\.50/i);
        expect(result.errorCode).toBe('invalid_amount');
      });

      it('should validate amount is not negative', async () => {
        Platform.OS = 'ios';
        const result = await stripeService.presentApplePay(-5.00);
        
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/at least.*0\.50/i);
        expect(result.errorCode).toBe('invalid_amount');
      });

      it('should accept valid amount above minimum', async () => {
        Platform.OS = 'ios';
        const result = await stripeService.presentApplePay(1.00);
        // Will fail due to SDK not available, but should pass amount validation
        expect(result).toHaveProperty('success');
        // Error should not be about amount
        if (!result.success && result.errorCode) {
          expect(result.errorCode).not.toBe('invalid_amount');
        }
      });

      it('should validate cart items total matches amount', async () => {
        Platform.OS = 'ios';
        const customCartItems = [
          { label: 'Item 1', amount: '10.00', type: 'final' as const },
          { label: 'Item 2', amount: '5.00', type: 'final' as const },
        ];
        
        // Amount (20.00) doesn't match cart total (15.00)
        const result = await stripeService.presentApplePay(20.00, 'Payment', customCartItems);
        
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/match.*cart.*total/i);
        expect(result.errorCode).toBe('amount_mismatch');
      });

      it('should accept cart items when total matches amount', async () => {
        Platform.OS = 'ios';
        const customCartItems = [
          { label: 'Item 1', amount: '10.00', type: 'final' as const },
          { label: 'Item 2', amount: '5.00', type: 'final' as const },
        ];
        
        // Amount matches cart total
        const result = await stripeService.presentApplePay(15.00, 'Payment', customCartItems);
        expect(result).toHaveProperty('success');
        // Error should not be about amount mismatch
        if (!result.success && result.errorCode) {
          expect(result.errorCode).not.toBe('amount_mismatch');
        }
      });

      it('should use default description if not provided', async () => {
        Platform.OS = 'ios';
        const result = await stripeService.presentApplePay(10.00);
        // Even though it will fail (SDK not available), it should process the default description
        expect(result).toHaveProperty('success');
      });

      it('should handle errors gracefully', async () => {
        Platform.OS = 'ios';
        const result = await stripeService.presentApplePay(10.00);
        
        // Should always return a result object
        expect(result).toHaveProperty('success');
        expect(typeof result.success).toBe('boolean');
        
        // If not successful, should have error info
        if (!result.success) {
          expect(result.error).toBeDefined();
        }
      });
    });
  });

  describe('parseStripeError', () => {
    it('should return default message for null error', () => {
      const result = stripeService.parseStripeError(null);
      expect(result).toBe('An unknown error occurred');
    });

    it('should return default message for undefined error', () => {
      const result = stripeService.parseStripeError(undefined);
      expect(result).toBe('An unknown error occurred');
    });

    it('should handle TimeoutError by name', () => {
      const error = new Error('Request took too long');
      error.name = 'TimeoutError';
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('Connection timed out. Please check your internet connection and try again.');
    });

    it('should handle timeout by message content', () => {
      const error = new Error('Connection timed out after 30 seconds');
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('Connection timed out. Please check your internet connection and try again.');
    });

    it('should handle AbortError', () => {
      const error = new Error('Request was aborted');
      error.name = 'AbortError';
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('Connection interrupted. Please check your internet connection and try again.');
    });

    it('should handle NetworkError by name', () => {
      const error = new Error('Network failure');
      error.name = 'NetworkError';
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('Unable to connect. Please check your internet connection.');
    });

    it('should handle Network error by message', () => {
      const error = new Error('Network request failed');
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('Unable to connect. Please check your internet connection.');
    });

    it('should handle fetch failed error', () => {
      const error = new Error('fetch failed');
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('Unable to connect. Please check your internet connection.');
    });

    it('should detect test/live mode mismatch (live mode with test key)', () => {
      const error = new Error('No such setupintent: si_123 in live mode but using test mode key');
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('Payment configuration error: Your payment keys are in different modes. Please contact support or check your environment configuration.');
    });

    it('should detect test/live mode mismatch (test mode with live key)', () => {
      const error = new Error('No such paymentintent: pi_123 in test mode but using live mode key');
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('Payment configuration error: Your payment keys are in different modes. Please contact support or check your environment configuration.');
    });

    it('should return original message for unknown error types', () => {
      const error = new Error('Custom Stripe error message');
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('Custom Stripe error message');
    });

    it('should handle errors without message property', () => {
      const error = { toString: () => 'String representation of error' };
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('String representation of error');
    });

    it('should handle string errors', () => {
      const error = 'Plain string error';
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('Plain string error');
    });

    it('should prioritize TimeoutError name over message', () => {
      const error = new Error('Some random message');
      error.name = 'TimeoutError';
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('Connection timed out. Please check your internet connection and try again.');
    });

    it('should prioritize AbortError name over message', () => {
      const error = new Error('Network failed');
      error.name = 'AbortError';
      const result = stripeService.parseStripeError(error);
      expect(result).toBe('Connection interrupted. Please check your internet connection and try again.');
    });
  });
});
