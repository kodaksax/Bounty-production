/**
 * Consolidated Webhook Routes
 * Phase 3.3 - Backend consolidation project
 * 
 * Handles Stripe webhook events for payment processing, transfers, and account updates
 * Ensures idempotency and atomic balance operations
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { stripe } from '../services/consolidated-payment-service';
import * as WalletService from '../services/consolidated-wallet-service';
import { config } from '../config';
import {
  ValidationError,
  ExternalServiceError,
} from '../middleware/error-handler';
import { logger } from '../services/logger';
import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { Database } from '../types/database.types';

// Extend FastifyRequest to include rawBody for webhook signature verification
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

// Amount sign conventions
// Positive: credits (deposits, refunds to user)
// Negative: debits (withdrawals, refunds from user)
const CREDIT_AMOUNT = 1;
const DEBIT_AMOUNT = -1;

// Initialize Supabase admin client
let supabaseAdmin: ReturnType<typeof createClient<Database>> | null = null;

function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient<Database>(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }
  return supabaseAdmin;
}

/**
 * Check if webhook event has already been processed (idempotency)
 */
async function checkEventProcessed(eventId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  
  const { data, error } = await admin
    .from('stripe_events')
    .select('processed')
    .eq('stripe_event_id', eventId)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    // PGRST116 is "not found" which is expected for new events
    logger.warn({ error: error.message, eventId }, 'Error checking event processed status');
  }
  
  return data?.processed === true;
}

/**
 * Log webhook event for tracking and debugging
 */
async function logWebhookEvent(event: Stripe.Event): Promise<void> {
  const admin = getSupabaseAdmin();
  
  const { error } = await admin
    .from('stripe_events')
    .upsert({
      stripe_event_id: event.id,
      event_type: event.type,
      event_data: event.data.object,
      processed: false,
      created_at: new Date(event.created * 1000).toISOString(),
    }, {
      onConflict: 'stripe_event_id',
      ignoreDuplicates: false,
    });
  
  if (error) {
    logger.error({ error: error.message, eventId: event.id }, 'Failed to log webhook event');
    throw new ExternalServiceError('Supabase', 'Failed to log webhook event', { error: error.message });
  }
}

/**
 * Mark webhook event as processed
 */
async function markEventProcessed(eventId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  
  const { error } = await admin
    .from('stripe_events')
    .update({
      processed: true,
      processed_at: new Date().toISOString(),
    })
    .eq('stripe_event_id', eventId);
  
  if (error) {
    logger.error({ error: error.message, eventId }, 'Failed to mark event as processed');
    // Don't throw - event was processed successfully, just logging failed
  }
}

/**
 * Handle payment_intent.succeeded event
 * Creates wallet deposit and updates user balance
 */
async function handlePaymentIntentSucceeded(event: Stripe.Event): Promise<void> {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  const userId = paymentIntent.metadata?.user_id;
  
  if (!userId) {
    logger.warn({ paymentIntentId: paymentIntent.id }, 'PaymentIntent succeeded but missing user_id in metadata');
    return;
  }
  
  logger.info({
    paymentIntentId: paymentIntent.id,
    userId,
    amount: paymentIntent.amount / 100,
  }, 'Processing successful payment');
  
  try {
    // Create deposit transaction and update balance atomically
    await WalletService.createDeposit(
      userId,
      paymentIntent.amount / 100, // Convert cents to dollars
      paymentIntent.id
    );
    
    logger.info({
      paymentIntentId: paymentIntent.id,
      userId,
      amount: paymentIntent.amount / 100,
    }, 'Payment processed successfully');
  } catch (error: any) {
    logger.error({
      error: error.message,
      paymentIntentId: paymentIntent.id,
      userId,
    }, 'Failed to process payment');
    throw error;
  }
}

/**
 * Handle payment_intent.payment_failed event
 * Logs failure for analytics and fraud detection
 */
