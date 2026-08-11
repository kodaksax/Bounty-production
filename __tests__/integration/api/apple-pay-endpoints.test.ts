/**
 * Integration tests for Apple Pay API endpoints
 *
 * Exercises the real Fastify route handlers in
 * services/api/src/routes/apple-pay.ts via fastify.inject(), with Stripe,
 * Supabase auth, wallet, and receipt dependencies mocked at the module
 * boundary.
 */

import Fastify, { FastifyInstance } from 'fastify';

const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: (...args: any[]) => mockGetUser(...args) },
  })),
}));

const mockCreateDeposit = jest.fn();
jest.mock('../../../services/api/src/services/consolidated-wallet-service', () => ({
  createDeposit: (...args: any[]) => mockCreateDeposit(...args),
}));

const mockSendReceiptEmail = jest.fn();
const mockLogReceipt = jest.fn();
jest.mock('../../../services/api/src/services/apple-pay-receipt-service', () => ({
  applePayReceiptService: {
    sendReceiptEmail: (...args: any[]) => mockSendReceiptEmail(...args),
    logReceipt: (...args: any[]) => mockLogReceipt(...args),
  },
}));

const mockPaymentIntentsCreate = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: (...args: any[]) => mockPaymentIntentsCreate(...args),
      retrieve: (...args: any[]) => mockPaymentIntentsRetrieve(...args),
    },
  }));
});

// Configure a "real" Supabase client (not the middleware's no-credentials
// test bypass) so 401/403 assertions below are meaningful, and provide a
// Stripe key so registerApplePayRoutes registers real routes instead of the
// 501 stubs it falls back to when unconfigured.
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { registerApplePayRoutes } = require('../../../services/api/src/routes/apple-pay');

describe('Apple Pay API Endpoints', () => {
  let app: FastifyInstance;
  const authToken = 'valid-test-token';
  const userId = 'user_123';

  beforeAll(async () => {
    app = Fastify();
    await registerApplePayRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Mirrors the real applePayReceiptService.sendReceiptEmail contract: it's
    // declared `async`, so it always resolves/rejects rather than throwing
    // synchronously — required for routes/apple-pay.ts's `.catch(...)` chain.
    mockSendReceiptEmail.mockResolvedValue(true);

    mockGetUser.mockImplementation(async (token: string) => {
      if (token === authToken) {
        return { data: { user: { id: userId, email: 'test@example.com' } }, error: null };
      }
      return { data: { user: null }, error: { message: 'Invalid token' } };
    });

    mockPaymentIntentsCreate.mockResolvedValue({
      id: 'pi_test_123',
      client_secret: 'pi_test_123_secret_abc',
      amount: 5000,
      currency: 'usd',
      status: 'requires_payment_method',
    });

    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: 'pi_test_123',
      amount: 5000,
      status: 'succeeded',
      metadata: { user_id: userId, payment_method: 'apple_pay' },
    });

    mockCreateDeposit.mockResolvedValue({ id: 'txn_123', type: 'deposit', amount: 50 });
  });

  describe('POST /apple-pay/payment-intent', () => {
    it('should create payment intent with valid request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/apple-pay/payment-intent',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { amountCents: 5000, description: 'Test deposit' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('clientSecret');
      expect(body).toHaveProperty('paymentIntentId');
      expect(body.clientSecret).toContain('pi_');
    });

    it('should reject amount below minimum', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/apple-pay/payment-intent',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { amountCents: 25, description: 'Test deposit' }, // Below $0.50 minimum
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('at least $0.50');
    });

    it('should reject amount above maximum', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/apple-pay/payment-intent',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { amountCents: 2000000, description: 'Test deposit' }, // Above $10,000 maximum
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('maximum');
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/apple-pay/payment-intent',
        payload: { amountCents: 5000, description: 'Test deposit' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject an invalid bearer token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/apple-pay/payment-intent',
        headers: { authorization: 'Bearer not-a-real-token' },
        payload: { amountCents: 5000, description: 'Test deposit' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should support idempotency key', async () => {
      const idempotencyKey = 'test_key_123';

      const response = await app.inject({
        method: 'POST',
        url: '/apple-pay/payment-intent',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { amountCents: 5000, description: 'Test deposit', idempotencyKey },
      });

      expect(response.statusCode).toBe(200);
      expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
        expect.any(Object),
        { idempotencyKey }
      );
    });

    it('should include payment_method metadata', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/apple-pay/payment-intent',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { amountCents: 5000, description: 'Test deposit' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            user_id: userId,
            payment_method: 'apple_pay',
          }),
        })
      );
    });
  });

  describe('POST /apple-pay/confirm', () => {
    it('should confirm successful payment', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/apple-pay/confirm',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { paymentIntentId: 'pi_test_123' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.status).toBe('succeeded');
      expect(body).toHaveProperty('transactionId', 'txn_123');
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/apple-pay/confirm',
        payload: { paymentIntentId: 'pi_test_123' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject a payment intent that belongs to another user', async () => {
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_other_user',
        amount: 5000,
        status: 'succeeded',
        metadata: { user_id: 'some-other-user', payment_method: 'apple_pay' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/apple-pay/confirm',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { paymentIntentId: 'pi_other_user' },
      });

      expect(response.statusCode).toBe(403);
      expect(mockCreateDeposit).not.toHaveBeenCalled();
    });

    it('should handle incomplete payment', async () => {
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_test_456',
        amount: 5000,
        status: 'requires_payment_method',
        metadata: { user_id: userId, payment_method: 'apple_pay' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/apple-pay/confirm',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { paymentIntentId: 'pi_test_456' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it('should create a wallet deposit transaction on success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/apple-pay/confirm',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { paymentIntentId: 'pi_test_123' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockCreateDeposit).toHaveBeenCalledWith(
        userId,
        50, // $50.00, converted from paymentIntent.amount (5000 cents)
        'pi_test_123',
        'apple_pay_pi_test_123'
      );
    });
  });
});
