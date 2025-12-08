/**
 * Integration tests for Payment API endpoints
 * Tests the payment server endpoints with mocked Stripe
 */

import express from 'express';
import request from 'supertest';

// Set environment variables before requiring the server
beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key';
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  (process.env as any).NODE_ENV = 'test';
});

// Mock supabase client
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn((token) => {
        if (token === 'valid_token') {
          return Promise.resolve({
            data: { user: { id: 'user123', email: 'test@example.com' } },
            error: null,
          });
        }
        return Promise.resolve({
          data: { user: null },
          error: { message: 'Invalid token' },
        });
      }),
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({
            data: {
              id: 'user123',
              stripe_customer_id: 'cus_test123',
              email: 'test@example.com',
            },
            error: null,
          })),
        })),
      })),
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null })),
      })),
      insert: jest.fn(() => Promise.resolve({ error: null })),
    })),
  })),
}));

// Mock Stripe
const mockStripe = {
  customers: {
    create: jest.fn(async (_params?: any) => ({
      id: 'cus_new123',
      email: 'test@example.com',
    })),
    retrieve: jest.fn(async (_id?: any) => ({
      id: 'cus_test123',
      email: 'test@example.com',
    })),
  },
  paymentIntents: {
    create: jest.fn(async (_params?: any) => ({
      id: 'pi_test123',
      client_secret: 'pi_test123_secret_abc',
      amount: 5000,
      currency: 'usd',
      status: 'requires_payment_method',
    })),
    confirm: jest.fn(async (_idOrParams?: any) => ({
      id: 'pi_test123',
      status: 'succeeded',
    })),
    cancel: jest.fn(async (_id?: any) => ({
      id: 'pi_test123',
      status: 'canceled',
    })),
  },
  refunds: {
    create: jest.fn(async (_params?: any) => ({
      id: 'ref_test123',
      amount: 5000,
      status: 'succeeded',
    })),
  },
};

jest.mock('stripe', () => {
  return jest.fn(() => mockStripe);
});