async function handlePaymentIntentFailed(event: Stripe.Event): Promise<void> {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  const userId = paymentIntent.metadata?.user_id;
  const error = paymentIntent.last_payment_error;
  
  logger.warn({
    paymentIntentId: paymentIntent.id,
    userId,
    errorCode: error?.code,
    errorMessage: error?.message,
  }, 'Payment failed');
  
  // Log for analytics/fraud detection
  const admin = getSupabaseAdmin();
  await admin
    .from('stripe_events')
    .update({
      event_data: {
        ...paymentIntent,
        _processed_notes: `Payment failed: ${error?.code} - ${error?.message}`,
      },
    })
    .eq('stripe_event_id', event.id);
  
  // TODO: Send notification to user about failed payment
}

/**
 * Handle payment_intent.requires_action event
 * Informational only - client SDK handles 3D Secure
 */
async function handlePaymentIntentRequiresAction(event: Stripe.Event): Promise<void> {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  const userId = paymentIntent.metadata?.user_id;
  
  logger.info({
    paymentIntentId: paymentIntent.id,
    userId,
  }, 'Payment requires action (3D Secure) - client SDK will handle');
}

/**
 * Handle charge.refunded event
 * Creates refund transaction and deducts from user balance
 * Handles partial refunds by tracking individual refund IDs
 */
async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId = charge.payment_intent as string;
  
  // Get the specific refund that triggered this event
  // Stripe includes the refund object in charge.refunds.data
  const refunds = charge.refunds?.data || [];
  if (refunds.length === 0) {
    logger.warn({
      chargeId: charge.id,
      paymentIntentId,
    }, 'charge.refunded event received but no refunds found in charge object');
    return;
  }
  
  // Process each refund that hasn't been processed yet
  // We'll use the refund ID to track which ones we've already handled
  const admin = getSupabaseAdmin();
  
  // Find original transaction
  const { data: originalTx, error: txError } = await admin
    .from('wallet_transactions')
    .select('user_id, amount')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('type', 'deposit')
    .single();
  
  if (txError || !originalTx) {
    logger.warn({
      chargeId: charge.id,
      paymentIntentId,
      error: txError?.message,
    }, 'Could not find original transaction for refund');
    return;
  }
  
  // Process each refund
  for (const refund of refunds) {
    const refundId = refund.id;
    const refundAmount = refund.amount / 100; // Convert cents to dollars
    
    logger.info({
      chargeId: charge.id,
      refundId,
      paymentIntentId,
      amount: refundAmount,
    }, 'Processing individual refund');
    
    try {
      // Check if this specific refund has already been processed
      const { data: existingRefund } = await admin
        .from('wallet_transactions')
        .select('id')
        .eq('stripe_charge_id', charge.id)
        .eq('type', 'refund')
        .contains('metadata', { refund_id: refundId })
        .maybeSingle();
      
      if (existingRefund) {
        logger.info({
          refundId,
          transactionId: existingRefund.id,
        }, 'Refund already processed, skipping');
        continue;
      }
      
      // Create refund transaction with refund ID in metadata
      const { error: refundError } = await admin
        .from('wallet_transactions')
        .insert({
          user_id: originalTx.user_id,
          type: 'refund',
          amount: DEBIT_AMOUNT * refundAmount, // Negative for refund (debit from balance)
          description: 'Payment refunded',
          status: 'completed',
          stripe_charge_id: charge.id,
          metadata: {
            refund_id: refundId,
            refund_reason: refund.reason,
            original_payment_intent_id: paymentIntentId,
          },
        });
      
      if (refundError) {
        throw new ExternalServiceError('Supabase', 'Failed to create refund transaction', {
          error: refundError.message,
        });
      }
      
      // Deduct from balance atomically
      await WalletService.updateBalance(originalTx.user_id, DEBIT_AMOUNT * refundAmount);
      
      logger.info({
        chargeId: charge.id,
        refundId,
        userId: originalTx.user_id,
        amount: refundAmount,
      }, 'Refund processed successfully');
    } catch (error: any) {
      logger.error({
        error: error.message,
        chargeId: charge.id,
        refundId,
        userId: originalTx.user_id,
      }, 'Failed to process refund');
      throw error;
    }
  }
}

/**
 * Handle transfer.created event
 * Updates wallet transaction with transfer ID
 */
