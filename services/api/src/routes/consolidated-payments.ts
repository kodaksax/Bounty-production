/**
 * Consolidated Payment Routes
 * Unified payment endpoints consolidating logic from multiple servers
 */

import { FastifyInstance, FastifyReply } from 'fastify';
import { authMiddleware, AuthenticatedRequest } from '../middleware/unified-auth';
import { asyncHandler } from '../middleware/error-handler';
import * as PaymentService from '../services/consolidated-payment-service';
import { z } from 'zod';

/**
 * Request schemas for validation
 */
const createPaymentIntentSchema = z.object({
  amountCents: z.number().int().min(50, 'Amount must be at least $0.50'),
  currency: z.string().toLowerCase().optional().default('usd'),
  metadata: z.record(z.string()).optional(),
  description: z.string().optional(),
  bountyId: z.string().optional(),
});

const confirmPaymentIntentSchema = z.object({
  paymentIntentId: z.string(),
  paymentMethodId: z.string().optional(),
});

const attachPaymentMethodSchema = z.object({
  paymentMethodId: z.string(),
});

const cancelPaymentIntentSchema = z.object({
  reason: z.string().optional(),
});

/**
 * Register all payment routes
 */
export async function registerConsolidatedPaymentRoutes(
  fastify: FastifyInstance
): Promise<void> {
  
  /**
   * POST /payments/create-payment-intent
   * Create a new payment intent
   */
  fastify.post(
    '/payments/create-payment-intent',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['payments'],
        description: 'Create a payment intent for processing a payment',
        body: createPaymentIntentSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              clientSecret: { type: 'string' },
              paymentIntentId: { type: 'string' },
              amount: { type: 'number' },
              currency: { type: 'string' },
            },
            required: ['clientSecret', 'paymentIntentId', 'amount', 'currency'],
          },
        },
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const body = createPaymentIntentSchema.parse(request.body);
      
      const result = await PaymentService.createPaymentIntent({
        userId: request.userId!,
        amountCents: body.amountCents,
        currency: body.currency,
        metadata: {
          ...body.metadata,
          ...(body.bountyId && { bounty_id: body.bountyId }),
        },
        description: body.description,
      });
      
      request.log.info(
        { paymentIntentId: result.paymentIntentId, amount: result.amount },
        'Payment intent created'
      );
      
      return result;
    })
  );
  
  /**
   * POST /payments/confirm
   * Confirm a payment intent
   */
  fastify.post(
    '/payments/confirm',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['payments'],
        description: 'Confirm a payment intent',
        body: confirmPaymentIntentSchema,
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const body = confirmPaymentIntentSchema.parse(request.body);
      
      const result = await PaymentService.confirmPaymentIntent(
        body.paymentIntentId,
        request.userId!,
        body.paymentMethodId
      );
      
      request.log.info(
        { paymentIntentId: body.paymentIntentId, status: result.status },
        'Payment intent confirmed'
      );
      
      return result;
    })
  );
  
  /**
   * GET /payments/methods
   * List user's payment methods
   */
  fastify.get(
    '/payments/methods',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['payments'],
        description: 'List all payment methods for the authenticated user',
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const methods = await PaymentService.listPaymentMethods(request.userId!);
      
      return { paymentMethods: methods };
    })
  );
  
  /**
   * POST /payments/methods
   * Attach a payment method to user
   */
  fastify.post(
    '/payments/methods',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['payments'],
        description: 'Attach a payment method to the user account',
        body: attachPaymentMethodSchema,
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const body = attachPaymentMethodSchema.parse(request.body);
      
      const method = await PaymentService.attachPaymentMethod(
        request.userId!,
        body.paymentMethodId
      );
      
      request.log.info(
        { paymentMethodId: method.id },
        'Payment method attached'
      );
      
      return {
        success: true,
        paymentMethod: method,
      };
    })
  );
  
  /**
   * DELETE /payments/methods/:id
   * Detach a payment method from user
   */
  fastify.delete(
    '/payments/methods/:id',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['payments'],
        description: 'Remove a payment method from the user account',
        params: z.object({
          id: z.string(),
        }),
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      
      await PaymentService.detachPaymentMethod(request.userId!, id);
      
      request.log.info({ paymentMethodId: id }, 'Payment method detached');
      
      return { success: true };
    })
  );
  
  /**
   * POST /payments/setup-intent
   * Create a setup intent for adding payment method without charge
   */
  fastify.post(
    '/payments/setup-intent',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['payments'],
        description: 'Create a setup intent for adding a payment method',
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const result = await PaymentService.createSetupIntent(request.userId!);
      
      request.log.info(
        { setupIntentId: result.setupIntentId },
        'Setup intent created'
      );
      
      return result;
    })
  );
  
  /**
   * POST /payments/:id/cancel
   * Cancel a payment intent
   */
  fastify.post(
    '/payments/:id/cancel',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['payments'],
        description: 'Cancel a payment intent',
        params: z.object({
          id: z.string(),
        }),
        body: cancelPaymentIntentSchema,
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = cancelPaymentIntentSchema.parse(request.body);
      
      await PaymentService.cancelPaymentIntent(id, request.userId!, body.reason);
      
      request.log.info({ paymentIntentId: id }, 'Payment intent cancelled');
      
      return { success: true };
    })
  );
  
  /**
   * GET /payments/:id/status
   * Get payment intent status
   */
  fastify.get(
    '/payments/:id/status',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['payments'],
        description: 'Get payment intent status',
        params: z.object({
          id: z.string(),
        }),
      },
    },
    asyncHandler(async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      
      const status = await PaymentService.getPaymentIntentStatus(id, request.userId!);
      
      return status;
    })
  );
  
  fastify.log.info('Consolidated payment routes registered');
}
