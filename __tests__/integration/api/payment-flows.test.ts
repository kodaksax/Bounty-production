/**
 * Comprehensive Integration Tests for Payment Endpoints
 * Tests all payment API endpoints with mocked dependencies
 * 
 * NOTE: These tests use a mock Express app with inline handlers rather than
 * the actual Fastify routes from services/api/src/routes/*. This approach
 * allows testing endpoint behavior in isolation, but tests may pass even if
 * production routes break. Consider enhancing these tests to use real API
 * routes for more accurate integration testing.
 */

import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

// Set environment variables
beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key';
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NODE_ENV = 'test';
});

// Mock Supabase
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
          maybeSingle: jest.fn(() => Promise.resolve({
            data: null,
            error: null,
          })),
        })),
      })),
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null })),
      })),
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({
            data: { id: 'tx123', type: 'deposit', amount: 5000 },
            error: null,
          })),
        })),
      })),
    })),
    rpc: jest.fn(() => Promise.resolve({ data: 10000, error: null })),
  })),
}));

// Mock Stripe
const MOCK_CLOCK_ID = 'clock_test123';

const mockStripe = {
  customers: {
    create: jest.fn(async () => ({
      id: 'cus_new123',
      email: 'test@example.com',
    })),
    retrieve: jest.fn(async () => ({
      id: 'cus_test123',
      email: 'test@example.com',
    })),
  },
  paymentIntents: {
    create: jest.fn(async () => ({
      id: 'pi_test123',
      client_secret: 'pi_test123_secret_abc',
      amount: 5000,
      currency: 'usd',
      status: 'requires_payment_method',
    })),
    confirm: jest.fn(async () => ({
      id: 'pi_test123',
      status: 'succeeded',
    })),
    cancel: jest.fn(async () => ({
      id: 'pi_test123',
      status: 'canceled',
    })),
    retrieve: jest.fn(async () => ({
      id: 'pi_test123',
      status: 'succeeded',
      amount: 5000,
    })),
  },
  paymentMethods: {
    list: jest.fn(async () => ({
      data: [
        {
          id: 'pm_test123',
          type: 'card',
          card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2025 },
        },
      ],
    })),
    attach: jest.fn(async () => ({
      id: 'pm_test123',
      type: 'card',
    })),
    detach: jest.fn(async () => ({
      id: 'pm_test123',
    })),
  },
  setupIntents: {
    create: jest.fn(async () => ({
      id: 'seti_test123',
      client_secret: 'seti_test123_secret_abc',
    })),
  },
  testHelpers: {
    testClocks: {
      create: jest.fn(async () => ({
        id: MOCK_CLOCK_ID,
        frozen_time: 1710000000,
        status: 'ready',
      })),
      advance: jest.fn(async (_clockId: string, params: { frozen_time?: number }) => ({
        id: MOCK_CLOCK_ID,
        frozen_time: params?.frozen_time ?? 1710000300,
        status: 'ready',
      })),
    },
  },
  refunds: {
    create: jest.fn(async () => ({
      id: 'ref_test123',
      amount: 5000,
      status: 'succeeded',
    })),
  },
  transfers: {
    create: jest.fn(async () => ({
      id: 'tr_test123',
      amount: 5000,
      destination: 'acct_test123',
    })),
  },
};

jest.mock('stripe', () => {
  // Return a constructor function that returns the mock Stripe instance
  return jest.fn().mockImplementation(() => mockStripe);
});

