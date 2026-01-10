/**
 * Consolidated Wallet Service
 * Phase 3.1 - Backend consolidation project
 * 
 * Handles all wallet operations including:
 * - Balance queries
 * - Transaction history
 * - Deposits (from Stripe payments)
 * - Withdrawals (to Stripe transfers)
 * - Escrow operations (hold/release/refund)
 * - Atomic balance updates
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import {
  ConflictError,
  ExternalServiceError,
  handleStripeError,
  NotFoundError,
  ValidationError,
} from '../middleware/error-handler';
import { stripe } from './consolidated-payment-service';
import { logger } from './logger';

// Initialize Supabase admin client (relaxed typing to avoid PostgREST `never` inference)
let supabaseAdmin: SupabaseClient<any> | null = null;

function getSupabaseAdmin(): SupabaseClient<any> {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient<any>(
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
 * Transaction type enum matching database schema
 */
export type TransactionType = 'deposit' | 'withdrawal' | 'escrow' | 'release' | 'refund';

/**
 * Transaction status enum matching database schema
 */
export type TransactionStatus = 'pending' | 'completed' | 'failed';

/**
 * Transaction filters for querying
 */
export interface TransactionFilters {
  type?: TransactionType;
  status?: TransactionStatus;
  bounty_id?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

/**
 * Wallet transaction record
 */
export interface WalletTransaction {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  description: string;
  status: TransactionStatus;
  bounty_id?: string;
  stripe_payment_intent_id?: string;
  stripe_transfer_id?: string;
  stripe_connect_account_id?: string;
  metadata?: any;
  created_at: string;
  updated_at?: string;
}

/**
 * User balance result
 */
export interface BalanceResult {
  balance: number;
  currency: string;
  user_id: string;
}

/**
 * Paginated transactions result
 */
export interface TransactionsResult {
  transactions: WalletTransaction[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Get user's current wallet balance
 * @param userId - User ID
 * @returns Current balance in USD
 */
export async function getBalance(userId: string): Promise<BalanceResult> {
  const admin = getSupabaseAdmin();
  
  const { data: profile, error } = await admin
    .from('profiles')
    .select('balance')
    .eq('id', userId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('User', userId);
    }
    throw new ExternalServiceError('Supabase', 'Failed to fetch user balance', {
      error: error.message,
    });
  }
  
  return {
    balance: profile?.balance || 0,
    currency: 'USD',
    user_id: userId,
  };
}

/**
 * Get user's transaction history with filters
 * @param userId - User ID
 * @param filters - Optional filters for transactions
 * @returns Paginated transaction list
 */
export async function getTransactions(
  userId: string,
  filters: TransactionFilters = {}
): Promise<TransactionsResult> {
  const admin = getSupabaseAdmin();
  
  const {
    type,
    status,
    bounty_id,
    start_date,
    end_date,
    limit = 50,
    offset = 0,
  } = filters;
  
  // Build query
  let query = admin
    .from('wallet_transactions')
    .select('*', { count: 'exact' })
    .eq('user_id', userId);
  
  // Apply filters
  if (type) {
    query = query.eq('type', type);
  }
  if (status) {
    query = query.eq('status', status);
  }
  if (bounty_id) {
    query = query.eq('bounty_id', bounty_id);
  }
  if (start_date) {
    query = query.gte('created_at', start_date);
  }
  if (end_date) {
    query = query.lte('created_at', end_date);
  }
  
  // Apply sorting and pagination
  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  
  const { data: transactions, error, count } = await query;
  
  if (error) {
    throw new ExternalServiceError('Supabase', 'Failed to fetch transactions', {
      error: error.message,
    });
  }
  
  // Transform to standard format
  const formattedTransactions: WalletTransaction[] = (transactions || []).map((tx: any) => ({
    id: tx.id,
    user_id: tx.user_id,
    type: tx.type,
    amount: tx.amount,
    description: tx.description || `${tx.type} transaction`,
    status: tx.status,
    bounty_id: tx.bounty_id,
    stripe_payment_intent_id: tx.stripe_payment_intent_id,
    stripe_transfer_id: tx.stripe_transfer_id,
    stripe_connect_account_id: tx.stripe_connect_account_id,
    metadata: tx.metadata,
    created_at: tx.created_at,
    updated_at: tx.updated_at,
  }));
  
  return {
    transactions: formattedTransactions,
    total: count || 0,
    limit,
    offset,
  };
}

/**
 * Create a deposit transaction
 * Called from Stripe webhook when payment succeeds
 * @param userId - User ID
 * @param amount - Amount in USD
 * @param paymentIntentId - Stripe payment intent ID
 * @param idempotencyKey - Optional idempotency key for preventing duplicate processing
 * @returns Created transaction
 */
export async function createDeposit(
  userId: string,
  amount: number,
  paymentIntentId: string,
  idempotencyKey?: string
): Promise<WalletTransaction> {
  if (amount <= 0) {
    throw new ValidationError('Deposit amount must be positive');
  }
  
  const admin = getSupabaseAdmin();
  
  // Use payment intent ID and user ID as idempotency key if not provided
  const effectiveIdempotencyKey = idempotencyKey || `deposit_${userId}_${paymentIntentId}`;
  
  // Check for duplicate transaction using payment intent ID
  const { data: existingTx } = await admin
    .from('wallet_transactions')
    .select('id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('type', 'deposit')
    .maybeSingle();
  
  if (existingTx) {
    logger.warn({ 
      paymentIntentId, 
      userId,
      existingTransactionId: existingTx.id 
    }, '[WalletService] Duplicate deposit detected, returning existing transaction');
    
    // Return existing transaction - fetch with error handling
    const { data: transaction, error: fetchError } = await admin
      .from('wallet_transactions')
      .select('*')
      .eq('id', existingTx.id)
      .single();
    
    if (fetchError || !transaction) {
      // If transaction was deleted between checks, log and continue to create new one
      logger.warn({
        existingTransactionId: existingTx.id,
        error: fetchError
      }, '[WalletService] Existing transaction not found, creating new one');
    } else {
      return {
        id: transaction.id,
        user_id: transaction.user_id,
        type: transaction.type,
        amount: transaction.amount,
        description: transaction.description,
        status: transaction.status,
        stripe_payment_intent_id: transaction.stripe_payment_intent_id,
        metadata: transaction.metadata,
        created_at: transaction.created_at,
        updated_at: transaction.updated_at,
      };
    }
  }
  
  // Create transaction record
  const { data: transaction, error: txError } = await admin
    .from('wallet_transactions')
    .insert({
      user_id: userId,
      type: 'deposit',
      amount,
      description: `Deposit via Stripe`,
      status: 'completed',
      stripe_payment_intent_id: paymentIntentId,
      metadata: {
        payment_intent_id: paymentIntentId,
        created_via: 'webhook',
        idempotency_key: effectiveIdempotencyKey,
      },
    })
    .select()
    .single();
  
  if (txError) {
    throw new ExternalServiceError('Supabase', 'Failed to create deposit transaction', {
      error: txError.message,
    });
  }
  
  // Update user balance atomically
  await updateBalance(userId, amount);
  
  return {
    id: transaction.id,
    user_id: transaction.user_id,
    type: transaction.type,
    amount: transaction.amount,
    description: transaction.description,
    status: transaction.status,
    stripe_payment_intent_id: transaction.stripe_payment_intent_id,
    metadata: transaction.metadata,
    created_at: transaction.created_at,
    updated_at: transaction.updated_at,
  };
}

/**
 * Create a withdrawal transaction
 * Initiates Stripe transfer to user's connected account
 * @param userId - User ID
 * @param amount - Amount in USD
 * @param destination - Stripe Connect account ID or bank account token
 * @param idempotencyKey - Optional idempotency key for preventing duplicate withdrawals
 * @returns Created transaction
 */
export async function createWithdrawal(
  userId: string,
  amount: number,
  destination: string,
  idempotencyKey?: string
): Promise<WalletTransaction> {
  if (amount <= 0) {
    throw new ValidationError('Withdrawal amount must be positive');
  }
  
  const admin = getSupabaseAdmin();
  
  // Generate deterministic idempotency key from transaction details
  // Note: Use fixed-point representation for amount to ensure consistency
  const amountKey = amount.toFixed(2).replace('.', '');
  const effectiveIdempotencyKey = idempotencyKey || `withdrawal_${userId}_${amountKey}_${destination.slice(-4)}`;
  
  // Create pending transaction (balance not yet deducted)
  const { data: transaction, error: txError } = await admin
    .from('wallet_transactions')
    .insert({
      user_id: userId,
      type: 'withdrawal',
      amount: -amount, // Negative for debit
      description: `Withdrawal to account ending in ${destination.slice(-4)}`,
      status: 'pending',
      stripe_connect_account_id: destination,
      metadata: {
        idempotency_key: effectiveIdempotencyKey,
      },
    })
    .select()
    .single();
  
  if (txError) {
    throw new ExternalServiceError('Supabase', 'Failed to create withdrawal transaction', {
      error: txError.message,
    });
  }
  
  try {
    // Deduct from balance atomically (this validates sufficient balance)
    await updateBalance(userId, -amount);
    
    // Initiate Stripe transfer with idempotency key
    const transferParams: Stripe.TransferCreateParams = {
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      destination,
      metadata: {
        user_id: userId,
        transaction_id: transaction.id,
      },
    };
    
    const transfer = await stripe.transfers.create(
      transferParams,
      idempotencyKey ? { idempotencyKey } : {}
    );
    
    // Update transaction with transfer ID and mark as completed
    const { error: updateError } = await admin
      .from('wallet_transactions')
      .update({
        stripe_transfer_id: transfer.id,
        status: 'completed',
        metadata: {
          ...transaction.metadata,
          transfer_id: transfer.id,
          transfer_created: new Date().toISOString(),
        },
      })
      .eq('id', transaction.id);
    
    if (updateError) {
      logger.error({ 
        transactionId: transaction.id, 
        transferId: transfer.id, 
        error: updateError 
      }, '[WalletService] Failed to update transaction with transfer ID');
    }
    
    return {
      id: transaction.id,
      user_id: transaction.user_id,
      type: transaction.type,
      amount: transaction.amount,
      description: transaction.description,
      status: 'completed',
      stripe_transfer_id: transfer.id,
      stripe_connect_account_id: destination,
      metadata: transaction.metadata,
      created_at: transaction.created_at,
      updated_at: transaction.updated_at,
    };
  } catch (error) {
    const handledError = handleStripeError(error);
    
    // Best-effort: mark transaction as failed
    try {
      await admin
        .from('wallet_transactions')
        .update({ status: 'failed' })
        .eq('id', transaction.id);
    } catch (txUpdateError) {
      logger.error({
        userId,
        transactionId: transaction.id,
        error: txUpdateError instanceof Error ? txUpdateError.message : String(txUpdateError),
      }, '[WalletService] Failed to mark withdrawal transaction as failed');
    }
    
    // Best-effort: refund the balance (rollback)
    // Only attempt if balance was actually deducted (error occurred after updateBalance)
    if (!(error instanceof ValidationError && error.message?.includes('Insufficient balance'))) {
      try {
        await updateBalance(userId, amount);
      } catch (rollbackError) {
        logger.error({
          userId,
          transactionId: transaction.id,
          amount,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        }, '[WalletService] CRITICAL: Failed to rollback user balance after withdrawal failure');
      }
    }
    
    throw handledError;
  }
}

/**
 * Create an escrow transaction
 * Called when bounty is accepted - holds funds from poster
 * @param bountyId - Bounty ID
 * @param posterId - Poster user ID
 * @param amount - Amount in USD
 * @param idempotencyKey - Optional idempotency key for preventing duplicate escrow
 * @returns Created transaction
 */
export async function createEscrow(
  bountyId: string,
  posterId: string,
  amount: number,
  idempotencyKey?: string
): Promise<WalletTransaction> {
  if (amount <= 0) {
    throw new ValidationError('Escrow amount must be positive');
  }
  
  const admin = getSupabaseAdmin();
  
  // Generate effective idempotency key
  const effectiveIdempotencyKey = idempotencyKey || `escrow_${bountyId}_${posterId}`;
  
  // Check for existing escrow transaction to prevent duplicates
  const { data: existingEscrow } = await admin
    .from('wallet_transactions')
    .select('id')
    .eq('bounty_id', bountyId)
    .eq('type', 'escrow')
    .eq('status', 'completed')
    .maybeSingle();
  
  if (existingEscrow) {
    throw new ConflictError('Escrow already exists for this bounty');
  }
  
  // Create escrow transaction
  const { data: transaction, error: txError } = await admin
    .from('wallet_transactions')
    .insert({
      user_id: posterId,
      bounty_id: bountyId,
      type: 'escrow',
      amount: -amount, // Negative for debit
      description: `Escrow for bounty ${bountyId}`,
      status: 'completed',
      metadata: {
        bounty_id: bountyId,
        escrowed_at: new Date().toISOString(),
        idempotency_key: effectiveIdempotencyKey,
      },
    })
    .select()
    .single();
  
  if (txError) {
    throw new ExternalServiceError('Supabase', 'Failed to create escrow transaction', {
      error: txError.message,
    });
  }
  
  // Deduct from poster's balance atomically (validates sufficient balance)
  await updateBalance(posterId, -amount);
  
  return {
    id: transaction.id,
    user_id: transaction.user_id,
    type: transaction.type,
    amount: transaction.amount,
    description: transaction.description,
    status: transaction.status,
    bounty_id: transaction.bounty_id,
    metadata: transaction.metadata,
    created_at: transaction.created_at,
    updated_at: transaction.updated_at,
  };
}

/**
 * Release escrow to hunter
 * Called when bounty is completed
 * @param bountyId - Bounty ID
 * @param hunterId - Hunter user ID
 * @param idempotencyKey - Optional idempotency key for preventing duplicate releases
 * @returns Created release transaction
 */
export async function releaseEscrow(
  bountyId: string,
  hunterId: string,
  idempotencyKey?: string
): Promise<WalletTransaction> {
  const admin = getSupabaseAdmin();
  
  // Generate effective idempotency key
  const effectiveIdempotencyKey = idempotencyKey || `release_${bountyId}_${hunterId}`;
  
  // Check for existing release or refund to prevent double-release
  const { data: existingRelease } = await admin
    .from('wallet_transactions')
    .select('id, type')
    .eq('bounty_id', bountyId)
    .in('type', ['release', 'refund'])
    .eq('status', 'completed')
    .maybeSingle();
  
  if (existingRelease) {
    throw new ConflictError(`Escrow already ${existingRelease.type === 'release' ? 'released' : 'refunded'} for this bounty`);
  }
  
  // Find the escrow transaction
  const { data: escrowTx, error: escrowError } = await admin
    .from('wallet_transactions')
    .select('*')
    .eq('bounty_id', bountyId)
    .eq('type', 'escrow')
    .eq('status', 'completed')
    .single();
  
  if (escrowError || !escrowTx) {
    throw new NotFoundError('Escrow transaction', bountyId);
  }
  
  const amount = Math.abs(escrowTx.amount);
  
  // Create release transaction
  const { data: transaction, error: txError } = await admin
    .from('wallet_transactions')
    .insert({
      user_id: hunterId,
      bounty_id: bountyId,
      type: 'release',
      amount, // Positive for credit
      description: `Payment for bounty ${bountyId}`,
      status: 'completed',
      metadata: {
        bounty_id: bountyId,
        escrow_transaction_id: escrowTx.id,
        released_at: new Date().toISOString(),
        idempotency_key: effectiveIdempotencyKey,
      },
    })
    .select()
    .single();
  
  if (txError) {
    throw new ExternalServiceError('Supabase', 'Failed to create release transaction', {
      error: txError.message,
    });
  }
  
  // Add to hunter's balance atomically
  await updateBalance(hunterId, amount);
  
  return {
    id: transaction.id,
    user_id: transaction.user_id,
    type: transaction.type,
    amount: transaction.amount,
    description: transaction.description,
    status: transaction.status,
    bounty_id: transaction.bounty_id,
    metadata: transaction.metadata,
    created_at: transaction.created_at,
    updated_at: transaction.updated_at,
  };
}

/**
 * Refund escrow to poster
 * Called when bounty is cancelled or disputed
 * @param bountyId - Bounty ID
 * @param posterId - Poster user ID
 * @param reason - Refund reason
 * @param idempotencyKey - Optional idempotency key for preventing duplicate refunds
 * @returns Created refund transaction
 */
export async function refundEscrow(
  bountyId: string,
  posterId: string,
  reason: string,
  idempotencyKey?: string
): Promise<WalletTransaction> {
  const admin = getSupabaseAdmin();
  
  // Generate effective idempotency key
  const effectiveIdempotencyKey = idempotencyKey || `refund_${bountyId}_${posterId}`;
  
  // Check for existing release or refund to prevent double-refund
  const { data: existingRelease } = await admin
    .from('wallet_transactions')
    .select('id, type')
    .eq('bounty_id', bountyId)
    .in('type', ['release', 'refund'])
    .eq('status', 'completed')
    .maybeSingle();
  
  if (existingRelease) {
    throw new ConflictError(`Escrow already ${existingRelease.type === 'release' ? 'released' : 'refunded'} for this bounty`);
  }
  
  // Find the escrow transaction
  const { data: escrowTx, error: escrowError } = await admin
    .from('wallet_transactions')
    .select('*')
    .eq('bounty_id', bountyId)
    .eq('type', 'escrow')
    .eq('status', 'completed')
    .single();
  
  if (escrowError || !escrowTx) {
    throw new NotFoundError('Escrow transaction', bountyId);
  }
  
  const amount = Math.abs(escrowTx.amount);
  
  // Create refund transaction
  const { data: transaction, error: txError } = await admin
    .from('wallet_transactions')
    .insert({
      user_id: posterId,
      bounty_id: bountyId,
      type: 'refund',
      amount, // Positive for credit
      description: `Refund for bounty ${bountyId}: ${reason}`,
      status: 'completed',
      metadata: {
        bounty_id: bountyId,
        escrow_transaction_id: escrowTx.id,
        reason,
        refunded_at: new Date().toISOString(),
        idempotency_key: effectiveIdempotencyKey,
      },
    })
    .select()
    .single();
  
  if (txError) {
    throw new ExternalServiceError('Supabase', 'Failed to create refund transaction', {
      error: txError.message,
    });
  }
  
  // Add back to poster's balance atomically
  await updateBalance(posterId, amount);
  
  return {
    id: transaction.id,
    user_id: transaction.user_id,
    type: transaction.type,
    amount: transaction.amount,
    description: transaction.description,
    status: transaction.status,
    bounty_id: transaction.bounty_id,
    metadata: transaction.metadata,
    created_at: transaction.created_at,
    updated_at: transaction.updated_at,
  };
}

/**
 * Atomic balance update helper
 * Uses optimistic locking to prevent race conditions
 * @param userId - User ID
 * @param amount - Amount to add (positive) or subtract (negative)
 */
export async function updateBalance(userId: string, amount: number): Promise<void> {
  const admin = getSupabaseAdmin();
  
  // Try RPC function first (if it exists in the future)
  // Use loose typing for RPC until Database.Functions are modeled
  const { error: rpcError } = await (admin as any).rpc('update_balance', {
    p_user_id: userId,
    p_amount: amount,
  });
  
  // If RPC function doesn't exist, fall back to optimistic locking
  // Check for specific Postgres error indicating function doesn't exist
  if (rpcError) {
    const errorCode = (rpcError as any).code;
    
    // PGRST202: Function not found in Supabase PostgREST
    const isFunctionNotFound = errorCode === 'PGRST202';
    
    if (isFunctionNotFound) {
      // Optimistic locking approach
      const MAX_RETRIES = 3;
      let retries = 0;
      
      while (retries < MAX_RETRIES) {
        try {
          // Read current balance
          const { data: profile, error: readError } = await admin
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();
          
          if (readError) {
            if (readError.code === 'PGRST116') {
              throw new NotFoundError('User', userId);
            }
            throw new ExternalServiceError('Supabase', 'Failed to fetch user balance', {
              error: readError.message,
            });
          }
          
          const oldBalance = profile.balance || 0;
          const newBalance = oldBalance + amount;
          
          // Check for negative balance
          if (newBalance < 0) {
            throw new ValidationError('Insufficient balance');
          }
          
          // Update with optimistic lock (WHERE balance = old_balance)
          const { data: updated, error: updateError } = await admin
            .from('profiles')
            .update({ balance: newBalance })
            .eq('id', userId)
            .eq('balance', oldBalance)
            .select();
          
          if (updateError) {
            throw new ExternalServiceError('Supabase', 'Failed to update balance', {
              error: updateError.message,
            });
          }
          
          // If no rows updated, balance changed (optimistic lock failed)
          if (!updated || updated.length === 0) {
            throw new ConflictError('Balance changed during update, please retry');
          }
          
          // Success
          return;
        } catch (error) {
          // Re-throw non-conflict errors immediately
          if (!(error instanceof ConflictError)) {
            throw error;
          }
          
          // ConflictError: apply retry policy with backoff
          retries++;
          if (retries >= MAX_RETRIES) {
            throw new ConflictError('Balance changed during update after multiple retries, please try again');
          }
          
          // Wait before retry with reasonable exponential backoff (100ms, 200ms, 400ms)
          const delayMs = Math.min(1000, 100 * Math.pow(2, retries - 1));
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    } else {
      // RPC function exists but failed - interpret the error appropriately
      const errorMessage = rpcError.message?.toLowerCase() || '';
      
      // Check for specific error patterns and throw appropriate error types
      if (errorMessage.includes('insufficient') || errorMessage.includes('negative')) {
        throw new ValidationError('Insufficient balance');
      } else if (errorMessage.includes('not found') || errorMessage.includes('does not exist')) {
        throw new NotFoundError('User', userId);
      } else {
        throw new ExternalServiceError('Supabase', 'Failed to update balance via RPC', {
          error: rpcError.message,
        });
      }
    }
  }
  
  // RPC succeeded
}

/**
 * Export service instance
 */
export const consolidatedWalletService = {
  getBalance,
  getTransactions,
  createDeposit,
  createWithdrawal,
  createEscrow,
  releaseEscrow,
  refundEscrow,
  updateBalance,
};
