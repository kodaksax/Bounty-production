import { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { logger } from '../services/logger';
import { walletService } from '../services/wallet-service';

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
    let idempotencyKey: string | undefined;
    try {
      const body = request.body as {
        amountCents: number;
        currency?: string;
        metadata?: Record<string, string>;
        idempotencyKey?: string;
      };
      const { amountCents, currency = 'usd', metadata = {} } = body;
      idempotencyKey = body.idempotencyKey;

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

  // Track processed webhook events to prevent replay attacks
  // NOTE: In production, this should be stored in Redis or database for persistence across restarts
  const processedWebhookEvents = new Map<string, number>();
  const WEBHOOK_EVENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  function cleanupProcessedWebhookEvents() {
    const now = Date.now();
    for (const [eventId, timestamp] of processedWebhookEvents.entries()) {
      if (now - timestamp >= WEBHOOK_EVENT_TTL_MS) {
        processedWebhookEvents.delete(eventId);
      }
    }
  }

  /**
   * Webhook handler for Stripe events
   * Handles payment confirmations, failures, refunds, etc.
   * 
   * Security notes:
   * - Signature verification protects against forged webhooks
   * - Event ID tracking prevents replay attacks
   * - No authMiddleware needed - Stripe signature is the authentication
   */
  fastify.post('/payments/webhook', {
    config: {
      rawBody: true,
    }
  }, async (request, reply) => {
    const sig = request.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // Validate webhook secret is configured
    if (!webhookSecret) {
      logger.error('[payments] STRIPE_WEBHOOK_SECRET not configured - webhook endpoint disabled');
      return reply.code(500).send({ error: 'Webhook not configured on server' });
    }

    // Validate signature header is present
    if (!sig) {
      logger.warn('[payments] Missing stripe-signature header');
      return reply.code(400).send({ error: 'Missing signature' });
    }

    let event: Stripe.Event;

    try {
      // Get raw body for signature verification
      // Fastify with rawBody: true stores it in request.rawBody
      // Fallback to stringified body if rawBody not available
      const rawBody = (request as any).rawBody;
      if (!rawBody) {
        logger.warn('[payments] rawBody not available - ensure Fastify rawBody plugin is configured');
      }
      const body = rawBody || (typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
      
      // Verify webhook signature - this validates the webhook came from Stripe
      // and hasn't been tampered with
      event = stripe.webhooks.constructEvent(
        body,
        sig,
        webhookSecret
      );
    } catch (err: any) {
      logger.error({ err: err.message }, '[payments] Webhook signature verification failed');
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    // Replay attack protection: check if we've already processed this event
    if (processedWebhookEvents.has(event.id)) {
      logger.info(`[payments] Ignoring duplicate webhook event: ${event.id}`);
      return { received: true, duplicate: true };
    }

    // Mark event as processed before handling (prevents concurrent duplicate processing)
    processedWebhookEvents.set(event.id, Date.now());
    cleanupProcessedWebhookEvents();

    // Handle the event
    try {
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
          // TODO: Notify user of payment failure
          // TODO: Track failed payment attempts for fraud detection
          break;
        }

        case 'payment_intent.canceled': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          logger.info(`[payments] PaymentIntent ${paymentIntent.id} canceled`);
          break;
        }

        case 'payment_intent.requires_action': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          logger.info(`[payments] PaymentIntent ${paymentIntent.id} requires action (3DS)`);
          // Payment requires additional authentication (3D Secure)
          // Client should handle this via the next_action field
          break;
        }

        case 'setup_intent.succeeded': {
          const setupIntent = event.data.object as Stripe.SetupIntent;
          logger.info(`[payments] SetupIntent ${setupIntent.id} succeeded, payment method: ${setupIntent.payment_method}`);
          // TODO: Update user's payment method status in database
          break;
        }

        case 'setup_intent.setup_failed': {
          const setupIntent = event.data.object as Stripe.SetupIntent;
          logger.warn(`[payments] SetupIntent ${setupIntent.id} failed`);
          break;
        }

        case 'charge.refunded': {
          const charge = event.data.object as Stripe.Charge;
          logger.info(`[payments] Charge ${charge.id} refunded`);
          // Record refund in wallet transactions
          // TODO: Update bounty status if refund is for escrow
          break;
        }

        case 'charge.dispute.created': {
          const dispute = event.data.object as Stripe.Dispute;
          logger.warn(`[payments] Dispute created for charge ${dispute.charge}`);
          // TODO: Notify admin team
          // TODO: Freeze related funds
          break;
        }

        case 'charge.dispute.closed': {
          const dispute = event.data.object as Stripe.Dispute;
          logger.info(`[payments] Dispute closed for charge ${dispute.charge}, status: ${dispute.status}`);
          break;
        }

        // Stripe Connect Account Events
        case 'account.updated': {
          const account = event.data.object as Stripe.Account;
          logger.info(`[payments] Connect account ${account.id} updated`);
          // Track verification status changes
          if (account.details_submitted) {
            logger.info(`[payments] Connect account ${account.id} details submitted`);
          }
          if (account.charges_enabled) {
            logger.info(`[payments] Connect account ${account.id} charges enabled`);
          }
          if (account.payouts_enabled) {
            logger.info(`[payments] Connect account ${account.id} payouts enabled`);
          }
          // TODO: Update user's Connect account status in database
          // TODO: Notify user if action required (requirements.currently_due)
          break;
        }

        case 'account.external_account.created': {
          const externalAccount = event.data.object as Stripe.BankAccount | Stripe.Card;
          logger.info(`[payments] External account added: ${externalAccount.id}`);
          break;
        }

        case 'account.external_account.deleted': {
          const externalAccount = event.data.object as Stripe.BankAccount | Stripe.Card;
          logger.info(`[payments] External account removed: ${externalAccount.id}`);
          break;
        }

        // Payout Events
        case 'payout.created': {
          const payout = event.data.object as Stripe.Payout;
          logger.info(`[payments] Payout created: ${payout.id}, amount: ${payout.amount}`);
          break;
        }

        case 'payout.paid': {
          const payout = event.data.object as Stripe.Payout;
          logger.info(`[payments] Payout paid: ${payout.id}`);
          // TODO: Update transaction status in database
          break;
        }

        case 'payout.failed': {
          const payout = event.data.object as Stripe.Payout;
          logger.error(`[payments] Payout failed: ${payout.id}`);
          // TODO: Notify user and admin
          break;
        }

        // Transfer Events (for Connect)
        case 'transfer.created': {
          const transfer = event.data.object as Stripe.Transfer;
          logger.info(`[payments] Transfer created: ${transfer.id}, amount: ${transfer.amount}`);
          break;
        }

        case 'transfer.reversed': {
          const transfer = event.data.object as Stripe.Transfer;
          logger.warn(`[payments] Transfer reversed: ${transfer.id}`);
          break;
        }

        // Radar Events (Fraud Detection)
        case 'radar.early_fraud_warning.created': {
          const warning = event.data.object as Stripe.Radar.EarlyFraudWarning;
          logger.error(`[payments] Fraud warning for charge ${warning.charge}`);
          // TODO: Immediately freeze related funds
          // TODO: Alert fraud team
          break;
        }

        case 'review.opened': {
          const review = event.data.object as Stripe.Review;
          logger.warn(`[payments] Review opened for payment intent ${review.payment_intent}`);
          // TODO: Hold funds pending review
          break;
        }

        case 'review.closed': {
          const review = event.data.object as Stripe.Review;
          logger.info(`[payments] Review closed for payment intent ${review.payment_intent}, reason: ${review.closed_reason}`);
          break;
        }

        default:
          logger.info(`[payments] Unhandled webhook event: ${event.type}`);
      }
    } catch (handlerError: any) {
      // Log error but still return 200 to prevent Stripe from retrying
      // (we've already recorded the event as processed)
      logger.error({ err: handlerError }, `[payments] Error handling webhook event ${event.id}`);
    }

    return { received: true };
  });

  /**
   * Add bank account (ACH) as a payment method
   * Creates a bank account token and attaches it to the customer
   */
  fastify.post('/payments/bank-accounts', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { 
        accountHolderName, 
        routingNumber, 
        accountNumber, 
        accountType 
      } = request.body as {
        accountHolderName: string;
        routingNumber: string;
        accountNumber: string;
        accountType: 'checking' | 'savings';
      };

      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Validate input
      if (!accountHolderName || !routingNumber || !accountNumber || !accountType) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      if (routingNumber.length !== 9) {
        return reply.code(400).send({ error: 'Invalid routing number' });
      }

      if (accountNumber.length < 4 || accountNumber.length > 17) {
        return reply.code(400).send({ error: 'Invalid account number' });
      }

      if (accountType !== 'checking' && accountType !== 'savings') {
        return reply.code(400).send({ error: 'Account type must be checking or savings' });
      }

      // Get or create Stripe customer
      const customerId = await getOrCreateStripeCustomer(stripe, request.userId);

      // Create bank account token
      const token = await stripe.tokens.create({
        bank_account: {
          country: 'US',
          currency: 'usd',
          account_holder_name: accountHolderName,
          account_holder_type: 'individual',
          routing_number: routingNumber,
          account_number: accountNumber,
        },
      });

      // Attach bank account to customer
      const bankAccount = await stripe.customers.createSource(customerId, {
        source: token.id,
      });

      // Type guard to safely access Stripe bank account properties
      interface StripeBankAccount {
        id: string;
        object: string;
        last4?: string;
        bank_name?: string;
        [key: string]: any;
      }

      const typedBankAccount = bankAccount as StripeBankAccount;
      const last4 = typedBankAccount.last4 || accountNumber.slice(-4);
      const bankName = typedBankAccount.bank_name;

      logger.info(`[payments] Added bank account (last4: ${last4}) for user ${request.userId}`);

      return {
        success: true,
        bankAccount: {
          id: bankAccount.id,
          last4,
          bankName,
          accountType,
        },
      };
    } catch (error: any) {
      logger.error('[payments] Error adding bank account:', error);
      
      // Use Stripe error codes for reliable error handling
      let errorMessage = 'Failed to add bank account';
      const stripeError = error as Stripe.StripeError;
      
      if (stripeError.type === 'StripeInvalidRequestError') {
        // Check error code or param for more reliable error detection
        if (stripeError.code === 'invalid_routing_number' || stripeError.param === 'bank_account[routing_number]') {
          errorMessage = 'Invalid routing number';
        } else if (stripeError.code === 'invalid_account_number' || stripeError.param === 'bank_account[account_number]') {
          errorMessage = 'Invalid account number';
        }
      }
      
      return reply.code(400).send({ error: errorMessage });
    }
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
