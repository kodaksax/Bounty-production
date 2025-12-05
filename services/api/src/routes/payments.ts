import { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { walletService } from '../services/wallet-service';
import { logger } from '../services/logger';

// Idempotency tracking for duplicate payment prevention
// NOTE: In production, this should be stored in a persistent database (e.g., Redis or PostgreSQL)
// The in-memory implementation below is suitable for development/single-instance deployments only.
// For multi-instance production deployments, implement idempotency via:
// 1. Store idempotency keys in Redis with TTL
// 2. Or use PostgreSQL with a unique constraint on idempotency_key
const pendingPayments = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function cleanupExpiredIdempotencyKeys() {
  const now = Date.now();
  for (const [key, timestamp] of pendingPayments.entries()) {
    if (now - timestamp >= IDEMPOTENCY_TTL_MS) {
      pendingPayments.delete(key);
    }
  }
}

export async function registerPaymentRoutes(fastify: FastifyInstance) {
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';

  if (!stripeKey) {
    logger.warn('[payments] STRIPE_SECRET_KEY not provided — Payment routes will return 501');
    
    // Register fallback routes that return 501
    fastify.post('/payments/create-payment-intent', async (request, reply) => {
      return reply.code(501).send({ error: 'Stripe not configured on this server' });
    });

    fastify.post('/payments/create-setup-intent', async (request, reply) => {
      return reply.code(501).send({ error: 'Stripe not configured on this server' });
    });

    fastify.get('/payments/methods', async (request, reply) => {
      return reply.code(501).send({ error: 'Stripe not configured on this server' });
    });

    fastify.delete('/payments/methods/:paymentMethodId', async (request, reply) => {
      return reply.code(501).send({ error: 'Stripe not configured on this server' });
    });

    fastify.post('/payments/confirm', async (request, reply) => {
      return reply.code(501).send({ error: 'Stripe not configured on this server' });
    });

    return;
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2025-08-27.basil',
  });

  /**
   * Create PaymentIntent for collecting payments
   * Used for deposits, bounty payments, etc.
   */
  fastify.post('/payments/create-payment-intent', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { amountCents, currency = 'usd', metadata = {}, idempotencyKey } = request.body as {
        amountCents: number;
        currency?: string;
        metadata?: Record<string, string>;
        idempotencyKey?: string;
      };

      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Validate amount
      if (!amountCents || amountCents < 50) {
        return reply.code(400).send({
          error: 'Amount must be at least $0.50 (50 cents)'
        });
      }

      // Check for duplicate submission
      if (idempotencyKey) {
        if (pendingPayments.has(idempotencyKey)) {
          return reply.code(409).send({
            error: 'Duplicate payment request. Please wait for the current payment to complete.',
            code: 'duplicate_transaction',
          });
        }
        pendingPayments.set(idempotencyKey, Date.now());
        cleanupExpiredIdempotencyKeys();
      }

      // Create PaymentIntent with proper configuration
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
        metadata: {
          user_id: request.userId,
          purpose: metadata.purpose || 'wallet_deposit',
          ...metadata,
        },
        description: `BountyExpo payment for ${request.userId}`,
      }, {
        // Use idempotency key if provided
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });

      logger.info(`[payments] Created PaymentIntent ${paymentIntent.id} for user ${request.userId}, amount: ${amountCents}`);

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
      };
    } catch (error: any) {
      logger.error('[payments] Error creating payment intent:', error);
      
      // Clean up idempotency key on failure to allow retry
      if (idempotencyKey) {
        pendingPayments.delete(idempotencyKey);
      }
      
      // Handle specific Stripe errors
      if (error.type === 'StripeCardError') {
        return reply.code(400).send({
          error: error.message,
          code: error.code,
          decline_code: error.decline_code,
        });
      }

      if (error.type === 'StripeInvalidRequestError') {
        return reply.code(400).send({
          error: 'Invalid payment request',
          code: error.code,
        });
      }

      return reply.code(500).send({
        error: 'Failed to create payment intent'
      });
    }
  });

  /**
   * Create SetupIntent for saving payment methods without charging
   * This is the PCI-compliant way to save cards
   */
  fastify.post('/payments/create-setup-intent', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { usage = 'off_session' } = request.body as {
        usage?: 'on_session' | 'off_session';
      };

      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Get or create Stripe customer for this user
      const customerId = await getOrCreateStripeCustomer(stripe, request.userId);

      // Create SetupIntent
      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        usage,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
        metadata: {
          user_id: request.userId,
        },
      });

      logger.info(`[payments] Created SetupIntent ${setupIntent.id} for user ${request.userId}`);

      return {
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
      };
    } catch (error: any) {
      logger.error('[payments] Error creating setup intent:', error);
      return reply.code(500).send({
        error: 'Failed to create setup intent'
      });
    }
  });

  /**
   * Get saved payment methods for the current user
   */
  fastify.get('/payments/methods', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Get customer ID
      const customerId = await getStripeCustomerId(request.userId);
      
      if (!customerId) {
        return { paymentMethods: [] };
      }

      // Get payment methods from Stripe
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });

      return {
        paymentMethods: paymentMethods.data.map(pm => ({
          id: pm.id,
          type: pm.type,
          card: {
            brand: pm.card?.brand,
            last4: pm.card?.last4,
            exp_month: pm.card?.exp_month,
            exp_year: pm.card?.exp_year,
          },
          created: pm.created,
        })),
      };
    } catch (error: any) {
      logger.error('[payments] Error listing payment methods:', error);
      return reply.code(500).send({
        error: 'Failed to list payment methods'
      });
    }
  });

  /**
   * Delete (detach) a saved payment method
   */
  fastify.delete('/payments/methods/:paymentMethodId', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { paymentMethodId } = request.params as { paymentMethodId: string };

      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Verify the payment method belongs to this user's customer
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
      const customerId = await getStripeCustomerId(request.userId);

      if (paymentMethod.customer !== customerId) {
        return reply.code(403).send({ error: 'Payment method does not belong to this user' });
      }

      // Detach the payment method
      await stripe.paymentMethods.detach(paymentMethodId);

      logger.info(`[payments] Detached payment method ${paymentMethodId} for user ${request.userId}`);

      return { success: true };
    } catch (error: any) {
      logger.error('[payments] Error detaching payment method:', error);
      return reply.code(500).send({
        error: 'Failed to remove payment method'
      });
    }
  });

  /**
   * Confirm payment and record in wallet
   * Called after client-side payment confirmation
   */
  fastify.post('/payments/confirm', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { paymentIntentId } = request.body as {
        paymentIntentId: string;
      };

      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Retrieve the payment intent to verify status
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (paymentIntent.status !== 'succeeded') {
        return reply.code(400).send({
          error: 'Payment not yet completed',
          status: paymentIntent.status,
        });
      }

      // Verify user ownership via metadata
      if (paymentIntent.metadata.user_id !== request.userId) {
        return reply.code(403).send({ error: 'Payment does not belong to this user' });
      }

      // Record the deposit in wallet (if not already recorded via webhook)
      const purpose = paymentIntent.metadata.purpose;
      if (purpose === 'wallet_deposit') {
        try {
          await walletService.createTransaction({
            user_id: request.userId,
            type: 'deposit',
            amount: paymentIntent.amount / 100,
          });
        } catch (txError: any) {
          // Transaction might already exist from webhook, log but don't fail
          logger.warn({ err: txError }, '[payments] Transaction may already exist');
        }
      }

      // Clean up idempotency tracking
      const idempotencyKey = paymentIntent.metadata?.idempotency_key;
      if (idempotencyKey) {
        pendingPayments.delete(idempotencyKey);
      }

      logger.info(`[payments] Confirmed payment ${paymentIntentId} for user ${request.userId}`);

      return {
        success: true,
        paymentIntentId,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
      };
    } catch (error: any) {
      logger.error('[payments] Error confirming payment:', error);
      return reply.code(500).send({
        error: 'Failed to confirm payment'
      });
    }
  });

  /**
   * Webhook handler for Stripe events
   * Handles payment confirmations, failures, refunds, etc.
   */
  fastify.post('/payments/webhook', {
    config: {
      rawBody: true,
    }
  }, async (request, reply) => {
    const sig = request.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.warn('[payments] Webhook secret not configured');
      return reply.code(400).send({ error: 'Webhook not configured' });
    }

    let event: Stripe.Event;

    try {
      // Verify webhook signature
      const body = (request as any).rawBody || request.body;
      event = stripe.webhooks.constructEvent(
        typeof body === 'string' ? body : JSON.stringify(body),
        sig as string,
        webhookSecret
      );
    } catch (err: any) {
      logger.error('[payments] Webhook signature verification failed:', err.message);
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        logger.info(`[payments] PaymentIntent ${paymentIntent.id} succeeded`);
        
        // Record deposit if wallet_deposit purpose
        if (paymentIntent.metadata.purpose === 'wallet_deposit') {
          try {
            await walletService.createTransaction({
              user_id: paymentIntent.metadata.user_id,
              type: 'deposit',
              amount: paymentIntent.amount / 100,
            });
          } catch (txError: any) {
            logger.warn({ err: txError }, '[payments] Transaction may already exist');
          }
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        logger.warn({ error: paymentIntent.last_payment_error?.message }, `[payments] PaymentIntent ${paymentIntent.id} failed`);
        break;
      }

      case 'setup_intent.succeeded': {
        const setupIntent = event.data.object as Stripe.SetupIntent;
        logger.info(`[payments] SetupIntent ${setupIntent.id} succeeded, payment method: ${setupIntent.payment_method}`);
        break;
      }

      default:
        logger.info(`[payments] Unhandled webhook event: ${event.type}`);
    }

    return { received: true };
  });
}

// Helper functions

/**
 * Customer ID storage
 * 
 * IMPORTANT: This in-memory Map is for development/testing only.
 * In production, customer IDs should be stored in the database (users table)
 * with the stripe_customer_id field. The users schema already has this field.
 * 
 * TODO: Replace this with database queries when deploying to production:
 * - On lookup: SELECT stripe_customer_id FROM users WHERE id = userId
 * - On create: UPDATE users SET stripe_customer_id = customerId WHERE id = userId
 */
const customerIds = new Map<string, string>();

async function getStripeCustomerId(userId: string): Promise<string | null> {
  return customerIds.get(userId) || null;
}

async function getOrCreateStripeCustomer(stripe: Stripe, userId: string): Promise<string> {
  // Check cache first
  const existingId = customerIds.get(userId);
  if (existingId) {
    return existingId;
  }

  // In production, check database first
  // For now, create a new customer
  const customer = await stripe.customers.create({
    metadata: {
      user_id: userId,
    },
  });

  customerIds.set(userId, customer.id);
  return customer.id;
}
