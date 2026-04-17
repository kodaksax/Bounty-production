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
import type { TransactionType } from '../types/wallet-transaction-types';
import { stripe } from './consolidated-payment-service';
import { logger } from './logger';
import { withStripeIdempotency } from './stripe-safeguards';

// Initialize Supabase admin client (relaxed typing to avoid PostgREST `never` inference)
let supabaseAdmin: SupabaseClient<any> | null = null;

function getSupabaseAdmin(): SupabaseClient<any> {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient<any>(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabaseAdmin;
}

export type { TransactionType } from '../types/wallet-transaction-types';

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
 * Helper function to transform database record to WalletTransaction
 * Ensures type safety and reduces code duplication
 */
function toWalletTransaction(dbRecord: any): WalletTransaction {
  return {
    id: dbRecord.id,
    user_id: dbRecord.user_id,
    type: dbRecord.type,
    amount: dbRecord.amount,
    description: dbRecord.description,
    status: dbRecord.status,
    bounty_id: dbRecord.bounty_id,
    stripe_payment_intent_id: dbRecord.stripe_payment_intent_id,
    stripe_transfer_id: dbRecord.stripe_transfer_id,
    stripe_connect_account_id: dbRecord.stripe_connect_account_id,
    metadata: dbRecord.metadata,
    created_at: dbRecord.created_at,
    updated_at: dbRecord.updated_at,
  };
}

/**
 * User balance result
 */
export interface BalanceResult {
  balance: number;
  currency: string;
  user_id: string;
  payoutFailedAt: string | null;
  payoutFailureCode: string | null;
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
 * Compute the authoritative balance by summing completed wallet_transactions.
 * Used as a cross-check / fallback when profiles.balance might be stale.
 *
 * wallet_transactions stores **signed** amounts: deposits/releases/refunds are
 * positive, escrows/withdrawals are negative. We therefore sum them directly
 * instead of applying direction based on type, which would double-negate debits.
 */
async function deriveBalanceFromTransactions(
  admin: SupabaseClient<any>,
  userId: string
): Promise<number> {
  const { data: transactions, error } = await admin
    .from('wallet_transactions')
    .select('amount')
    .eq('user_id', userId)
    .eq('status', 'completed');

  if (error || !transactions) return 0;

  let balance = 0;
  for (const tx of transactions) {
    balance += Number(tx.amount) || 0;
  }
  return balance;
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
    .select('balance, payout_failed_at, payout_failure_code')
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

  let balance = profile?.balance || 0;

  // Cross-check: when the cached profile balance is 0, compute the
  // authoritative balance from wallet_transactions.  This catches cases
  // where a deposit webhook created a transaction but profiles.balance
  // was not updated (e.g. race condition, partial failure, or a code path
  // that inserts into wallet_transactions without updating profiles).
  if (balance === 0) {
    const derivedBalance = await deriveBalanceFromTransactions(admin, userId);
    if (derivedBalance > 0) {
      balance = derivedBalance;
      // Reconcile the stale cached value (fire-and-forget).
      // Wrap in Promise.resolve() to get a full Promise with .catch() support.
      // The Supabase update resolves with { data, error } rather than rejecting
      // on DB errors, so we must check the error field inside .then().
      Promise.resolve(
        admin
          .from('profiles')
          .update({ balance: derivedBalance, updated_at: new Date().toISOString() })
          .eq('id', userId)
      )
        .then(({ error: reconcileErr }: { error: any }) => {
          if (reconcileErr) {
            logger.warn(
              { userId, derivedBalance, err: reconcileErr },
              '[WalletService] Failed to reconcile cached balance'
            );
          } else {
            logger.info(
              { userId, derivedBalance },
              '[WalletService] Reconciled stale profile balance'
            );
          }
        })
        .catch((err: unknown) => {
          logger.warn(
            { userId, derivedBalance, err },
            '[WalletService] Failed to reconcile cached balance'
          );
        });
    }
  }

  return {
    balance,
    currency: 'USD',
    user_id: userId,
    payoutFailedAt: profile?.payout_failed_at ?? null,
    payoutFailureCode: profile?.payout_failure_code ?? null,
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

  const { type, status, bounty_id, start_date, end_date, limit = 50, offset = 0 } = filters;

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
  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

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
    logger.warn(
      {
        paymentIntentId,
        userId,
        existingTransactionId: existingTx.id,
      },
      '[WalletService] Duplicate deposit detected, returning existing transaction'
    );

    // Return existing transaction - fetch with error handling
    const { data: transaction, error: fetchError } = await admin
      .from('wallet_transactions')
      .select('*')
      .eq('id', existingTx.id)
      .single();

    if (fetchError || !transaction) {
      // If transaction was deleted between checks, log and continue to create new one
      logger.warn(
        {
          existingTransactionId: existingTx.id,
          error: fetchError,
        },
        '[WalletService] Existing transaction not found, creating new one'
      );
    } else {
      return toWalletTransaction(transaction);
    }
  }

  // Use atomic RPC to insert transaction and update balance in a single idempotent operation.
  // This prevents race conditions where concurrent callers both insert the same
  // stripe_payment_intent_id and double-credit the user's balance.
  const { data: applyRes, error: applyErr } = await admin.rpc('apply_deposit', {
    p_user_id: userId,
    p_amount: amount,
    p_payment_intent_id: paymentIntentId,
    p_metadata: {
      payment_intent_id: paymentIntentId,
      created_via: 'service',
      idempotency_key: effectiveIdempotencyKey,
    },
  });

  if (applyErr) {
    throw new ExternalServiceError('Supabase', 'Failed to apply deposit via RPC', {
      error: applyErr.message,
    });
  }

  // Try to resolve the transaction inserted (or existing) by payment intent id.
  // This read is best-effort: if the RPC succeeded but a subsequent transient
  // database read fails, we should not treat the whole operation as failed
  // because the user's balance may already have been updated. In that case
  // log a warning and return a minimal transaction object so callers see
  // success instead of a 500.
  const applyRow = Array.isArray(applyRes) && applyRes.length ? applyRes[0] : applyRes;
  const applied = !!(applyRow && (applyRow as any).applied);
  const appliedTxId: string | null =
    applyRow && (applyRow as any).tx_id ? String((applyRow as any).tx_id) : null;

  try {
    const tx = await getTransactionByPaymentIntent(paymentIntentId);
    if (tx) return tx;

    // If not found by payment intent, try fetching by the tx id returned from RPC
    if (appliedTxId) {
      const { data: txById, error: txByIdErr } = await admin
        .from('wallet_transactions')
        .select('*')
        .eq('id', appliedTxId)
        .maybeSingle();

      if (txById) return toWalletTransaction(txById);
      if (txByIdErr) {
        logger.warn(
          { appliedTxId, paymentIntentId, userId, error: txByIdErr },
          '[WalletService] Failed to fetch transaction by id after apply_deposit'
        );
      }
    }
  } catch (e: any) {
    logger.warn(
      { paymentIntentId, userId, error: e instanceof Error ? e.message : String(e) },
      '[WalletService] Non-fatal: failed to fetch transaction after apply_deposit'
    );
  }

  // If RPC indicated the deposit was applied (or returned a tx id), return a
  // minimal constructed transaction so callers observe success instead of an error.
  if (applied || appliedTxId) {
    const now = new Date().toISOString();
    return toWalletTransaction({
      id: appliedTxId || '',
      user_id: userId,
      type: 'deposit',
      amount,
      description: `Deposit via Stripe`,
      status: 'completed',
      bounty_id: null,
      stripe_payment_intent_id: paymentIntentId,
      stripe_transfer_id: null,
      stripe_connect_account_id: null,
      metadata: {
        payment_intent_id: paymentIntentId,
        created_via: 'service',
      },
      created_at: now,
      updated_at: now,
    });
  }

  // RPC did not return or transaction not found. Fallback to legacy insert
  // for environments where the RPC is not available (e.g., older test mocks).
  // This preserves previous behavior while keeping RPC as the preferred path.
  try {
    const { data: transaction, error: txError } = await admin
      .from('wallet_transactions')
      .insert([
        {
          user_id: userId,
          type: 'deposit',
          amount,
          description: `Deposit via Stripe`,
          status: 'completed',
          stripe_payment_intent_id: paymentIntentId,
          metadata: {
            payment_intent_id: paymentIntentId,
            created_via: 'service_fallback',
            idempotency_key: effectiveIdempotencyKey,
          },
        },
      ])
      .select()
      .single();

    if (txError) {
      throw new ExternalServiceError(
        'Supabase',
        'Failed to create deposit transaction (fallback)',
        {
          error: txError.message,
        }
      );
    }

    // Update user balance atomically as fallback
    await updateBalance(userId, amount);

    return toWalletTransaction(transaction);
  } catch (e: any) {
    throw e;
  }
}

/**
 * Find a wallet transaction by Stripe payment intent ID
 * Returns the transaction record or null if not found
 */
export async function getTransactionByPaymentIntent(paymentIntentId: string) {
  const admin = getSupabaseAdmin();

  const { data: transaction, error } = await admin
    .from('wallet_transactions')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (error) {
    // If Supabase returns a not-found style error, treat as no transaction
    // Otherwise surface as ExternalServiceError
    if ((error as any).code === 'PGRST116') {
      return null;
    }
    throw new ExternalServiceError('Supabase', 'Failed to query transaction by payment intent', {
      error: error.message,
    });
  }

  if (!transaction) return null;

  return toWalletTransaction(transaction);
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
  const amountKey = amount.toFixed(2).replace(/\./g, '');
  const effectiveIdempotencyKey =
    idempotencyKey || `withdrawal_${userId}_${amountKey}_${destination.slice(-4)}`;

  // Create pending transaction (balance not yet deducted).
  // The unique partial index idx_wallet_tx_one_pending_withdrawal prevents
  // more than one pending withdrawal per user, guarding against race
  // conditions where the client submits two requests in rapid succession.
  const { data: transaction, error: txError } = await admin
    .from('wallet_transactions')
    .insert([
      {
        user_id: userId,
        type: 'withdrawal',
        amount: -amount, // Negative for debit
        description: `Withdrawal to account ending in ${destination.slice(-4)}`,
        status: 'pending',
        stripe_connect_account_id: destination,
        metadata: {
          idempotency_key: effectiveIdempotencyKey,
        },
      },
    ])
    .select()
    .single();

  if (txError) {
    // Unique index violation means a withdrawal is already in-flight for this user.
    if (txError.code === '23505') {
      throw new ConflictError(
        'A withdrawal is already in progress. Please wait for it to complete before initiating a new one.'
      );
    }
    throw new ExternalServiceError('Supabase', 'Failed to create withdrawal transaction', {
      error: txError.message,
    });
  }

  let balanceDeducted = false;
  try {
    // Deduct from balance atomically via withdraw_balance which enforces:
    //   balance - balance_on_hold >= amount  (prevents draining held funds)
    //   balance_frozen = false              (Stripe chargeback guard)
    await withdrawBalance(userId, amount);
    balanceDeducted = true;

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

    const transfer = await withStripeIdempotency(effectiveIdempotencyKey, async (opts: any = {}) =>
      stripe.transfers.create(transferParams, opts)
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
      logger.error(
        {
          transactionId: transaction.id,
          transferId: transfer.id,
          error: updateError,
        },
        '[WalletService] Failed to update transaction with transfer ID'
      );
    }

    return toWalletTransaction({
      ...transaction,
      status: 'completed',
      stripe_transfer_id: transfer.id,
      stripe_connect_account_id: destination,
    });
  } catch (error) {
    const handledError = handleStripeError(error);

    // Best-effort: mark transaction as failed
    try {
      await admin.from('wallet_transactions').update({ status: 'failed' }).eq('id', transaction.id);
    } catch (txUpdateError) {
      logger.error(
        {
          userId,
          transactionId: transaction.id,
          error: txUpdateError instanceof Error ? txUpdateError.message : String(txUpdateError),
        },
        '[WalletService] Failed to mark withdrawal transaction as failed'
      );
    }

    // Best-effort: refund the balance (rollback)
    // Only attempt if balance was actually deducted (withdrawBalance succeeded before the error).
    // withdrawBalance's RPC is atomic so any error from it means no deduction occurred.
    if (balanceDeducted) {
      try {
        await updateBalance(userId, amount);
      } catch (rollbackError) {
        logger.error(
          {
            userId,
            transactionId: transaction.id,
            amount,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          },
          '[WalletService] CRITICAL: Failed to rollback user balance after withdrawal failure'
        );

        // Flag the transaction so the reconciliation cron can detect and restore
        // the deducted balance automatically. This prevents funds from being
        // permanently locked if both the Stripe transfer and balance rollback fail.
        try {
          const { error: flagError }: { error: any } = (await admin
            .from('wallet_transactions')
            .update({
              metadata: {
                ...transaction.metadata,
                needs_balance_refund: true,
                needs_balance_refund_amount: amount,
                rollback_failed_at: new Date().toISOString(),
              },
            })
            .eq('id', transaction.id)) as any;

          if (flagError) {
            logger.error(
              { userId, transactionId: transaction.id, amount, error: flagError },
              '[WalletService] CRITICAL: Failed to flag transaction for balance refund - manual intervention required'
            );
          }
        } catch (flagErr) {
          logger.error(
            {
              userId,
              transactionId: transaction.id,
              amount,
              error: flagErr instanceof Error ? flagErr.message : String(flagErr),
            },
            '[WalletService] CRITICAL: Failed to flag transaction for balance refund - manual intervention required'
          );
        }
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

  // Check for existing escrow transaction to prevent duplicates.
  // Include 'pending' so that an in-flight or failed-mid-flight escrow also
  // blocks a retry, preventing double deductions.
  const { data: existingEscrow } = await admin
    .from('wallet_transactions')
    .select('id, status')
    .eq('bounty_id', bountyId)
    .eq('type', 'escrow')
    .in('status', ['pending', 'completed'])
    .maybeSingle();

  if (existingEscrow) {
    if (existingEscrow.status === 'pending') {
      throw new ConflictError('Escrow is already being processed for this bounty');
    }
    throw new ConflictError('Escrow already exists for this bounty');
  }

  // Insert the escrow record as 'pending' first.  This acts as a distributed
  // lock: concurrent retries will see the pending record and throw a conflict
  // before touching the user's balance.  It also creates an immutable audit
  // trail — on any failure the record is updated to 'failed' so ops can
  // identify transactions that need manual reconciliation.
  // withdrawBalance (called below) enforces balance_on_hold and balance_frozen
  // checks; updateBalance(posterId, -amount) would bypass those guards.
  const { data: transaction, error: txError } = await admin
    .from('wallet_transactions')
    .insert([
      {
        user_id: posterId,
        bounty_id: bountyId,
        type: 'escrow',
        amount: -amount, // Negative for debit
        description: `Escrow for bounty ${bountyId}`,
        status: 'pending',
        metadata: {
          bounty_id: bountyId,
          escrowed_at: new Date().toISOString(),
          idempotency_key: effectiveIdempotencyKey,
        },
      },
    ])
    .select()
    .single();

  if (txError) {
    throw new ExternalServiceError('Supabase', 'Failed to create escrow transaction', {
      error: txError.message,
    });
  }

  // Deduct from poster's balance.  If this fails we mark the pending record as
  // 'failed' (releasing the lock) so the caller can safely retry.
  try {
    await withdrawBalance(posterId, amount);
  } catch (withdrawError) {
    const { error: markFailedError } = await admin
      .from('wallet_transactions')
      .update({ status: 'failed' })
      .eq('id', transaction.id);
    if (markFailedError) {
      // If we can't mark the record as failed it will remain 'pending', permanently
      // blocking new escrow attempts for this bounty. Log so ops can reconcile.
      logger.error(
        {
          transactionId: transaction.id,
          bountyId,
          error: markFailedError.message,
        },
        '[createEscrow] CRITICAL: Failed to mark escrow transaction as failed after withdraw error — record stuck in pending'
      );
    }
    throw withdrawError;
  }

  // Finalize: flip the record from 'pending' to 'completed'.
  const { error: completeError } = await admin
    .from('wallet_transactions')
    .update({ status: 'completed' })
    .eq('id', transaction.id);

  if (completeError) {
    // The balance was already deducted — attempt to refund it.
    const { error: refundError } = await updateBalance(posterId, amount).then(
      () => ({ error: null as null }),
      (e: unknown) => ({ error: e })
    );

    // Mark the record as failed regardless of whether the refund succeeded.
    const { error: markFailedError } = await admin
      .from('wallet_transactions')
      .update({ status: 'failed' })
      .eq('id', transaction.id);
    if (markFailedError) {
      // If we can't mark the record as failed it will remain 'pending', permanently
      // blocking new escrow attempts for this bounty. Balance may also have been
      // deducted without a refund — log so ops can reconcile both.
      logger.error(
        {
          transactionId: transaction.id,
          bountyId,
          amount,
          error: markFailedError.message,
        },
        '[createEscrow] CRITICAL: Failed to mark escrow transaction as failed after finalize error — record stuck in pending, balance may need manual refund'
      );
    }

    if (refundError) {
      // Refund also failed — flag the record so ops can reconcile manually.
      // Merge reconciliation flags into the existing metadata instead of
      // replacing it, so bounty_id, escrowed_at, and idempotency_key are
      // preserved for the audit trail.
      const existingMetadata =
        typeof transaction.metadata === 'object' && transaction.metadata !== null
          ? transaction.metadata
          : {};
      await admin
        .from('wallet_transactions')
        .update({
          metadata: {
            ...existingMetadata,
            needs_balance_refund: true,
            needs_balance_refund_amount: amount,
          },
        })
        .eq('id', transaction.id);
    }

    throw new ExternalServiceError('Supabase', 'Failed to finalize escrow transaction', {
      error: completeError.message,
    });
  }

  return toWalletTransaction({ ...transaction, status: 'completed' });
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
    throw new ConflictError(
      `Escrow already ${existingRelease.type === 'release' ? 'released' : 'refunded'} for this bounty`
    );
  }

  // Find the escrow transaction
  const { data: escrowTx, error: escrowError } = await admin
    .from('wallet_transactions')
    .select('*')
    .eq('bounty_id', bountyId)
    .eq('type', 'escrow')
    .eq('status', 'completed')
    .single();

  let totalAmount: number;

  if (escrowError || !escrowTx) {
    // No server-side escrow record found.  This can happen for bounties created
    // through the legacy client path that deducted funds locally (via withdraw /
    // bounty_posted) without calling the /wallet/escrow endpoint.  Fall back to
    // the bounty's stored amount so the release can still proceed.
    const { data: bountyRecord, error: bountyLookupError } = await admin
      .from('bounties')
      .select('amount, is_for_honor')
      .eq('id', bountyId)
      .single();

    if (bountyLookupError || !bountyRecord || !bountyRecord.amount || bountyRecord.is_for_honor) {
      throw new NotFoundError('Escrow transaction', bountyId);
    }

    totalAmount = Math.abs(Number(bountyRecord.amount));
    if (totalAmount <= 0 || Number.isNaN(totalAmount)) {
      throw new NotFoundError('Escrow transaction', bountyId);
    }

    logger.warn(
      { bountyId, hunterId, amount: totalAmount },
      '[releaseEscrow] No escrow record found; falling back to bounty amount for release'
    );
  } else {
    totalAmount = Math.abs(escrowTx.amount);
  }

  // Calculate platform fee
  const platformFeePercent = config.stripe.platformFeePercent || 5;
  const platformFee = Number(((totalAmount * platformFeePercent) / 100).toFixed(2));
  const hunterAmount = totalAmount - platformFee;

  // Record release transaction for hunter
  const { data: transaction, error: txError } = await admin
    .from('wallet_transactions')
    .insert([
      {
        user_id: hunterId,
        bounty_id: bountyId,
        type: 'release',
        amount: hunterAmount, // Positive for credit
        description: `Payment for bounty ${bountyId}`,
        status: 'completed',
        metadata: {
          bounty_id: bountyId,
          escrow_transaction_id: escrowTx?.id ?? null,
          platform_fee: platformFee,
          released_at: new Date().toISOString(),
          idempotency_key: effectiveIdempotencyKey,
        },
      },
    ])
    .select()
    .single();

  if (txError) {
    throw new ExternalServiceError('Supabase', 'Failed to create release transaction', {
      error: txError.message,
    });
  }

  // Record platform fee in the dedicated platform_ledger table.
  // This table does not require a user UUID, avoiding ghost/fake user references.
  await recordPlatformFeeWithClient(admin, {
    bountyId,
    amount: platformFee,
    description: `Platform fee for bounty ${bountyId}`,
    metadata: {
      source_transaction_id: transaction.id,
    },
  });

  // Add to hunter's balance atomically
  await updateBalance(hunterId, hunterAmount);

  // Best effort: Attempt Stripe transfer if hunter has a connected account
  try {
    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_connect_account_id')
      .eq('id', hunterId)
      .single();

    if (profile?.stripe_connect_account_id) {
      const transfer = await withStripeIdempotency(
        `tr_${effectiveIdempotencyKey}`,
        async (opts: any = {}) =>
          stripe.transfers.create(
            {
              amount: Math.round(hunterAmount * 100),
              currency: 'usd',
              destination: profile.stripe_connect_account_id,
              metadata: {
                bounty_id: bountyId,
                transaction_id: transaction.id,
              },
            },
            opts
          )
      );

      // Update transaction with transfer ID
      await admin
        .from('wallet_transactions')
        .update({ stripe_transfer_id: transfer.id })
        .eq('id', transaction.id);
    }
  } catch (stripeError) {
    logger.error(
      {
        error: stripeError,
        bountyId,
        hunterId,
      },
      '[WalletService] Stripe transfer failed during escrow release'
    );
    // We don't throw here as the balance and ledger are already updated
  }

  return toWalletTransaction(transaction);
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
    throw new ConflictError(
      `Escrow already ${existingRelease.type === 'release' ? 'released' : 'refunded'} for this bounty`
    );
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
    .insert([
      {
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
      },
    ])
    .select()
    .single();

  if (txError) {
    throw new ExternalServiceError('Supabase', 'Failed to create refund transaction', {
      error: txError.message,
    });
  }

  // Add back to poster's balance atomically
  await updateBalance(posterId, amount);

  return toWalletTransaction(transaction);
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
            throw new ConflictError(
              'Balance changed during update after multiple retries, please try again'
            );
          }

          // Wait before retry with reasonable exponential backoff (100ms, 200ms, 400ms)
          const delayMs = Math.min(1000, 100 * Math.pow(2, retries - 1));
          await new Promise(resolve => setTimeout(resolve, delayMs));
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
 * Atomically withdraw `amount` from a user's wallet balance, enforcing:
 *   1. balance - balance_on_hold >= amount  (dispute hold guard)
 *   2. balance_frozen = false               (Stripe chargeback guard)
 *
 * Uses the `withdraw_balance` DB RPC which holds a row-lock to prevent
 * race conditions. Use this instead of `updateBalance(userId, -amount)`
 * for all withdrawal paths.
 *
 * @param userId - User ID to withdraw from
 * @param amount - Positive dollar amount to deduct
 */
export async function withdrawBalance(userId: string, amount: number): Promise<void> {
  if (amount <= 0) {
    throw new ValidationError('Withdrawal amount must be positive');
  }

  const admin = getSupabaseAdmin();

  const { error: rpcError } = await (admin as any).rpc('withdraw_balance', {
    p_user_id: userId,
    p_amount: amount,
  });

  if (rpcError) {
    const errorCode = (rpcError as any).code;
    const errorMessage = rpcError.message?.toLowerCase() || '';

    if (errorCode === 'PGRST202') {
      // Fail closed: falling back to update_balance would bypass balance_on_hold
      // enforcement and reintroduce the exact drain scenario this function prevents.
      logger.error(
        { userId, amount, errorCode, error: rpcError.message },
        '[WalletService] withdraw_balance RPC not found; refusing insecure legacy fallback'
      );
      throw new ExternalServiceError(
        'Supabase',
        'Withdrawal is temporarily unavailable. Please try again in a few moments or contact support if the issue persists.',
        { error: rpcError.message }
      );
    }

    if (
      errorMessage.includes('insufficient') ||
      errorMessage.includes('negative') ||
      errorMessage.includes('available')
    ) {
      throw new ValidationError(
        'Insufficient available balance. Part of your balance may be reserved by an open dispute.'
      );
    }
    if (errorMessage.includes('frozen')) {
      throw new ValidationError(
        'Wallet is frozen due to an open Stripe dispute. Resolve the dispute before withdrawing.'
      );
    }
    if (errorMessage.includes('not found')) {
      throw new NotFoundError('User', userId);
    }

    throw new ExternalServiceError('Supabase', 'Failed to withdraw balance via RPC', {
      error: rpcError.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Platform ledger helpers
// ---------------------------------------------------------------------------

interface PlatformFeeInput {
  bountyId: string;
  amount: number; // USD dollars (not cents)
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Internal helper that accepts an already-resolved admin client.
 * Used when the caller has already obtained the client (e.g. inside releaseEscrow).
 * NOTE: failures are logged but not thrown — fee recording should never abort a release.
 */
async function recordPlatformFeeWithClient(
  admin: ReturnType<typeof getSupabaseAdmin>,
  input: PlatformFeeInput
): Promise<void> {
  const { error } = await admin.from('platform_ledger').insert([
    {
      bounty_id: input.bountyId,
      amount: input.amount,
      fee_type: 'platform_fee',
      description: input.description ?? `Platform fee for bounty ${input.bountyId}`,
      metadata: input.metadata ?? {},
    },
  ]);

  if (error) {
    // Log but do not throw — a fee recording failure should not roll back the hunter payment.
    // An alert/monitoring job should reconcile any missing platform_ledger rows.
    logger.error('[wallet] Failed to record platform fee in platform_ledger', {
      bountyId: input.bountyId,
      amount: input.amount,
      error: error.message,
    });
  }
}

/**
 * Record a platform fee in the dedicated platform_ledger table.
 * This replaces the previous pattern of writing a fake zero-UUID row into wallet_transactions.
 *
 * Platform fee rows are queryable via: SELECT * FROM platform_ledger
 *
 * NOTE: This function logs but does NOT throw on insert failure. Callers should treat
 * fee recording as best-effort and rely on external reconciliation for missing rows.
 */
export async function recordPlatformFee(input: PlatformFeeInput): Promise<void> {
  const admin = getSupabaseAdmin();
  return recordPlatformFeeWithClient(admin, input);
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
  withdrawBalance,
  getTransactionByPaymentIntent,
};
