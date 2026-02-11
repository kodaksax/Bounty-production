import { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { createDeposit } from '../services/consolidated-wallet-service';
import { logger } from '../services/logger';
import { applePayReceiptService } from '../services/apple-pay-receipt-service';

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
    apiVersion: '2026-01-28.clover',
  });

  // Proceed to register real routes below

  /**
   * Create PaymentIntent for Apple Pay
   */
  fastify.post('/apple-pay/payment-intent', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const { amountCents, bountyId, description, idempotencyKey } = request.body as {
        amountCents: number;
        bountyId?: string;
        description?: string;
        idempotencyKey?: string;
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

      // Validate maximum amount (e.g., $10,000 limit for safety)
      if (amountCents > 1000000) {
        return reply.code(400).send({
          error: 'Amount exceeds maximum allowed ($10,000.00)'
        });
      }

      logger.info({
        userId: request.userId,
        amountCents,
        bountyId,
        idempotencyKey,
      }, '[ApplePay] Creating payment intent');

      // Create PaymentIntent with Apple Pay
      const createParams: any = {
        amount: amountCents,
        currency: 'usd',
        payment_method_types: ['card'], // Apple Pay uses card payment method
        metadata: {
          user_id: request.userId,
          bounty_id: bountyId || '',
          payment_method: 'apple_pay',
        },
        description: description || 'BountyExpo Wallet Deposit',
      };

      // Apply idempotency key via request options (not as a parameter)
      const paymentIntent = idempotencyKey
        ? await stripe.paymentIntents.create(createParams, { idempotencyKey })
        : await stripe.paymentIntents.create(createParams);

      logger.info({
        paymentIntentId: paymentIntent.id,
        userId: request.userId,
        amount: amountCents / 100,
      }, '[ApplePay] Payment intent created successfully');

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      };
    } catch (error: any) {
      logger.error({
        error: error.message,
        code: error.code,
        type: error.type,
        userId: request.userId,
        body: request.body,
      }, '[ApplePay] Error creating Apple Pay payment intent');

      // Return user-friendly error message
      if (error.type === 'StripeCardError') {
        return reply.code(400).send({
          error: 'Card error: ' + error.message
        });
      } else if (error.type === 'StripeInvalidRequestError') {
        return reply.code(400).send({
          error: 'Invalid request: ' + error.message
        });
      } else {
        return reply.code(500).send({
          error: 'Failed to create payment intent'
        });
      }
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

      // SECURITY: Verify the payment intent belongs to the requesting user
      if (paymentIntent.metadata?.user_id !== request.userId) {
        logger.warn({
          paymentIntentId,
          requestUserId: request.userId,
          paymentIntentUserId: paymentIntent.metadata?.user_id,
        }, '[ApplePay] Payment intent user ID mismatch');
        return reply.code(403).send({ error: 'Payment intent does not belong to this user' });
      }

      if (paymentIntent.status === 'succeeded') {
        // Payment successful - record transaction in database
        const amountUSD = paymentIntent.amount / 100; // Convert cents to dollars
        
        try {
          // Create deposit transaction and update wallet balance atomically
          const transaction = await createDeposit(
            request.userId,
            amountUSD,
            paymentIntent.id,
            `apple_pay_${paymentIntent.id}` // Idempotency key
          );

          logger.info({
            userId: request.userId,
            paymentIntentId: paymentIntent.id,
            amount: amountUSD,
            transactionId: transaction.id
          }, '[ApplePay] Successfully recorded deposit transaction');

          // Generate and send receipt asynchronously (don't block response)
          // Note: Email delivery is not yet implemented because userEmail is unavailable here
          // TODO: Once user email is accessible, re-introduce sendReceiptEmail with userEmail/userName populated
          applePayReceiptService.sendReceiptEmail({
            transactionId: transaction.id,
            userId: request.userId,
            amount: amountUSD,
            paymentIntentId: paymentIntent.id,
            paymentMethod: 'Apple Pay',
            timestamp: new Date(),
            // TODO: Fetch user email from database
            // userEmail: user.email,
            // userName: user.name,
          }).catch(error => {
            logger.error({
              error,
              transactionId: transaction.id
            }, '[ApplePay] Failed to send receipt email');
          });

          // Log receipt details for development (only in non-production)
          if (process.env.NODE_ENV !== 'production') {
            applePayReceiptService.logReceipt({
              transactionId: transaction.id,
              userId: request.userId,
              amount: amountUSD,
              paymentIntentId: paymentIntent.id,
              paymentMethod: 'Apple Pay',
              timestamp: new Date(),
            });
          }

          return {
            success: true,
            status: paymentIntent.status,
            amount: paymentIntent.amount,
            transactionId: transaction.id,
          };
        } catch (dbError) {
          // Log but don't fail - payment was successful even if DB recording failed
          logger.error({
            error: dbError,
            userId: request.userId,
            paymentIntentId: paymentIntent.id,
            amount: amountUSD
          }, '[ApplePay] Failed to record transaction in database');

          // Return success since payment succeeded, but note DB issue and pending wallet credit
          return {
            success: true,
            status: paymentIntent.status,
            amount: paymentIntent.amount,
            warning: 'Payment succeeded but wallet credit is pending. Balance will be reconciled via webhook or retry.',
          };
        }
      } else {
        return {
          success: false,
          status: paymentIntent.status,
          error: 'Payment not completed',
        };
      }
    } catch (error) {
      logger.error({
        error,
        userId: request.userId,
        body: request.body
      }, '[ApplePay] Error confirming Apple Pay payment');
      
      return reply.code(500).send({
        error: 'Failed to confirm payment'
      });
    }
  });
}