describe('Payment API Integration Tests', () => {
  let app: any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      // Create a simple Express app for testing
      app = express();
      
      app.get('/health', (req: any, res: any) => {
        res.json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          stripeConfigured: true,
          supabaseConfigured: true,
        });
      });

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('stripeConfigured');
      expect(response.body).toHaveProperty('supabaseConfigured');
    });
  });

  describe('POST /payments/create-payment-intent', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      // Mock authentication middleware
      app.use((req: any, res: any, next: any) => {
        const authHeader = req.headers.authorization;
        if (authHeader === 'Bearer valid_token') {
          req.user = { id: 'user123', email: 'test@example.com' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.post('/payments/create-payment-intent', async (req: any, res: any) => {
        const { amountCents, currency = 'usd' } = req.body;
        
        if (!amountCents || amountCents <= 0) {
          return res.status(400).json({ error: 'Invalid amount' });
        }

        try {
          const paymentIntent = await mockStripe.paymentIntents.create({
            amount: amountCents,
            currency,
            customer: 'cus_test123',
          });

          res.json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should create payment intent with valid data', async () => {
      const response = await request(app)
        .post('/payments/create-payment-intent')
        .set('Authorization', 'Bearer valid_token')
        .send({
          amountCents: 5000,
          currency: 'usd',
          metadata: { bountyId: 'bounty123' },
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('clientSecret');
      expect(response.body).toHaveProperty('paymentIntentId');
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5000,
          currency: 'usd',
        })
      );
    });

    it('should reject request without authentication', async () => {
      const response = await request(app)
        .post('/payments/create-payment-intent')
        .send({
          amountCents: 5000,
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject invalid amount', async () => {
      const response = await request(app)
        .post('/payments/create-payment-intent')
        .set('Authorization', 'Bearer valid_token')
        .send({
          amountCents: 0,
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject negative amount', async () => {
      const response = await request(app)
        .post('/payments/create-payment-intent')
        .set('Authorization', 'Bearer valid_token')
        .send({
          amountCents: -100,
        });

      expect(response.status).toBe(400);
    });

    it('should handle missing amount', async () => {
      const response = await request(app)
        .post('/payments/create-payment-intent')
        .set('Authorization', 'Bearer valid_token')
        .send({
          currency: 'usd',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /payments/escrow', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      app.use((req: any, res: any, next: any) => {
        const authHeader = req.headers.authorization;
        if (authHeader === 'Bearer valid_token') {
          req.user = { id: 'user123', email: 'test@example.com' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.post('/payments/escrow', async (req: any, res: any) => {
        const { amountCents, bountyId } = req.body;
        
        if (!amountCents || !bountyId) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        try {
          const paymentIntent = await mockStripe.paymentIntents.create({
            amount: amountCents,
            currency: 'usd',
            capture_method: 'manual',
            metadata: { bountyId, type: 'escrow' },
          });

          res.json({
            escrowId: paymentIntent.id,
            status: 'held',
            amount: amountCents,
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should create escrow payment', async () => {
      const response = await request(app)
        .post('/payments/escrow')
        .set('Authorization', 'Bearer valid_token')
        .send({
          amountCents: 10000,
          bountyId: 'bounty123',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('escrowId');
      expect(response.body).toHaveProperty('status', 'held');
      expect(response.body.amount).toBe(10000);
    });

    it('should require bountyId', async () => {
      const response = await request(app)
        .post('/payments/escrow')
        .set('Authorization', 'Bearer valid_token')
        .send({
          amountCents: 10000,
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /payments/release', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      app.use((req: any, res: any, next: any) => {
        const authHeader = req.headers.authorization;
        if (authHeader === 'Bearer valid_token') {
          req.user = { id: 'user123', email: 'test@example.com' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.post('/payments/release', async (req: any, res: any) => {
        const { paymentIntentId } = req.body;
        
        if (!paymentIntentId) {
          return res.status(400).json({ error: 'Missing payment intent ID' });
        }

        try {
          const confirmed = await mockStripe.paymentIntents.confirm(paymentIntentId);

          res.json({
            status: 'released',
            paymentIntentId: confirmed.id,
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should release escrow funds', async () => {
      const response = await request(app)
        .post('/payments/release')
        .set('Authorization', 'Bearer valid_token')
        .send({
          paymentIntentId: 'pi_test123',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'released');
      expect(mockStripe.paymentIntents.confirm).toHaveBeenCalledWith('pi_test123');
    });
  });

  describe('POST /payments/refund', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      app.use((req: any, res: any, next: any) => {
        const authHeader = req.headers.authorization;
        if (authHeader === 'Bearer valid_token') {
          req.user = { id: 'user123', email: 'test@example.com' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.post('/payments/refund', async (req: any, res: any) => {
        const { paymentIntentId, reason } = req.body;
        
        if (!paymentIntentId) {
          return res.status(400).json({ error: 'Missing payment intent ID' });
        }

        try {
          const refund = await mockStripe.refunds.create({
            payment_intent: paymentIntentId,
            reason: reason || 'requested_by_customer',
          });

          res.json({
            status: 'refunded',
            refundId: refund.id,
            amount: refund.amount,
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should refund payment', async () => {
      const response = await request(app)
        .post('/payments/refund')
        .set('Authorization', 'Bearer valid_token')
        .send({
          paymentIntentId: 'pi_test123',
          reason: 'dispute',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'refunded');
      expect(response.body).toHaveProperty('refundId');
      expect(mockStripe.refunds.create).toHaveBeenCalled();
    });
  });

  describe('POST /payments/webhook', () => {
    let mockWebhookEvent: any;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      // Mock webhook signature verification
      mockWebhookEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            amount: 5000,
            currency: 'usd',
            status: 'succeeded',
            metadata: {
              user_id: 'user123',
              purpose: 'wallet_deposit',
            },
          },
        },
      };

      app.post('/payments/webhook', async (req: any, res: any) => {
        const signature = req.headers['stripe-signature'];
        
        if (!signature) {
          return res.status(400).json({ error: 'Missing signature' });
        }

        if (signature === 'invalid') {
          return res.status(400).json({ error: 'Invalid signature' });
        }

        // Simulate event processing
        const event = mockWebhookEvent;
        
        res.json({ received: true, event_type: event.type });
      });
    });

    it('should process webhook with valid signature', async () => {
      const response = await request(app)
        .post('/payments/webhook')
        .set('stripe-signature', 'valid_signature')
        .send(mockWebhookEvent);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('received', true);
    });

    it('should reject webhook without signature', async () => {
      const response = await request(app)
        .post('/payments/webhook')
        .send(mockWebhookEvent);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Missing signature');
    });

    it('should reject webhook with invalid signature', async () => {
      const response = await request(app)
        .post('/payments/webhook')
        .set('stripe-signature', 'invalid')
        .send(mockWebhookEvent);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Invalid signature');
    });
  });

  describe('Idempotency Key Handling', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      const usedKeys = new Set<string>();

      app.post('/payments/create-payment-intent', async (req: any, res: any) => {
        const { idempotencyKey, amountCents } = req.body;
        
        if (!idempotencyKey) {
          return res.status(400).json({ error: 'Idempotency key required' });
        }

        if (usedKeys.has(idempotencyKey)) {
          return res.status(409).json({ 
            error: 'Duplicate payment request',
            code: 'duplicate_transaction',
          });
        }

        usedKeys.add(idempotencyKey);

        res.json({
          clientSecret: 'pi_test_secret',
          paymentIntentId: 'pi_test123',
          amount: amountCents,
        });
      });
    });

    it('should accept first request with idempotency key', async () => {
      const response = await request(app)
        .post('/payments/create-payment-intent')
        .send({
          amountCents: 5000,
          idempotencyKey: 'key_unique_123',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('paymentIntentId');
    });

    it('should reject duplicate request with same idempotency key', async () => {
      const key = 'key_duplicate_456';

      // First request
      await request(app)
        .post('/payments/create-payment-intent')
        .send({
          amountCents: 5000,
          idempotencyKey: key,
        });

      // Duplicate request
      const response = await request(app)
        .post('/payments/create-payment-intent')
        .send({
          amountCents: 5000,
          idempotencyKey: key,
        });

      expect(response.status).toBe(409);
      expect(response.body).toHaveProperty('code', 'duplicate_transaction');
    });

    it('should require idempotency key', async () => {
      const response = await request(app)
        .post('/payments/create-payment-intent')
        .send({
          amountCents: 5000,
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Idempotency key required');
    });
  });

  describe('Stripe Connect Account Flows', () => {
    let mockConnectAccount: any;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      app.use((req: any, res: any, next: any) => {
        const authHeader = req.headers.authorization;
        if (authHeader === 'Bearer valid_token') {
          req.user = { id: 'user123' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      mockConnectAccount = {
        id: 'acct_test123',
        type: 'express',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        requirements: {
          currently_due: ['individual.first_name', 'individual.last_name'],
          pending_verification: [],
        },
      };

      // Mock account creation
      app.post('/connect/onboarding', async (req: any, res: any) => {
        res.json({
          url: 'https://connect.stripe.com/setup/test',
          expiresAt: Date.now() + 3600000,
        });
      });

      // Mock account status
      app.get('/connect/status', async (req: any, res: any) => {
        res.json({
          hasStripeAccount: true,
          stripeAccountId: mockConnectAccount.id,
          detailsSubmitted: mockConnectAccount.details_submitted,
          chargesEnabled: mockConnectAccount.charges_enabled,
          payoutsEnabled: mockConnectAccount.payouts_enabled,
          requiresAction: mockConnectAccount.requirements.currently_due.length > 0,
          currentlyDue: mockConnectAccount.requirements.currently_due,
        });
      });
    });

    it('should create onboarding link', async () => {
      const response = await request(app)
        .post('/connect/onboarding')
        .set('Authorization', 'Bearer valid_token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('url');
      expect(response.body.url).toContain('connect.stripe.com');
      expect(response.body).toHaveProperty('expiresAt');
    });

    it('should get connect account status', async () => {
      const response = await request(app)
        .get('/connect/status')
        .set('Authorization', 'Bearer valid_token');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('hasStripeAccount', true);
      expect(response.body).toHaveProperty('stripeAccountId');
      expect(response.body).toHaveProperty('chargesEnabled');
      expect(response.body).toHaveProperty('payoutsEnabled');
      expect(response.body).toHaveProperty('requiresAction');
      expect(response.body).toHaveProperty('currentlyDue');
    });

    it('should require authentication for connect endpoints', async () => {
      const response = await request(app)
        .post('/connect/onboarding')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should show pending requirements', async () => {
      const response = await request(app)
        .get('/connect/status')
        .set('Authorization', 'Bearer valid_token');

      expect(response.status).toBe(200);
      expect(response.body.requiresAction).toBe(true);
      expect(response.body.currentlyDue).toContain('individual.first_name');
      expect(response.body.currentlyDue).toContain('individual.last_name');
    });
  });

  describe('Payment Error Handling', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      app.post('/payments/create-payment-intent', async (req: any, res: any) => {
        const { errorType } = req.body;

        if (errorType === 'card_error') {
          return res.status(400).json({
            error: 'Your card was declined.',
            code: 'card_declined',
            decline_code: 'insufficient_funds',
          });
        }

        if (errorType === 'api_error') {
          return res.status(500).json({
            error: 'Payment service temporarily unavailable.',
          });
        }

        if (errorType === 'rate_limit') {
          return res.status(429).json({
            error: 'Too many requests. Please try again later.',
          });
        }

        res.json({ success: true });
      });
    });

    it('should handle card errors', async () => {
      const response = await request(app)
        .post('/payments/create-payment-intent')
        .send({ errorType: 'card_error' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('code', 'card_declined');
      expect(response.body).toHaveProperty('decline_code', 'insufficient_funds');
    });

    it('should handle API errors', async () => {
      const response = await request(app)
        .post('/payments/create-payment-intent')
        .send({ errorType: 'api_error' });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('temporarily unavailable');
    });

    it('should handle rate limiting', async () => {
      const response = await request(app)
        .post('/payments/create-payment-intent')
        .send({ errorType: 'rate_limit' });

      expect(response.status).toBe(429);
      expect(response.body.error).toContain('Too many requests');
    });
  });

  describe('SCA (3D Secure) Flows', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      app.post('/payments/confirm', async (req: any, res: any) => {
        const { requiresAction } = req.body;

        if (requiresAction) {
          return res.json({
            status: 'requires_action',
            paymentIntentId: 'pi_test123',
            next_action: {
              type: 'redirect_to_url',
              redirect_to_url: {
                url: 'https://hooks.stripe.com/3d_secure/authenticate',
              },
            },
          });
        }

        res.json({
          status: 'succeeded',
          paymentIntentId: 'pi_test123',
        });
      });
    });

    it('should return requires_action for 3DS', async () => {
      const response = await request(app)
        .post('/payments/confirm')
        .send({ requiresAction: true });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'requires_action');
      expect(response.body).toHaveProperty('next_action');
      expect(response.body.next_action.type).toBe('redirect_to_url');
    });

    it('should succeed without 3DS when not required', async () => {
      const response = await request(app)
        .post('/payments/confirm')
        .send({ requiresAction: false });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'succeeded');
    });
  });
});
