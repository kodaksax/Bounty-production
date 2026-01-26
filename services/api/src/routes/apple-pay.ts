import { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';

export async function registerApplePayRoutes(fastify: FastifyInstance) {
  const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '';

  if (!stripeKey) {
    console.warn('[apple-pay] STRIPE_SECRET_KEY not provided — Apple Pay routes will be disabled');
    // Register no-op routes that return 501 so callers get a clear response instead of startup crash
    fastify.post('/apple-pay/payment-intent', async (request, reply) => {
      return reply.code(501).send({ error: 'Apple Pay not configured on this server' });
    });

    fastify.post('/apple-pay/confirm', async (request, reply) => {
      return reply.code(501).send({ error: 'Apple Pay not configured on this server' });
    });

    return;
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2025-12-15.clover',
  });

  // Proceed to register real routes below

  /**
   * Create PaymentIntent for Apple Pay
   */
  /**
   * Create PaymentIntent for Apple Pay
   */
  fastify.post('/apple-pay/payment-intent', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { amountCents, bountyId, description } = request.body as {
        amountCents: number;
        bountyId?: string;
        description?: string;
      };

      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Validate amount
      if (!amountCents || amountCents < 50) {
        return reply.code(400).send({
          error: 'Amount must be at least $0.50'
        });
      }

      // Create PaymentIntent with Apple Pay
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        payment_method_types: ['card'], // Apple Pay uses card payment method
        metadata: {
          user_id: request.userId,
          bounty_id: bountyId || '',
          payment_method: 'apple_pay',
        },
        description: description || 'BountyExpo Payment',
      });

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      };
    } catch (error) {
      console.error('Error creating Apple Pay payment intent:', error);
      return reply.code(500).send({
        error: 'Failed to create payment intent'
      });
    }
  });

  /**
   * Confirm Apple Pay payment
   */
  fastify.post('/apple-pay/confirm', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { paymentIntentId, bountyId } = request.body as {
        paymentIntentId: string;
        bountyId?: string;
      };

      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Retrieve payment intent to check status
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (paymentIntent.status === 'succeeded') {
        // Payment successful - record transaction
        // Add to wallet, send email receipt, etc.

        return {
          success: true,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
        };
      } else {
        return {
          success: false,
          status: paymentIntent.status,
          error: 'Payment not completed',
        };
      }
    } catch (error) {
      console.error('Error confirming Apple Pay payment:', error);
      return reply.code(500).send({
        error: 'Failed to confirm payment'
      });
    }
  });
}