describe('Payment Endpoints Integration Tests', () => {
  let app: any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Escrow lifecycle integration with Stripe test clock simulation', () => {
    const RELEASE_CLOCK_START = 1710000000; // 2024-03-09T16:00:00.000Z
    const REFUND_CLOCK_START = 1711000000; // 2024-03-21T05:46:40.000Z

    type CapturedWebhookPayload = {
      id: string;
      amount_received: number;
      payment_intent?: never;
      amount_refunded?: never;
    };

    type RefundedWebhookPayload = {
      payment_intent: string;
      amount_refunded: number;
      id?: never;
      amount_received?: never;
    };

    type StripeWebhookPayload = CapturedWebhookPayload | RefundedWebhookPayload;

    type StripeWebhookEvent =
      | { type: 'payment_intent.captured'; data: { object: CapturedWebhookPayload } }
      | { type: 'charge.refunded'; data: { object: RefundedWebhookPayload } };

    const getPaymentIntentIdFromWebhookPayload = (payload: StripeWebhookPayload) =>
      // Capture events provide `id` (PaymentIntent id) while refund events provide `payment_intent`.
      'id' in payload ? payload.id : payload.payment_intent;

    const applyWebhookEvent = (
      event: StripeWebhookEvent,
      balances: Record<string, number>,
      escrowOwnerByIntent: Record<string, { posterId: string; hunterId: string }>,
    ) => {
      const payload = event.data.object;
      const intentId = getPaymentIntentIdFromWebhookPayload(payload);

      if (!intentId) {
        throw new Error('Webhook payload missing payment intent id');
      }

      const owner = escrowOwnerByIntent[intentId];

      if (!owner) {
        return;
      }

      if (event.type === 'payment_intent.captured') {
        balances[owner.hunterId] = (balances[owner.hunterId] ?? 0) + event.data.object.amount_received;
      } else {
        balances[owner.posterId] = (balances[owner.posterId] ?? 0) + event.data.object.amount_refunded;
      }
    };

    const attachTestAuth = (targetApp: Application, userId: string) => {
      targetApp.use((req: Request, res: Response, next: NextFunction) => {
        if (req.headers.authorization === 'Bearer valid_token') {
          (req as Request & { user?: { id: string } }).user = { id: userId };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });
    };

    it('create escrow → confirm PaymentIntent → release credits hunter balance', async () => {
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
      expect(stripeSecretKey).toBeDefined();
      expect(stripeSecretKey).toMatch(/^sk_test_/);

      const bountyId = 'bounty-release-1';
      const posterId = 'poster-release-1';
      const hunterId = 'hunter-release-1';
      const amountCents = 10000;
      const balances: Record<string, number> = { [posterId]: 0, [hunterId]: 2500 };
      const escrowOwnerByIntent: Record<string, { posterId: string; hunterId: string }> = {};

      app = express();
      app.use(express.json());
      attachTestAuth(app, posterId);
      // Test harness endpoint for lifecycle simulation; not a production API route.
      app.post('/api/escrow/lifecycle/release', async (req: Request, res: Response) => {
        const clock = await mockStripe.testHelpers.testClocks.create({
          frozen_time: RELEASE_CLOCK_START,
          name: 'escrow-release-flow',
        });

        const escrowIntent = await mockStripe.paymentIntents.create({
          amount: req.body.amountCents,
          currency: 'usd',
          capture_method: 'manual',
          test_clock: clock.id,
          metadata: {
            bountyId: req.body.bountyId,
            posterId: req.body.posterId,
            hunterId: req.body.hunterId,
            type: 'escrow',
          },
        });

        escrowOwnerByIntent[escrowIntent.id] = {
          posterId: req.body.posterId,
          hunterId: req.body.hunterId,
        };

        const confirmed = await mockStripe.paymentIntents.confirm(escrowIntent.id);
        await mockStripe.testHelpers.testClocks.advance(clock.id, { frozen_time: 1710000600 });

        applyWebhookEvent(
          {
            type: 'payment_intent.captured',
            data: { object: { id: escrowIntent.id, amount_received: req.body.amountCents } },
          },
          balances,
          escrowOwnerByIntent,
        );

        res.json({
          success: true,
          status: confirmed.status,
          clockId: clock.id,
          escrowId: escrowIntent.id,
          hunterBalance: balances[req.body.hunterId],
        });
      });

      mockStripe.paymentIntents.confirm.mockResolvedValueOnce({
        id: 'pi_test123',
        status: 'requires_capture',
        amount: amountCents,
        metadata: { bountyId, posterId, hunterId, type: 'escrow' },
      });

      const response = await request(app)
        .post('/api/escrow/lifecycle/release')
        .set('Authorization', 'Bearer valid_token')
        .send({ bountyId, posterId, hunterId, amountCents });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('requires_capture');
      expect(response.body.hunterBalance).toBe(12500);
      expect(balances[hunterId]).toBe(12500);
      expect(mockStripe.testHelpers.testClocks.create).toHaveBeenCalledWith({
        frozen_time: RELEASE_CLOCK_START,
        name: 'escrow-release-flow',
      });
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: amountCents,
        currency: 'usd',
        capture_method: 'manual',
        test_clock: MOCK_CLOCK_ID,
        metadata: { bountyId, posterId, hunterId, type: 'escrow' },
      });
      expect(mockStripe.testHelpers.testClocks.advance).toHaveBeenCalledWith(MOCK_CLOCK_ID, { frozen_time: 1710000600 });
    });

    it('create escrow → confirm PaymentIntent → refund credits poster balance', async () => {
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
      expect(stripeSecretKey).toBeDefined();
      expect(stripeSecretKey).toMatch(/^sk_test_/);

      const bountyId = 'bounty-refund-1';
      const posterId = 'poster-refund-1';
      const hunterId = 'hunter-refund-1';
      const amountCents = 8000;
      const balances: Record<string, number> = { [posterId]: 4000, [hunterId]: 0 };
      const escrowOwnerByIntent: Record<string, { posterId: string; hunterId: string }> = {};

      app = express();
      app.use(express.json());
      attachTestAuth(app, posterId);
      // Test harness endpoint for lifecycle simulation; not a production API route.
      app.post('/api/escrow/lifecycle/refund', async (req: Request, res: Response) => {
        const clock = await mockStripe.testHelpers.testClocks.create({
          frozen_time: REFUND_CLOCK_START,
          name: 'escrow-refund-flow',
        });

        const escrowIntent = await mockStripe.paymentIntents.create({
          amount: req.body.amountCents,
          currency: 'usd',
          capture_method: 'manual',
          test_clock: clock.id,
          metadata: {
            bountyId: req.body.bountyId,
            posterId: req.body.posterId,
            hunterId: req.body.hunterId,
            type: 'escrow',
          },
        });

        escrowOwnerByIntent[escrowIntent.id] = {
          posterId: req.body.posterId,
          hunterId: req.body.hunterId,
        };

        const confirmed = await mockStripe.paymentIntents.confirm(escrowIntent.id);
        const refund = await mockStripe.refunds.create({
          payment_intent: escrowIntent.id,
          amount: req.body.amountCents,
          metadata: {
            bountyId: req.body.bountyId,
            posterId: req.body.posterId,
            hunterId: req.body.hunterId,
            reason: 'poster_cancelled',
          },
        });

        await mockStripe.testHelpers.testClocks.advance(clock.id, { frozen_time: 1711000600 });

        applyWebhookEvent(
          {
            type: 'charge.refunded',
            data: {
              object: { payment_intent: escrowIntent.id, amount_refunded: refund.amount },
            },
          },
          balances,
          escrowOwnerByIntent,
        );

        res.json({
          success: true,
          status: confirmed.status,
          refundStatus: refund.status,
          clockId: clock.id,
          escrowId: escrowIntent.id,
          posterBalance: balances[req.body.posterId],
        });
      });

      mockStripe.paymentIntents.confirm.mockResolvedValueOnce({
        id: 'pi_test123',
        status: 'requires_capture',
        amount: amountCents,
        metadata: { bountyId, posterId, hunterId, type: 'escrow' },
      });

      mockStripe.refunds.create.mockResolvedValueOnce({
        id: 'ref_refund_1',
        amount: amountCents,
        status: 'succeeded',
        payment_intent: 'pi_test123',
      });

      const response = await request(app)
        .post('/api/escrow/lifecycle/refund')
        .set('Authorization', 'Bearer valid_token')
        .send({ bountyId, posterId, hunterId, amountCents });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('requires_capture');
      expect(response.body.refundStatus).toBe('succeeded');
      expect(response.body.posterBalance).toBe(12000);
      expect(balances[posterId]).toBe(12000);
      expect(mockStripe.testHelpers.testClocks.create).toHaveBeenCalledWith({
        frozen_time: REFUND_CLOCK_START,
        name: 'escrow-refund-flow',
      });
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: amountCents,
        currency: 'usd',
        capture_method: 'manual',
        test_clock: MOCK_CLOCK_ID,
        metadata: { bountyId, posterId, hunterId, type: 'escrow' },
      });
      expect(mockStripe.testHelpers.testClocks.advance).toHaveBeenCalledWith(MOCK_CLOCK_ID, { frozen_time: 1711000600 });
    });
  });

  describe('POST /api/payments/create-intent', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      // Auth middleware
      app.use((req: any, res: any, next: any) => {
        const authHeader = req.headers.authorization;
        if (authHeader === 'Bearer valid_token') {
          req.user = { id: 'user123', email: 'test@example.com' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.post('/api/payments/create-intent', async (req: any, res: any) => {
        const { amountCents, currency = 'usd', metadata } = req.body;
        
        if (!amountCents || amountCents < 50) {
          return res.status(400).json({ error: 'Amount must be at least $0.50' });
        }

        try {
          const paymentIntent = await mockStripe.paymentIntents.create({
            amount: amountCents,
            currency,
            customer: 'cus_test123',
            metadata,
          });

          res.json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should create payment intent with valid data', async () => {
      const response = await request(app)
        .post('/api/payments/create-intent')
        .set('Authorization', 'Bearer valid_token')
        .send({
          amountCents: 5000,
          currency: 'usd',
          metadata: { bountyId: 'bounty123' },
        });

      expect(response.status).toBe(200);
      expect(response.body.paymentIntentId).toBe('pi_test123');
      expect(response.body.clientSecret).toBe('pi_test123_secret_abc');
      expect(response.body.amount).toBe(5000);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app)
        .post('/api/payments/create-intent')
        .send({ amountCents: 5000 });

      expect(response.status).toBe(401);
    });

    it('should reject amount below minimum', async () => {
      const response = await request(app)
        .post('/api/payments/create-intent')
        .set('Authorization', 'Bearer valid_token')
        .send({ amountCents: 10 });

      expect(response.status).toBe(400);
    });

    it('should handle Stripe errors gracefully', async () => {
      mockStripe.paymentIntents.create.mockRejectedValueOnce(
        new Error('Stripe API error')
      );

      const response = await request(app)
        .post('/api/payments/create-intent')
        .set('Authorization', 'Bearer valid_token')
        .send({ amountCents: 5000 });

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/payments/confirm', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      app.use((req: any, res: any, next: any) => {
        if (req.headers.authorization === 'Bearer valid_token') {
          req.user = { id: 'user123' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.post('/api/payments/confirm', async (req: any, res: any) => {
        const { paymentIntentId, paymentMethodId } = req.body;

        if (!paymentIntentId) {
          return res.status(400).json({ error: 'Payment intent ID required' });
        }

        try {
          const result = await mockStripe.paymentIntents.confirm(paymentIntentId, {
            payment_method: paymentMethodId,
          });

          res.json({
            success: true,
            status: result.status,
            paymentIntentId: result.id,
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should confirm payment intent', async () => {
      const response = await request(app)
        .post('/api/payments/confirm')
        .set('Authorization', 'Bearer valid_token')
        .send({
          paymentIntentId: 'pi_test123',
          paymentMethodId: 'pm_test123',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('succeeded');
    });

    it('should require payment intent ID', async () => {
      const response = await request(app)
        .post('/api/payments/confirm')
        .set('Authorization', 'Bearer valid_token')
        .send({ paymentMethodId: 'pm_test123' });

      expect(response.status).toBe(400);
    });

    it('should handle card declined errors', async () => {
      mockStripe.paymentIntents.confirm.mockRejectedValueOnce({
        type: 'StripeCardError',
        code: 'card_declined',
        message: 'Your card was declined',
      });

      const response = await request(app)
        .post('/api/payments/confirm')
        .set('Authorization', 'Bearer valid_token')
        .send({
          paymentIntentId: 'pi_test123',
          paymentMethodId: 'pm_test123',
        });

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/wallet/deposit', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      app.use((req: any, res: any, next: any) => {
        if (req.headers.authorization === 'Bearer valid_token') {
          req.user = { id: 'user123' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.post('/api/wallet/deposit', async (req: any, res: any) => {
        const { amountCents, paymentIntentId } = req.body;

        if (!amountCents || amountCents <= 0) {
          return res.status(400).json({ error: 'Invalid amount' });
        }

        if (!paymentIntentId) {
          return res.status(400).json({ error: 'Payment intent ID required' });
        }

        try {
          // Verify payment intent
          const intent = await mockStripe.paymentIntents.retrieve(paymentIntentId);
          
          if (intent.status !== 'succeeded') {
            return res.status(400).json({ error: 'Payment not completed' });
          }

          res.json({
            success: true,
            transaction: {
              id: 'tx123',
              type: 'deposit',
              amount: amountCents,
              status: 'completed',
            },
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should create deposit transaction', async () => {
      const response = await request(app)
        .post('/api/wallet/deposit')
        .set('Authorization', 'Bearer valid_token')
        .send({
          amountCents: 5000,
          paymentIntentId: 'pi_test123',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.transaction.type).toBe('deposit');
      expect(response.body.transaction.amount).toBe(5000);
    });

    it('should validate amount', async () => {
      const response = await request(app)
        .post('/api/wallet/deposit')
        .set('Authorization', 'Bearer valid_token')
        .send({
          amountCents: -100,
          paymentIntentId: 'pi_test123',
        });

      expect(response.status).toBe(400);
    });

    it('should require payment intent ID', async () => {
      const response = await request(app)
        .post('/api/wallet/deposit')
        .set('Authorization', 'Bearer valid_token')
        .send({ amountCents: 5000 });

      expect(response.status).toBe(400);
    });

    it('should verify payment is completed', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_test123',
        status: 'requires_payment_method',
      } as any);

      const response = await request(app)
        .post('/api/wallet/deposit')
        .set('Authorization', 'Bearer valid_token')
        .send({
          amountCents: 5000,
          paymentIntentId: 'pi_test123',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('not completed');
    });
  });

  describe('POST /api/wallet/withdraw', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      app.use((req: any, res: any, next: any) => {
        if (req.headers.authorization === 'Bearer valid_token') {
          req.user = { id: 'user123' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.post('/api/wallet/withdraw', async (req: any, res: any) => {
        const { amountCents, destination } = req.body;

        if (!amountCents || amountCents <= 0) {
          return res.status(400).json({ error: 'Invalid amount' });
        }

        if (!destination) {
          return res.status(400).json({ error: 'Destination required' });
        }

        // Check balance
        const balance = 10000;
        if (amountCents > balance) {
          return res.status(400).json({ error: 'Insufficient funds' });
        }

        try {
          await mockStripe.transfers.create({
            amount: amountCents,
            currency: 'usd',
            destination,
          });

          res.json({
            success: true,
            transaction: {
              id: 'tx456',
              type: 'withdrawal',
              amount: amountCents,
              status: 'completed',
            },
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should create withdrawal transaction', async () => {
      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', 'Bearer valid_token')
        .send({
          amountCents: 5000,
          destination: 'acct_test123',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.transaction.type).toBe('withdrawal');
    });

    it('should check sufficient balance', async () => {
      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', 'Bearer valid_token')
        .send({
          amountCents: 99999,
          destination: 'acct_test123',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Insufficient funds');
    });

    it('should require destination', async () => {
      const response = await request(app)
        .post('/api/wallet/withdraw')
        .set('Authorization', 'Bearer valid_token')
        .send({ amountCents: 5000 });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/escrow/create', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      app.use((req: any, res: any, next: any) => {
        if (req.headers.authorization === 'Bearer valid_token') {
          req.user = { id: 'user123' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.post('/api/escrow/create', async (req: any, res: any) => {
        const { bountyId, amountCents } = req.body;

        if (!bountyId) {
          return res.status(400).json({ error: 'Bounty ID required' });
        }

        if (!amountCents || amountCents <= 0) {
          return res.status(400).json({ error: 'Invalid amount' });
        }

        try {
          res.json({
            success: true,
            transaction: {
              id: 'tx_escrow',
              type: 'escrow',
              bountyId,
              amount: amountCents,
              status: 'held',
            },
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should create escrow transaction', async () => {
      const response = await request(app)
        .post('/api/escrow/create')
        .set('Authorization', 'Bearer valid_token')
        .send({
          bountyId: 'bounty123',
          amountCents: 5000,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.transaction.type).toBe('escrow');
      expect(response.body.transaction.bountyId).toBe('bounty123');
    });

    it('should require bounty ID', async () => {
      const response = await request(app)
        .post('/api/escrow/create')
        .set('Authorization', 'Bearer valid_token')
        .send({ amountCents: 5000 });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/escrow/release', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      app.use((req: any, res: any, next: any) => {
        if (req.headers.authorization === 'Bearer valid_token') {
          req.user = { id: 'user123' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.post('/api/escrow/release', async (req: any, res: any) => {
        const { bountyId, hunterId } = req.body;

        if (!bountyId) {
          return res.status(400).json({ error: 'Bounty ID required' });
        }

        if (!hunterId) {
          return res.status(400).json({ error: 'Hunter ID required' });
        }

        try {
          const escrowAmount = 10000;
          const platformFee = escrowAmount * 0.05;
          const hunterAmount = escrowAmount - platformFee;

          res.json({
            success: true,
            transaction: {
              id: 'tx_release',
              type: 'release',
              bountyId,
              hunterId,
              amount: hunterAmount,
              platformFee,
              status: 'completed',
            },
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should release escrow to hunter with platform fee', async () => {
      const response = await request(app)
        .post('/api/escrow/release')
        .set('Authorization', 'Bearer valid_token')
        .send({
          bountyId: 'bounty123',
          hunterId: 'hunter123',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.transaction.type).toBe('release');
      expect(response.body.transaction.amount).toBe(9500);
      expect(response.body.transaction.platformFee).toBe(500);
    });

    it('should require hunter ID', async () => {
      const response = await request(app)
        .post('/api/escrow/release')
        .set('Authorization', 'Bearer valid_token')
        .send({ bountyId: 'bounty123' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/refund', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      app.use((req: any, res: any, next: any) => {
        if (req.headers.authorization === 'Bearer valid_token') {
          req.user = { id: 'user123' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.post('/api/refund', async (req: any, res: any) => {
        const { paymentIntentId, bountyId, reason } = req.body;

        if (!paymentIntentId) {
          return res.status(400).json({ error: 'Payment intent ID required' });
        }

        try {
          const refund = await mockStripe.refunds.create({
            payment_intent: paymentIntentId,
            metadata: { bountyId, reason },
          });

          res.json({
            success: true,
            refund: {
              id: refund.id,
              amount: refund.amount,
              status: refund.status,
            },
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should process refund', async () => {
      const response = await request(app)
        .post('/api/refund')
        .set('Authorization', 'Bearer valid_token')
        .send({
          paymentIntentId: 'pi_test123',
          bountyId: 'bounty123',
          reason: 'Bounty cancelled',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.refund.id).toBe('ref_test123');
      expect(response.body.refund.status).toBe('succeeded');
    });

    it('should require payment intent ID', async () => {
      const response = await request(app)
        .post('/api/refund')
        .set('Authorization', 'Bearer valid_token')
        .send({
          bountyId: 'bounty123',
          reason: 'Test',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/wallet/balance', () => {
    beforeEach(() => {
      app = express();
      
      app.use((req: any, res: any, next: any) => {
        if (req.headers.authorization === 'Bearer valid_token') {
          req.user = { id: 'user123' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.get('/api/wallet/balance', async (req: any, res: any) => {
        try {
          res.json({
            balance: 10000,
            currency: 'usd',
            available: 10000,
            pending: 0,
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should return wallet balance', async () => {
      const response = await request(app)
        .get('/api/wallet/balance')
        .set('Authorization', 'Bearer valid_token');

      expect(response.status).toBe(200);
      expect(response.body.balance).toBe(10000);
      expect(response.body.currency).toBe('usd');
    });

    it('should require authentication', async () => {
      const response = await request(app).get('/api/wallet/balance');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/payment-methods', () => {
    beforeEach(() => {
      app = express();
      
      app.use((req: any, res: any, next: any) => {
        if (req.headers.authorization === 'Bearer valid_token') {
          req.user = { id: 'user123' };
          next();
        } else {
          res.status(401).json({ error: 'Unauthorized' });
        }
      });

      app.get('/api/payment-methods', async (req: any, res: any) => {
        try {
          const methods = await mockStripe.paymentMethods.list({
            customer: 'cus_test123',
            type: 'card',
          });

          res.json({ paymentMethods: methods.data });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    });

    it('should list payment methods', async () => {
      const response = await request(app)
        .get('/api/payment-methods')
        .set('Authorization', 'Bearer valid_token');

      expect(response.status).toBe(200);
      expect(response.body.paymentMethods).toHaveLength(1);
      expect(response.body.paymentMethods[0].id).toBe('pm_test123');
    });
  });

  describe('Error handling scenarios', () => {
    it('should handle rate limit errors', async () => {
      app = express();
      app.use(express.json());
      
      app.use((req: any, res: any, next: any) => {
        req.user = { id: 'user123' };
        next();
      });

      app.post('/api/test-rate-limit', async (req: any, res: any) => {
        res.status(429).json({ error: 'Too many requests' });
      });

      const response = await request(app).post('/api/test-rate-limit');

      expect(response.status).toBe(429);
    });

    it('should handle network timeouts', async () => {
      mockStripe.paymentIntents.create.mockRejectedValueOnce(
        new Error('ETIMEDOUT')
      );

      app = express();
      app.use(express.json());
      app.post('/api/test-timeout', async (req: any, res: any) => {
        try {
          await mockStripe.paymentIntents.create({});
        } catch (error: any) {
          res.status(504).json({ error: 'Gateway timeout' });
        }
      });

      const response = await request(app).post('/api/test-timeout');

      expect(response.status).toBe(504);
    });
  });
});