async function handleTransferCreated(event: Stripe.Event): Promise<void> {
  const transfer = event.data.object as Stripe.Transfer;
  const userId = transfer.metadata?.user_id;
  
  logger.info({
    transferId: transfer.id,
    destination: transfer.destination,
    amount: transfer.amount / 100,
    userId,
  }, 'Transfer created');
  
  if (!userId) {
    logger.warn({ transferId: transfer.id }, 'Transfer created but missing user_id in metadata');
    return;
  }
  
  const admin = getSupabaseAdmin();
  
  // Update related wallet transaction with transfer ID
  const transferAmountDollars = transfer.amount / 100;
  
  // First, find the most recent matching withdrawal transaction
  const {
    data: existingTx,
    error: fetchError,
  } = await admin
    .from('wallet_transactions')
    .select('id, metadata')
    .eq('user_id', userId)
    .eq('type', 'withdrawal')
    .eq('amount', DEBIT_AMOUNT * transferAmountDollars) // Withdrawals are negative (debits)
    .is('stripe_transfer_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    logger.error({
      error: fetchError.message,
      transferId: transfer.id,
      userId,
    }, 'Failed to fetch matching withdrawal transaction for transfer');
    throw new ExternalServiceError('Supabase', 'Failed to fetch matching withdrawal transaction', {
      error: fetchError.message,
    });
  }

  if (!existingTx) {
    logger.warn({
      transferId: transfer.id,
      userId,
    }, 'No matching withdrawal transaction found for transfer');
    return;
  }

  // Merge with existing metadata to preserve previous values
  const mergedMetadata = {
    ...(existingTx.metadata as Record<string, any> || {}),
    transfer_status: 'created',
  };

  const { error: updateError } = await admin
    .from('wallet_transactions')
    .update({
      stripe_transfer_id: transfer.id,
      metadata: mergedMetadata,
    })
    .eq('id', existingTx.id);
  
  if (updateError) {
    logger.error({
      error: updateError.message,
      transferId: transfer.id,
      userId,
    }, 'Failed to update transaction with transfer ID');
    throw new ExternalServiceError('Supabase', 'Failed to link Stripe transfer to wallet transaction', {
      error: updateError.message,
      transferId: transfer.id,
    });
  }
}

/**
 * Handle transfer.paid event
 * Marks wallet transaction as completed
 */
async function handleTransferPaid(event: Stripe.Event): Promise<void> {
  const transfer = event.data.object as Stripe.Transfer;
  
  logger.info({
    transferId: transfer.id,
    destination: transfer.destination,
    amount: transfer.amount / 100,
  }, 'Transfer paid');
  
  const admin = getSupabaseAdmin();
  
  // First, fetch the existing transaction to preserve metadata
  const { data: existingTx, error: fetchError } = await admin
    .from('wallet_transactions')
    .select('id, metadata')
    .eq('stripe_transfer_id', transfer.id)
    .maybeSingle();
  
  if (fetchError) {
    logger.error({
      error: fetchError.message,
      transferId: transfer.id,
    }, 'Failed to fetch transaction for transfer.paid');
    throw new ExternalServiceError('Supabase', 'Failed to fetch transaction', {
      error: fetchError.message,
    });
  }
  
  if (!existingTx) {
    logger.warn({
      transferId: transfer.id,
    }, 'No transaction found for transfer.paid event');
    return;
  }
  
  // Merge with existing metadata
  const mergedMetadata = {
    ...(existingTx.metadata as Record<string, any> || {}),
    transfer_status: 'paid',
    paid_at: new Date().toISOString(),
  };

  const { error: updateError } = await admin
    .from('wallet_transactions')
    .update({
      status: 'completed',
      metadata: mergedMetadata,
    })
    .eq('id', existingTx.id);
  
  if (updateError) {
    logger.error({
      error: updateError.message,
      transferId: transfer.id,
    }, 'Failed to mark transfer as paid');
    throw new ExternalServiceError('Supabase', 'Failed to mark transfer as paid', {
      error: updateError.message,
      transferId: transfer.id,
    });
  }
  
  // TODO: Send notification to user that funds have been transferred
}

/**
 * Handle transfer.failed event
 * Marks transaction as failed and refunds user's wallet balance
 */
