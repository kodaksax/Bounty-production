import { and, desc, eq, sql } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { db } from '../db/connection';
import { bounties, walletTransactions } from '../db/schema';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { logErrorWithContext, getRequestContext } from '../middleware/request-context';
import { stripeConnectService } from '../services/stripe-connect-service';
import { walletService } from '../services/wallet-service';
import { calculateUserBalance } from '../utils/wallet-utils';

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

      const balanceCents = await calculateUserBalance(request.userId);

      return {
        balance: balanceCents / 100, // Convert cents to dollars
        balanceCents: balanceCents,
        currency: 'USD',
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

      // Build query based on type filter
      let query = db
        .select({
          id: walletTransactions.id,
          bounty_id: walletTransactions.bounty_id,
          user_id: walletTransactions.user_id,
          type: walletTransactions.type,
          amount_cents: walletTransactions.amount_cents,
          stripe_transfer_id: walletTransactions.stripe_transfer_id,
          platform_fee_cents: walletTransactions.platform_fee_cents,
          created_at: walletTransactions.created_at,
        })
        .from(walletTransactions)
        .where(eq(walletTransactions.user_id, request.userId))
        .orderBy(desc(walletTransactions.created_at))
        .limit(limitNum)
        .offset(offset);

      const transactions = await query;

      // Get bounty titles for transactions that have bounty_id
      const bountyIds = transactions
        .filter(t => t.bounty_id)
        .map(t => t.bounty_id!);

      let bountyTitles: Record<string, string> = {};
      if (bountyIds.length > 0) {
        // Fetch all bounty titles for the transactions
        const uniqueBountyIds = [...new Set(bountyIds)];
        for (const bid of uniqueBountyIds) {
          const bountyData = await db
            .select({ id: bounties.id, title: bounties.title })
            .from(bounties)
            .where(eq(bounties.id, bid));

          bountyData.forEach(b => {
            bountyTitles[b.id] = b.title;
          });
        }
      }

      // Transform to client format
      const transformedTransactions = transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: t.amount_cents / 100, // Convert cents to dollars
        date: t.created_at,
        details: {
          title: t.bounty_id ? bountyTitles[t.bounty_id] : undefined,
          bounty_id: t.bounty_id,
          status: 'completed',
          stripe_transfer_id: t.stripe_transfer_id,
          platform_fee: t.platform_fee_cents ? t.platform_fee_cents / 100 : undefined,
        },
      }));

      // Get total count for pagination
      const [{ count }] = await db
        .select({ count: sql`COUNT(*)`.as('count') })
        .from(walletTransactions)
        .where(eq(walletTransactions.user_id, request.userId));

      const totalCount = Number(count);
      const hasMore = offset + transformedTransactions.length < totalCount;

      return {
        transactions: transformedTransactions,
        page: pageNum,
        limit: limitNum,
        hasMore,
      };
    } catch (error) {
      logErrorWithContext(request, error, {
        operation: 'fetch_wallet_transactions',
        userId: request.userId,
      });
      return reply.code(500).send({
        error: 'Failed to fetch wallet balance',
        requestId: getRequestContext(request).requestId,
      });
    }
  });

  /**
   * Create a deposit transaction (add money to wallet)
   */
  fastify.post('/wallet/deposit', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    let amount: number | undefined;
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const body = request.body as {
        amount: number;
        paymentIntentId?: string;
      };
      amount = body.amount;
      const paymentIntentId = body.paymentIntentId;

      if (!amount || amount <= 0) {
        return reply.code(400).send({ error: 'Invalid amount' });
      }

      // If paymentIntentId provided, verify it with Stripe
      if (paymentIntentId && stripe) {
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
          if (paymentIntent.status !== 'succeeded') {
            return reply.code(400).send({ error: 'Payment not completed' });
          }
          // Amount should match
          if (paymentIntent.amount !== Math.round(amount * 100)) {
            return reply.code(400).send({ error: 'Amount mismatch' });
          }
        } catch (stripeError) {
          console.error('Stripe verification error:', stripeError);
          return reply.code(400).send({ error: 'Invalid payment intent' });
        }
      }

      // Create deposit transaction
      const transaction = await walletService.createTransaction({
        user_id: request.userId,
        type: 'deposit',
        amount: amount,
      });

      // Calculate new balance after deposit
      const newBalanceCents = await calculateUserBalance(request.userId);

      return {
        success: true,
        transaction,
        newBalance: newBalanceCents / 100,
      };
    } catch (error) {
      logErrorWithContext(request, error, {
        operation: 'create_deposit',
        userId: request.userId,
        amount: amount,
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
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { amount } = request.body as { amount: number };

      if (!amount || amount <= 0) {
        return reply.code(400).send({ error: 'Invalid amount' });
      }

      // Check if user has sufficient balance
      const balanceCents = await calculateUserBalance(request.userId);
      const amountCents = Math.round(amount * 100);
      if (balanceCents < amountCents) {
        return reply.code(400).send({ error: 'Insufficient balance' });
      }

      // Check if user has a connected Stripe account
      const connectStatus = await stripeConnectService.getConnectStatus(request.userId);
      
      if (!connectStatus.hasStripeAccount || !connectStatus.payoutsEnabled) {
        return reply.code(400).send({
          error: 'Stripe Connect account required for withdrawals. Please complete onboarding.',
          requiresOnboarding: true,
        });
      }

      // Create withdrawal transaction
      const transaction = await walletService.createTransaction({
        user_id: request.userId,
        type: 'withdrawal',
        amount: amount,
      });

      // Process actual Stripe transfer if configured
      if (stripe && connectStatus.stripeAccountId) {
        try {
          const transfer = await stripe.transfers.create({
            amount: amountCents,
            currency: 'usd',
            destination: connectStatus.stripeAccountId,
            metadata: {
              user_id: request.userId,
              transaction_id: transaction.id,
              type: 'withdrawal',
            },
          });

          console.log(`✅ Created Stripe transfer ${transfer.id} for withdrawal`);
        } catch (stripeError) {
          console.error('Stripe transfer error:', stripeError);
          // Transaction is already recorded, log the error but don't fail
        }
      }

      const newBalance = (balanceCents - amountCents) / 100;

      return {
        success: true,
        transaction,
        newBalance,
        estimatedArrival: '1-2 business days',
      };
    } catch (error) {
      console.error('Error creating withdrawal:', error);
      return reply.code(500).send({
        error: 'Failed to create withdrawal'
      });
    }
  });

  /**
   * Add bank account to Stripe Connect account for payouts
   * This creates an external account on the user's Connect account
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

      // Validate input
      if (!accountHolderName || !routingNumber || !accountNumber || !accountType) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      if (routingNumber.length !== 9) {
        return reply.code(400).send({ error: 'Invalid routing number' });
      }

      // Validate routing number checksum (ABA algorithm)
      const digits = routingNumber.split('').map(Number);
      const checksum = (
        3 * (digits[0] + digits[3] + digits[6]) +
        7 * (digits[1] + digits[4] + digits[7]) +
        (digits[2] + digits[5] + digits[8])
      ) % 10;
      
      if (checksum !== 0) {
        return reply.code(400).send({ error: 'Invalid routing number checksum' });
      }

      if (accountNumber.length < 4 || accountNumber.length > 17) {
        return reply.code(400).send({ error: 'Invalid account number' });
      }

      if (accountType !== 'checking' && accountType !== 'savings') {
        return reply.code(400).send({ error: 'Account type must be checking or savings' });
      }

      // Get user's Connect account
      const status = await stripeConnectService.getConnectStatus(request.userId);
      
      if (!status.hasStripeAccount || !status.stripeAccountId) {
        return reply.code(400).send({
          error: 'Stripe Connect account required. Please complete onboarding first.',
          requiresOnboarding: true,
        });
      }

      if (!stripe) {
        return reply.code(500).send({ error: 'Stripe not configured' });
      }

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

      // Add external account to Connect account for payouts
      const externalAccount = await stripe.accounts.createExternalAccount(
        status.stripeAccountId,
        {
          external_account: token.id,
          default_for_currency: true, // Set as default payout method
        }
      );

      console.log(`✅ Added external bank account to Connect account ${status.stripeAccountId}`);

      // Extract last4 for response
      const last4 = 'last4' in externalAccount ? externalAccount.last4 : accountNumber.slice(-4);
      const bankName = 'bank_name' in externalAccount ? externalAccount.bank_name : undefined;

      return {
        success: true,
        bankAccount: {
          id: externalAccount.id,
          last4,
          bankName,
          accountType,
          verified: 'status' in externalAccount ? externalAccount.status === 'verified' : false,
        },
      };
    } catch (error: any) {
      console.error('Error adding bank account:', error);
      
      let errorMessage = 'Failed to add bank account';
      
      if (error.type === 'StripeInvalidRequestError') {
        if (error.code === 'routing_number_invalid') {
          errorMessage = 'Invalid routing number';
        } else if (error.code === 'account_number_invalid') {
          errorMessage = 'Invalid account number';
        } else if (error.param?.includes('routing_number')) {
          errorMessage = 'Invalid routing number';
        } else if (error.param?.includes('account_number')) {
          errorMessage = 'Invalid account number';
        }
      }
      
      return reply.code(400).send({ error: errorMessage });
    }
  });

  /**
   * List bank accounts on Stripe Connect account
   */
  fastify.get('/connect/bank-accounts', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Get user's Connect account
      const status = await stripeConnectService.getConnectStatus(request.userId);
      
      if (!status.hasStripeAccount || !status.stripeAccountId) {
        return {
          bankAccounts: [],
          hasConnectAccount: false,
        };
      }

      if (!stripe) {
        return reply.code(500).send({ error: 'Stripe not configured' });
      }

      // List external accounts
      const externalAccounts = await stripe.accounts.listExternalAccounts(
        status.stripeAccountId,
        {
          object: 'bank_account',
          limit: 10,
        }
      );

      const bankAccounts = externalAccounts.data.map((account: any) => ({
        id: account.id,
        last4: account.last4,
        bankName: account.bank_name,
        accountType: account.object === 'bank_account' ? 'bank_account' : 'card', // Type of source
        verified: account.status === 'verified',
        defaultForCurrency: account.default_for_currency,
      }));

      return {
        bankAccounts,
        hasConnectAccount: true,
      };
    } catch (error: any) {
      console.error('Error listing bank accounts:', error);
      return reply.code(500).send({
        error: 'Failed to list bank accounts'
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
    let amount: number | undefined;
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const body = request.body as {
        amount: number;
        currency?: string;
      };
      amount = body.amount;
      const currency = body.currency || 'usd';

      if (!amount || amount <= 0) {
        return reply.code(400).send({ error: 'Invalid amount' });
      }

      // Check balance
      const balanceCents = await calculateUserBalance(request.userId);
      const amountCents = Math.round(amount * 100);
      if (balanceCents < amountCents) {
        return reply.code(400).send({ error: 'Insufficient balance' });
      }

      // Check Connect account
      const status = await stripeConnectService.getConnectStatus(request.userId);
      if (!status.hasStripeAccount || !status.payoutsEnabled) {
        return reply.code(400).send({
          error: 'Stripe Connect account not ready for payouts',
          requiresOnboarding: true,
        });
      }

      // Create withdrawal transaction
      const transaction = await walletService.createTransaction({
        user_id: request.userId,
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
          });
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
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { bountyId, amount, title } = request.body as {
        bountyId: string;
        amount: number;
        title?: string;
      };

      if (!bountyId || !amount || amount <= 0) {
        return reply.code(400).send({ error: 'Invalid bountyId or amount' });
      }

      // Check user has sufficient balance
      const balanceCents = await calculateUserBalance(request.userId);
      const amountCents = Math.round(amount * 100);
      if (balanceCents < amountCents) {
        return reply.code(400).send({ error: 'Insufficient balance' });
      }

      // Create escrow transaction
      const escrowTransaction = await db.insert(walletTransactions).values({
        bounty_id: bountyId,
        user_id: request.userId,
        type: 'escrow',
        amount_cents: amountCents,
        platform_fee_cents: 0,
      }).returning();

      // Create Stripe PaymentIntent if configured
      let paymentIntentId = `pi_mock_${Date.now()}_${bountyId.slice(-8)}`;
      
      if (stripe) {
        try {
          const paymentIntent = await stripe.paymentIntents.create({
            amount: amountCents,
            currency: 'usd',
            capture_method: 'automatic',
            payment_method_types: ['card'],
            metadata: {
              bounty_id: bountyId,
              user_id: request.userId,
              type: 'escrow',
              title: title || '',
            },
            description: `Escrow for bounty: ${title || bountyId}`,
          });

          paymentIntentId = paymentIntent.id;
          
          // Update bounty with payment intent ID
          await db
            .update(bounties)
            .set({ 
              payment_intent_id: paymentIntentId,
              updated_at: new Date(),
            })
            .where(eq(bounties.id, bountyId));

          console.log(`✅ Created Stripe PaymentIntent ${paymentIntentId} for bounty ${bountyId}`);
        } catch (stripeError) {
          console.error('Stripe PaymentIntent error:', stripeError);
          // Continue with mock for development
        }
      }

      const newBalance = (balanceCents - amountCents) / 100;

      return {
        success: true,
        transactionId: escrowTransaction[0].id,
        paymentIntentId,
        amount,
        newBalance,
        message: `$${amount.toFixed(2)} held in escrow for bounty.`,
      };
    } catch (error) {
      console.error('Error creating escrow:', error);
      return reply.code(500).send({
        error: 'Failed to create escrow'
      });
    }
  });

  /**
   * Release escrow (transfer funds to hunter on completion)
   */
  fastify.post('/wallet/release', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { bountyId, hunterId } = request.body as {
        bountyId: string;
        hunterId: string;
      };

      if (!bountyId || !hunterId) {
        return reply.code(400).send({ error: 'Missing bountyId or hunterId' });
      }

      // Get bounty to verify ownership and get details
      const bountyRecords = await db
        .select()
        .from(bounties)
        .where(eq(bounties.id, bountyId))
        .limit(1);

      if (!bountyRecords.length) {
        return reply.code(404).send({ error: 'Bounty not found' });
      }

      const bounty = bountyRecords[0];

      // Verify user is the bounty creator
      if (bounty.creator_id !== request.userId) {
        return reply.code(403).send({ error: 'Only the bounty creator can release funds' });
      }

      // Check for existing release to prevent double processing
      const existingRelease = await db
        .select()
        .from(walletTransactions)
        .where(and(
          eq(walletTransactions.bounty_id, bountyId),
          eq(walletTransactions.type, 'release')
        ))
        .limit(1);

      if (existingRelease.length > 0) {
        return reply.code(400).send({ error: 'Funds already released for this bounty' });
      }

      // Calculate amounts with platform fee (5%)
      const platformFeePercentage = 5;
      const platformFeeCents = Math.round((bounty.amount_cents * platformFeePercentage) / 100);
      const releaseAmountCents = bounty.amount_cents - platformFeeCents;

      // Create release transaction for hunter
      const releaseTransaction = await db.insert(walletTransactions).values({
        bounty_id: bountyId,
        user_id: hunterId,
        type: 'release',
        amount_cents: releaseAmountCents,
        platform_fee_cents: platformFeeCents,
      }).returning();

      // Record platform fee - use a well-known UUID for platform account
      // This should be a fixed UUID that doesn't conflict with user IDs
      const PLATFORM_ACCOUNT_ID = '00000000-0000-0000-0000-000000000000';
      
      await db.insert(walletTransactions).values({
        bounty_id: bountyId,
        user_id: PLATFORM_ACCOUNT_ID,
        type: 'platform_fee',
        amount_cents: platformFeeCents,
        platform_fee_cents: 0,
      });

      // Update bounty status
      await db
        .update(bounties)
        .set({ 
          status: 'completed',
          updated_at: new Date(),
        })
        .where(eq(bounties.id, bountyId));

      // Transfer to hunter's Stripe account if configured
      let transferId = `tr_mock_${Date.now()}_${bountyId.slice(-8)}`;
      
      if (stripe) {
        try {
          // Get hunter's Stripe account ID
          const { users } = await import('../db/schema');
          const hunterRecords = await db
            .select()
            .from(users)
            .where(eq(users.id, hunterId))
            .limit(1);

          if (hunterRecords.length > 0 && hunterRecords[0].stripe_account_id) {
            const transfer = await stripe.transfers.create({
              amount: releaseAmountCents,
              currency: 'usd',
              destination: hunterRecords[0].stripe_account_id,
              metadata: {
                bounty_id: bountyId,
                hunter_id: hunterId,
                platform_fee_cents: platformFeeCents.toString(),
              },
            });

            transferId = transfer.id;
            console.log(`✅ Created Stripe Transfer ${transferId} for $${releaseAmountCents / 100}`);
          }
        } catch (stripeError) {
          console.error('Stripe transfer error:', stripeError);
          // Continue without Stripe transfer for development
        }
      }

      return {
        success: true,
        transactionId: releaseTransaction[0].id,
        transferId,
        releaseAmount: releaseAmountCents / 100,
        platformFee: platformFeeCents / 100,
        message: `$${(releaseAmountCents / 100).toFixed(2)} released to hunter.`,
      };
    } catch (error) {
      console.error('Error releasing funds:', error);
      return reply.code(500).send({
        error: 'Failed to release funds'
      });
    }
  });

  /**
   * Refund escrow (return funds to poster on cancellation)
   */
  fastify.post('/wallet/refund', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { bountyId, reason } = request.body as {
        bountyId: string;
        reason?: string;
      };

      if (!bountyId) {
        return reply.code(400).send({ error: 'Missing bountyId' });
      }

      // Get bounty details
      const bountyRecords = await db
        .select()
        .from(bounties)
        .where(eq(bounties.id, bountyId))
        .limit(1);

      if (!bountyRecords.length) {
        return reply.code(404).send({ error: 'Bounty not found' });
      }

      const bounty = bountyRecords[0];

      // Verify user is the bounty creator
      if (bounty.creator_id !== request.userId) {
        return reply.code(403).send({ error: 'Only the bounty creator can cancel and refund' });
      }

      // Check bounty status
      if (bounty.status === 'completed') {
        return reply.code(400).send({ error: 'Cannot refund a completed bounty' });
      }

      // Check for existing refund
      const existingRefund = await db
        .select()
        .from(walletTransactions)
        .where(and(
          eq(walletTransactions.bounty_id, bountyId),
          eq(walletTransactions.type, 'refund')
        ))
        .limit(1);

      if (existingRefund.length > 0) {
        return reply.code(400).send({ error: 'Bounty has already been refunded' });
      }

      // Create refund transaction (full refund)
      const refundTransaction = await db.insert(walletTransactions).values({
        bounty_id: bountyId,
        user_id: request.userId,
        type: 'refund',
        amount_cents: bounty.amount_cents,
        platform_fee_cents: 0,
      }).returning();

      // Update bounty status
      await db
        .update(bounties)
        .set({ 
          status: 'cancelled',
          updated_at: new Date(),
        })
        .where(eq(bounties.id, bountyId));

      // Process Stripe refund if payment intent exists
      let stripeRefundId = `re_mock_${Date.now()}`;
      
      if (stripe && bounty.payment_intent_id) {
        try {
          const refund = await stripe.refunds.create({
            payment_intent: bounty.payment_intent_id,
            reason: 'requested_by_customer',
            metadata: {
              bounty_id: bountyId,
              type: 'bounty_cancellation',
            },
          });

          stripeRefundId = refund.id;
          console.log(`✅ Created Stripe refund ${stripeRefundId} for bounty ${bountyId}`);
        } catch (stripeError) {
          console.error('Stripe refund error:', stripeError);
          // Continue without Stripe refund for development
        }
      }

      return {
        success: true,
        transactionId: refundTransaction[0].id,
        refundId: stripeRefundId,
        amount: bounty.amount_cents / 100,
        message: `$${(bounty.amount_cents / 100).toFixed(2)} refunded to your wallet.`,
      };
    } catch (error) {
      console.error('Error processing refund:', error);
      return reply.code(500).send({
        error: 'Failed to process refund'
      });
    }
  });
}