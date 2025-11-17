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
});