async function handleTransferFailed(event: Stripe.Event): Promise<void> {
  const transfer = event.data.object as Stripe.Transfer;
  
  logger.warn({
    transferId: transfer.id,
    failureCode: transfer.failure_code,
    failureMessage: transfer.failure_message,
  }, 'Transfer failed');
  
  const admin = getSupabaseAdmin();
  
  // First, load existing transaction to preserve and merge metadata
  const { data: existingTx, error: existingTxError } = await admin
    .from('wallet_transactions')
    .select('id, amount, user_id, metadata')
    .eq('stripe_transfer_id', transfer.id)
    .single();
  
  if (existingTxError || !existingTx) {
    logger.error({
      error: existingTxError?.message,
      transferId: transfer.id,
    }, 'Failed to load transfer transaction before marking as failed');
    throw new ExternalServiceError('Supabase', 'Failed to load transfer transaction', {
      error: existingTxError?.message,
    });
  }

  // Merge with existing metadata to preserve previous values
  const mergedMetadata = {
    ...(existingTx.metadata as Record<string, any> || {}),
    transfer_status: 'failed',
    failure_code: transfer.failure_code,
    failure_message: transfer.failure_message,
    retry_count: 0,
  };

  // Mark transaction as failed, preserving existing metadata keys
  const { data: tx, error: txError } = await admin
    .from('wallet_transactions')
    .update({
      status: 'failed',
      metadata: mergedMetadata,
    })
    .eq('id', existingTx.id)
    .select()
    .single();
  
  if (txError || !tx) {
    logger.error({
      error: txError?.message,
      transferId: transfer.id,
    }, 'Failed to mark transfer as failed');
    throw new ExternalServiceError('Supabase', 'Failed to mark transfer as failed', {
      error: txError?.message,
    });
  }
  
  try {
    // Refund the amount back to user's wallet
    const refundAmount = Math.abs(tx.amount); // Ensure positive amount for credit
    await WalletService.updateBalance(tx.user_id, CREDIT_AMOUNT * refundAmount);
    
    logger.info({
      transferId: transfer.id,
      userId: tx.user_id,
      refundAmount,
    }, 'Refunded user for failed transfer');
    
    // TODO: Send notification to user about failed transfer
  } catch (error: any) {
    logger.error({
      error: error.message,
      transferId: transfer.id,
      userId: tx.user_id,
    }, 'Failed to refund user for failed transfer');
    throw error;
  }
}

/**
 * Handle account.updated event
 * Updates user's Connect onboarding status
 */
async function handleAccountUpdated(event: Stripe.Event): Promise<void> {
  const account = event.data.object as Stripe.Account;
  const userId = account.metadata?.user_id;
  
  logger.info({
    accountId: account.id,
    userId,
    detailsSubmitted: account.details_submitted,
    payoutsEnabled: account.payouts_enabled,
  }, 'Connect account updated');
  
  if (!userId) {
    logger.warn({ accountId: account.id }, 'Account updated but missing user_id in metadata');
    return;
  }
  
  const admin = getSupabaseAdmin();
  
  // Update user's Connect onboarding status
  const onboardingComplete = account.details_submitted && account.payouts_enabled;
  const { error } = await admin
    .from('profiles')
    .update({
      stripe_connect_onboarded_at: onboardingComplete ? new Date().toISOString() : null,
    })
    .eq('id', userId);
  
  if (error) {
    logger.error({
      error: error.message,
      accountId: account.id,
      userId,
    }, 'Failed to update user Connect status');
    throw new ExternalServiceError('Supabase', 'Failed to update user Connect status', {
      error: error.message,
      accountId: account.id,
    });
  }
}

/**
 * Handle payout.paid event
 * Informational only - funds have been paid to connected account's bank
 */
async function handlePayoutPaid(event: Stripe.Event): Promise<void> {
  const payout = event.data.object as Stripe.Payout;
  
  logger.info({
    payoutId: payout.id,
    amount: payout.amount / 100,
    destination: payout.destination,
  }, 'Payout paid to bank account');
}

/**
 * Handle payout.failed event
 * Logs failure for support follow-up
 */
async function handlePayoutFailed(event: Stripe.Event): Promise<void> {
  const payout = event.data.object as Stripe.Payout;
  
  logger.error({
    payoutId: payout.id,
    amount: payout.amount / 100,
    failureCode: payout.failure_code,
    failureMessage: payout.failure_message,
  }, 'Payout failed');
  
  // TODO: Notify user and support about failed payout
}

