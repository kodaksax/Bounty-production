import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { db } from '../db/connection';
import { bounties } from '../db/schema';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { getRequestContext, logErrorWithContext } from '../middleware/request-context';
import {
  checkIdempotencyKey,
  removeIdempotencyKey,
  storeIdempotencyKey
} from '../services/idempotency-service';
import { stripeConnectService } from '../services/stripe-connect-service';

/**
 * Validation schemas for wallet operations
 */
const depositSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  paymentIntentId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

const withdrawSchema = z.object({
  amount: z.number().min(1, 'Minimum withdrawal is $1.00'),
  destination: z.string().optional(), // Now optional if service has a default logic, but usually needed
  idempotencyKey: z.string().optional(),
});

const transferSchema = z.object({
  amount: z.number().min(1, 'Minimum transfer is $1.00'),
  currency: z.string().toLowerCase().optional().default('usd'),
  idempotencyKey: z.string().optional(),
});

const escrowSchema = z.object({
  bountyId: z.string().uuid('Invalid bounty ID'),
  amount: z.number().min(1, 'Minimum escrow is $1.00'),
  title: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export async function registerWalletRoutes(fastify: FastifyInstance) {
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  let stripe: Stripe | null = null;

  if (stripeKey) {
    stripe = new Stripe(stripeKey, {
      apiVersion: '2025-08-27.basil',
    });
  }

  /**
   * Get user's wallet balance
   */
  fastify.get('/wallet/balance', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { balance, currency } = await ConsolidatedWalletService.getBalance(request.userId);

      return {
        balance,
        balanceCents: Math.round(balance * 100),
        currency,
      };
    } catch (error) {
      logErrorWithContext(request, error, {
        operation: 'fetch_wallet_balance',
        userId: request.userId,
      });
      return reply.code(500).send({
        error: 'Failed to fetch wallet balance',
        requestId: getRequestContext(request).requestId,
      });
    }
  });

  /**
   * Get user's wallet transactions
   */
  fastify.get('/wallet/transactions', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { page = '1', limit = '20', type } = request.query as {
        page?: string;
        limit?: string;
        type?: string;
      };

      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
      const offset = (pageNum - 1) * limitNum;

      const result = await ConsolidatedWalletService.getTransactions(request.userId, {
        type: type as any,
        limit: limitNum,
        offset: offset,
      });

      // Transform to client format
      const transformedTransactions = result.transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        date: t.created_at,
        details: {
          title: t.description, // Consolidated service uses description field
          bounty_id: t.bounty_id,
          status: t.status,
          stripe_transfer_id: t.stripe_transfer_id,
          metadata: t.metadata,
        },
      }));

      const hasMore = offset + transformedTransactions.length < result.total;

      return {
        transactions: transformedTransactions,
        page: pageNum,
        limit: limitNum,
        total: result.total,
        hasMore,
      };
    } catch (error) {
      logErrorWithContext(request, error, {
        operation: 'fetch_wallet_transactions',
        userId: request.userId,
      });
      return reply.code(500).send({
        error: 'Failed to fetch wallet transactions',
        requestId: getRequestContext(request).requestId,
      });
    }
  });

  /**
   * Create a deposit transaction (add money to wallet)
   * Note: Real deposits are handled via consolidated-webhooks.ts when Stripe confirms payment.
   * This endpoint can be used for manual deposits or internal tracking.
   */
  fastify.post('/wallet/deposit', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    let idempotencyKey: string | undefined;
    try {
      const body = depositSchema.parse(request.body);
      const { amount, paymentIntentId } = body;
      idempotencyKey = body.idempotencyKey;

      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (idempotencyKey) {
        const isDuplicate = await checkIdempotencyKey(idempotencyKey);
        if (isDuplicate) {
          return reply.code(409).send({
            error: 'Duplicate request detected',
            code: 'duplicate_transaction'
          });
        }
        await storeIdempotencyKey(idempotencyKey);
      }

      const transaction = await ConsolidatedWalletService.createDeposit(
        request.userId,
        amount,
        paymentIntentId || `man_${Date.now()}`,
        idempotencyKey
      );

      return {
        success: true,
        transaction,
      };
    } catch (error) {
      if (idempotencyKey) {
        await removeIdempotencyKey(idempotencyKey);
      }
      logErrorWithContext(request, error, {
        operation: 'create_deposit',
        userId: request.userId,
      });
      return reply.code(500).send({
        error: 'Failed to create deposit',
        requestId: getRequestContext(request).requestId,
      });
    }
  });

  /**
   * Create a withdrawal transaction (withdraw to bank)
   */
  fastify.post('/wallet/withdraw', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    let idempotencyKey: string | undefined;
    try {
      const body = withdrawSchema.parse(request.body);
      const { amount, destination } = body;
      idempotencyKey = body.idempotencyKey;

      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (idempotencyKey) {
        const isDuplicate = await checkIdempotencyKey(idempotencyKey);
        if (isDuplicate) {
          return reply.code(409).send({
            error: 'Duplicate request detected',
            code: 'duplicate_transaction'
          });
        }
        await storeIdempotencyKey(idempotencyKey);
      }

      // Check Connect account status
      const connectStatus = await stripeConnectService.getConnectStatus(request.userId);
      if (!connectStatus.hasStripeAccount || !connectStatus.payoutsEnabled) {
        if (idempotencyKey) await removeIdempotencyKey(idempotencyKey);
        return reply.code(400).send({
          error: 'Stripe Connect account required for withdrawals. Please complete onboarding.',
          requiresOnboarding: true,
        });
      }

      const stripeAccountId = destination || connectStatus.stripeAccountId;
      if (!stripeAccountId) {
        if (idempotencyKey) await removeIdempotencyKey(idempotencyKey);
        return reply.code(400).send({ error: 'No withdrawal destination provided' });
      }

      const transaction = await ConsolidatedWalletService.createWithdrawal(
        request.userId,
        amount,
        stripeAccountId,
        idempotencyKey
      );

      const { balance } = await ConsolidatedWalletService.getBalance(request.userId);

      return {
        success: true,
        transaction,
        newBalance: balance,
        estimatedArrival: '1-2 business days',
      };
    } catch (error: any) {
      if (idempotencyKey) {
        await removeIdempotencyKey(idempotencyKey);
      }
      logErrorWithContext(request, error, {
        operation: 'create_withdrawal',
        userId: request.userId,
      });

      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({
        error: error.message || 'Failed to create withdrawal',
        requestId: getRequestContext(request).requestId,
      });
    }
  });


  /**
   * Verify Stripe Connect onboarding status for withdrawals
   */
  fastify.post('/connect/verify-onboarding', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const status = await stripeConnectService.getConnectStatus(request.userId);

      return {
        onboarded: status.hasStripeAccount && status.detailsSubmitted && status.payoutsEnabled,
        accountId: status.stripeAccountId,
        chargesEnabled: status.chargesEnabled,
        payoutsEnabled: status.payoutsEnabled,
        requiresAction: status.requiresAction,
        currentlyDue: status.currentlyDue,
      };
    } catch (error) {
      console.error('Error verifying Connect onboarding:', error);
      return reply.code(500).send({
        error: 'Failed to verify onboarding status'
      });
    }
  });

  /**
   * Create Stripe Connect account link for onboarding
   */
  fastify.post('/connect/create-account-link', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { returnUrl, refreshUrl } = request.body as {
        returnUrl?: string;
        refreshUrl?: string;
      };

      const result = await stripeConnectService.createOnboardingLink({
        userId: request.userId,
        returnUrl,
        refreshUrl,
      });

      return {
        url: result.url,
        expiresAt: result.expiresAt,
      };
    } catch (error) {
      console.error('Error creating account link:', error);
      const message = error instanceof Error ? error.message : 'Failed to create account link';
      return reply.code(500).send({ error: message });
    }
  });

  /**
   * Process Stripe Connect transfer (withdrawal payout)
   */
  fastify.post('/connect/transfer', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    let idempotencyKey: string | undefined;
    let amount: number | undefined;
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const body = transferSchema.parse(request.body);

      const { currency = 'usd' } = body;
      amount = body.amount;
      idempotencyKey = body.idempotencyKey;

      if (idempotencyKey) {
        const isDuplicate = await checkIdempotencyKey(idempotencyKey);
        if (isDuplicate) {
          return reply.code(409).send({
            error: 'Duplicate request detected',
            code: 'duplicate_transaction'
          });
        }
        await storeIdempotencyKey(idempotencyKey);
      }

      // Check balance
      const balanceCents = await calculateUserBalance(request.userId);
      const amountCents = Math.round(amount * 100);
      if (balanceCents < amountCents) {
        return reply.code(400).send({ error: 'Insufficient balance' });
      }

      // Check Connect account
      const status = await stripeConnectService.getConnectStatus(request.userId as string);
      if (!status.hasStripeAccount || !status.payoutsEnabled) {
        return reply.code(400).send({
          error: 'Stripe Connect account not ready for payouts',
          requiresOnboarding: true,
        });
      }

      // Create withdrawal transaction
      const transaction = await walletService.createTransaction({
        user_id: request.userId as string,
        type: 'withdrawal',
        amount: amount,
      });

      let transferId = `tr_mock_${Date.now()}`;

      // Process Stripe transfer
      if (stripe && status.stripeAccountId) {
        try {
          const transfer = await stripe.transfers.create({
            amount: amountCents,
            currency,
            destination: status.stripeAccountId,
            metadata: {
              user_id: request.userId,
              transaction_id: transaction.id,
              type: 'withdrawal',
            },
          }, idempotencyKey ? { idempotencyKey } : {});
          transferId = transfer.id;
          console.log(`✅ Created Stripe transfer ${transfer.id} for $${amount}`);
        } catch (stripeError) {
          console.error('Stripe transfer error:', stripeError);
          // Return error but transaction is recorded
          return reply.code(500).send({
            error: 'Failed to process Stripe transfer. Please contact support.',
            transactionId: transaction.id,
          });
        }
      }

      const newBalance = (balanceCents - amountCents) / 100;

      return {
        success: true,
        transferId,
        transactionId: transaction.id,
        amount,
        newBalance,
        estimatedArrival: '1-2 business days',
        message: `Transfer of $${amount.toFixed(2)} has been initiated.`,
      };
    } catch (error) {
      logErrorWithContext(request, error, {
        operation: 'process_transfer',
        userId: request.userId,
        amount: amount,
      });

      if (idempotencyKey) {
        await removeIdempotencyKey(idempotencyKey);
      }

      return reply.code(500).send({
        error: 'Failed to process transfer',
        requestId: getRequestContext(request).requestId,
      });
    }
  });

  /**
   * Create escrow for a bounty (hold funds when bounty is posted)
   */
  fastify.post('/wallet/escrow', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    let idempotencyKey: string | undefined;
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const body = escrowSchema.parse(request.body);
      const { bountyId, amount } = body;
      idempotencyKey = body.idempotencyKey;

      if (idempotencyKey) {
        const isDuplicate = await checkIdempotencyKey(idempotencyKey);
        if (isDuplicate) {
          return reply.code(409).send({
            error: 'Duplicate request detected',
            code: 'duplicate_transaction'
          });
        }
        await storeIdempotencyKey(idempotencyKey);
      }

      const transaction = await ConsolidatedWalletService.createEscrow(
        bountyId,
        request.userId,
        amount,
        idempotencyKey
      );

      const { balance } = await ConsolidatedWalletService.getBalance(request.userId);

      return {
        success: true,
        transactionId: transaction.id,
        amount,
        newBalance: balance,
        message: `$${amount.toFixed(2)} held in escrow for bounty.`,
      };
    } catch (error: any) {
      if (idempotencyKey) {
        await removeIdempotencyKey(idempotencyKey);
      }
      logErrorWithContext(request, error, {
        operation: 'create_escrow',
        userId: request.userId,
      });

      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({
        error: error.message || 'Failed to create escrow',
        requestId: getRequestContext(request).requestId,
      });
    }
  });

  /**
   * Release escrow (transfer funds to hunter on completion)
   */
  fastify.post('/wallet/release', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    let idempotencyKey: string | undefined;
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { bountyId, hunterId, idempotencyKey: key } = request.body as {
        bountyId: string;
        hunterId: string;
        idempotencyKey?: string;
      };
      idempotencyKey = key;

      if (!bountyId || !hunterId) {
        return reply.code(400).send({ error: 'Missing bountyId or hunterId' });
      }

      if (idempotencyKey) {
        const isDuplicate = await checkIdempotencyKey(idempotencyKey);
        if (isDuplicate) {
          return reply.code(409).send({
            error: 'Duplicate request detected',
            code: 'duplicate_transaction'
          });
        }
        await storeIdempotencyKey(idempotencyKey);
      }

      // Verify user is the bounty creator (Business logic verification)
      const bountyRecords = await db
        .select()
        .from(bounties)
        .where(eq(bounties.id, bountyId))
        .limit(1);

      if (!bountyRecords.length || bountyRecords[0].creator_id !== request.userId) {
        if (idempotencyKey) await removeIdempotencyKey(idempotencyKey);
        return reply.code(403).send({ error: 'Unauthorized to release funds' });
      }

      const transaction = await ConsolidatedWalletService.releaseEscrow(
        bountyId,
        hunterId,
        idempotencyKey
      );

      return {
        success: true,
        transactionId: transaction.id,
        releaseAmount: transaction.amount,
        message: `$${transaction.amount.toFixed(2)} released to hunter.`,
      };
    } catch (error: any) {
      if (idempotencyKey) {
        await removeIdempotencyKey(idempotencyKey);
      }
      logErrorWithContext(request, error, {
        operation: 'release_escrow',
        userId: request.userId,
      });

      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({
        error: error.message || 'Failed to release funds',
        requestId: getRequestContext(request).requestId,
      });
    }
  });

  /**
   * Refund escrow (return funds to poster on cancellation)
   */
  fastify.post('/wallet/refund', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    let idempotencyKey: string | undefined;
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { bountyId, reason, idempotencyKey: key } = request.body as {
        bountyId: string;
        reason?: string;
        idempotencyKey?: string;
      };
      idempotencyKey = key;

      if (!bountyId) {
        return reply.code(400).send({ error: 'Missing bountyId' });
      }

      if (idempotencyKey) {
        const isDuplicate = await checkIdempotencyKey(idempotencyKey);
        if (isDuplicate) {
          return reply.code(409).send({
            error: 'Duplicate request detected',
            code: 'duplicate_transaction'
          });
        }
        await storeIdempotencyKey(idempotencyKey);
      }

      // Verify user is the bounty creator
      const bountyRecords = await db
        .select()
        .from(bounties)
        .where(eq(bounties.id, bountyId))
        .limit(1);

      if (!bountyRecords.length || bountyRecords[0].creator_id !== request.userId) {
        if (idempotencyKey) await removeIdempotencyKey(idempotencyKey);
        return reply.code(403).send({ error: 'Unauthorized to refund funds' });
      }

      const transaction = await ConsolidatedWalletService.refundEscrow(
        bountyId,
        request.userId,
        reason || 'Bounty cancelled',
        idempotencyKey
      );

      return {
        success: true,
        transactionId: transaction.id,
        amount: transaction.amount,
        message: `Refund of $${transaction.amount.toFixed(2)} processed.`,
      };
    } catch (error: any) {
      if (idempotencyKey) {
        await removeIdempotencyKey(idempotencyKey);
      }
      logErrorWithContext(request, error, {
        operation: 'refund_escrow',
        userId: request.userId,
      });

      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({
        error: error.message || 'Failed to refund funds',
        requestId: getRequestContext(request).requestId,
      });
    }
  });

  /**
   * Add a bank account to user's Stripe Connect account
   */
  fastify.post('/connect/bank-accounts', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

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

      // Use consolidated Stripe Connect service to add bank account
      const { consolidatedStripeConnectService } = await import('../services/consolidated-stripe-connect-service');

      const bankAccount = await consolidatedStripeConnectService.addBankAccount(
        request.userId,
        accountHolderName,
        routingNumber,
        accountNumber,
        accountType
      );

      return {
        success: true,
        bankAccount,
      };
    } catch (error) {
      logErrorWithContext(request, error, {
        operation: 'add_bank_account',
        userId: request.userId,
      });

      const message = error instanceof Error ? error.message : 'Failed to add bank account';
      return reply.code(500).send({
        error: message,
        requestId: getRequestContext(request).requestId,
      });
    }
  });

  /**
   * List all bank accounts for user's Stripe Connect account
   */
  fastify.get('/connect/bank-accounts', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Use consolidated Stripe Connect service to list bank accounts
      const { consolidatedStripeConnectService } = await import('../services/consolidated-stripe-connect-service');

      const bankAccounts = await consolidatedStripeConnectService.listBankAccounts(
        request.userId
      );

      return {
        bankAccounts,
      };
    } catch (error) {
      logErrorWithContext(request, error, {
        operation: 'list_bank_accounts',
        userId: request.userId,
      });

      return reply.code(500).send({
        error: 'Failed to list bank accounts',
        requestId: getRequestContext(request).requestId,
      });
    }
  });

  /**
   * Remove a bank account from user's Stripe Connect account
   */
  fastify.delete('/connect/bank-accounts/:bankAccountId', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { bankAccountId } = request.params as { bankAccountId: string };

      if (!bankAccountId) {
        return reply.code(400).send({ error: 'Bank account ID required' });
      }

      // Use consolidated Stripe Connect service to remove bank account
      const { consolidatedStripeConnectService } = await import('../services/consolidated-stripe-connect-service');

      const result = await consolidatedStripeConnectService.removeBankAccount(
        request.userId,
        bankAccountId
      );

      return result;
    } catch (error) {
      logErrorWithContext(request, error, {
        operation: 'remove_bank_account',
        userId: request.userId,
      });

      const message = error instanceof Error ? error.message : 'Failed to remove bank account';
      return reply.code(500).send({
        error: message,
        requestId: getRequestContext(request).requestId,
      });
    }
  });

  /**
   * Set a bank account as the default for payouts
   */
  fastify.post('/connect/bank-accounts/:bankAccountId/default', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { bankAccountId } = request.params as { bankAccountId: string };

      if (!bankAccountId) {
        return reply.code(400).send({ error: 'Bank account ID required' });
      }

      // Use consolidated Stripe Connect service to set default bank account
      const { consolidatedStripeConnectService } = await import('../services/consolidated-stripe-connect-service');

      const bankAccount = await consolidatedStripeConnectService.setDefaultBankAccount(
        request.userId,
        bankAccountId
      );

      return {
        success: true,
        bankAccount,
      };
    } catch (error) {
      logErrorWithContext(request, error, {
        operation: 'set_default_bank_account',
        userId: request.userId,
      });

      const message = error instanceof Error ? error.message : 'Failed to set default bank account';
      return reply.code(500).send({
        error: message,
        requestId: getRequestContext(request).requestId,
      });
    }
  });
}