/**
 * Process webhook event based on type
 */
async function processWebhookEvent(event: Stripe.Event): Promise<void> {
  logger.info({ eventType: event.type, eventId: event.id }, 'Processing webhook event');
  
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event);
        break;
      
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event);
        break;
      
      case 'payment_intent.requires_action':
        await handlePaymentIntentRequiresAction(event);
        break;
      
      case 'charge.refunded':
        await handleChargeRefunded(event);
        break;
      
      case 'transfer.created':
        await handleTransferCreated(event);
        break;
      
      case 'transfer.paid':
        await handleTransferPaid(event);
        break;
      
      case 'transfer.failed':
        await handleTransferFailed(event);
        break;
      
      case 'account.updated':
        await handleAccountUpdated(event);
        break;
      
      case 'payout.paid':
        await handlePayoutPaid(event);
        break;
      
      case 'payout.failed':
        await handlePayoutFailed(event);
        break;
      
      default:
        logger.info({ eventType: event.type }, 'Unhandled webhook event type');
    }
  } catch (error: any) {
    // Log error and re-throw so Stripe can retry this isolated event type
    logger.error({
      error: error.message,
      stack: error.stack,
      eventType: event.type,
      eventId: event.id,
    }, 'Error processing webhook event');
    
    // Re-throw to signal Stripe to retry
    throw error;
  }
}

/**
 * Register consolidated webhook routes
 */
export async function registerConsolidatedWebhookRoutes(
  fastify: FastifyInstance
): Promise<void> {
  
  /**
   * POST /webhooks/stripe
   * Handle Stripe webhook events
   * 
   * Note: Stripe requires the raw request body for signature verification.
   * We use preParsing hook to capture the raw body before Fastify parses it.
   */
  fastify.post(
    '/webhooks/stripe',
    {
      bodyLimit: 1048576, // 1MB limit for webhook payloads
      preParsing: async (request, reply, payload) => {
        // Capture raw body for signature verification
        const chunks: Buffer[] = [];
        
        for await (const chunk of payload) {
          chunks.push(chunk);
        }
        
        const rawBody = Buffer.concat(chunks);
        
        // Store raw body for signature verification (using extended type)
        request.rawBody = rawBody.toString('utf8');
        
        // Return a stream for Fastify's body parser
        const { Readable } = require('stream');
        return Readable.from(rawBody);
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const sig = request.headers['stripe-signature'];
        
        if (!sig || typeof sig !== 'string') {
          throw new ValidationError('Missing Stripe signature');
        }
        
        if (!config.stripe.webhookSecret) {
          logger.error('Stripe webhook secret not configured');
          throw new ExternalServiceError('Configuration', 'Webhook secret not configured');
        }
        
        // Get raw body for signature verification
        const rawBody = request.rawBody;
        
        if (!rawBody) {
          logger.error('Raw body not available for signature verification');
          throw new ValidationError('Raw body required for signature verification');
        }
        
        // Verify webhook signature
        let event: Stripe.Event;
        try {
          event = stripe.webhooks.constructEvent(
            rawBody,
            sig,
            config.stripe.webhookSecret
          );
        } catch (error: any) {
          logger.error({
            error: error.message,
            signature: sig.substring(0, 20) + '...',
          }, 'Webhook signature verification failed');
          throw new ValidationError(`Webhook signature verification failed: ${error.message}`);
        }
        
        logger.info({
          eventType: event.type,
          eventId: event.id,
        }, 'Received Stripe webhook event');
        
        // Check idempotency
        const alreadyProcessed = await checkEventProcessed(event.id);
        if (alreadyProcessed) {
          logger.info({ eventId: event.id }, 'Event already processed, skipping');
          return reply.send({ received: true, alreadyProcessed: true });
        }
        
        // Log event for tracking
        await logWebhookEvent(event);
        
        // Process event based on type
        await processWebhookEvent(event);
        
        // Mark as processed
        await markEventProcessed(event.id);
        
        return reply.send({ received: true });
      } catch (error: any) {
        // Let Fastify error handler process it
        throw error;
      }
    }
  );
  
  fastify.log.info('Consolidated webhook routes registered');
}
