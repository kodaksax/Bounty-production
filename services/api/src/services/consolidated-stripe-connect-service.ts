/**
 * Consolidated Stripe Connect Service
 * Phase 3.2 - Backend consolidation project
 * 
 * Handles Stripe Connect operations including:
 * - Creating Connect accounts for users
 * - Generating onboarding links
 * - Verifying onboarding completion
 * - Creating transfers to Connected accounts
 * - Retrying failed transfers
 * - Getting account status
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import {
  ValidationError,
  NotFoundError,
  ExternalServiceError,
  handleStripeError,
} from '../middleware/error-handler';
import { stripe } from './consolidated-payment-service';
import {
  createWithdrawal,
  updateBalance,
  type WalletTransaction,
} from './consolidated-wallet-service';
import { logger } from './logger';

// Initialize Supabase admin client
let supabaseAdmin: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(
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
 * Account link result
 */
export interface AccountLinkResult {
  url: string;
  accountId: string;
  expiresAt: number;
}

/**
 * Onboarding verification result
 */
export interface OnboardingVerificationResult {
  onboarded: boolean;
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

/**
 * Transfer result
 */
export interface TransferResult {
  transferId: string;
  status: string;
  amount: number;
  estimatedArrival: string;
}

/**
 * Account status result
 */
export interface AccountStatusResult {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requiresAction: boolean;
  currentlyDue?: string[];
}

/**
 * Create a Stripe Connect Express account for a user
 * If account already exists, returns existing accountId
 * 
 * @param userId - User ID
 * @param email - User email address
 * @returns Account ID
 */
export async function createConnectAccount(
  userId: string,
  email: string
): Promise<string> {
  const admin = getSupabaseAdmin();
  
  // Check if user already has a Connect account
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('stripe_connect_account_id')
    .eq('id', userId)
    .single();
  
  if (profileError) {
    if (profileError.code === 'PGRST116') {
      throw new NotFoundError('User', userId);
    }
    throw new ExternalServiceError('Supabase', 'Failed to fetch user profile', {
      error: profileError.message,
    });
  }
  
  // Return existing account ID if present
  if (profile?.stripe_connect_account_id) {
    logger.info({
      userId,
      accountId: profile.stripe_connect_account_id,
    }, '[StripeConnect] User already has Connect account');
    return profile.stripe_connect_account_id;
  }
  
  try {
    // Create new Stripe Express account with idempotency key to prevent duplicates
    const account = await stripe.accounts.create(
      {
        type: 'express',
        email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: { user_id: userId },
      },
      {
        idempotencyKey: `connect_acct_${userId}`,
      }
    );
    
    // Save account ID to profiles table
    const { error: updateError } = await admin
      .from('profiles')
      .update({ stripe_connect_account_id: account.id })
      .eq('id', userId);
    
    if (updateError) {
      // Log error but don't fail - account was created successfully
      logger.error({
        userId,
        accountId: account.id,
        error: updateError,
      }, '[StripeConnect] Failed to save account ID to profile');
    }
    
    logger.info({
      userId,
      accountId: account.id,
      email,
    }, '[StripeConnect] Created new Connect account');
    
    return account.id;
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * Generate an account link for Stripe Connect onboarding
 * Creates a new account if user doesn't have one
 * 
 * @param userId - User ID
 * @param returnUrl - URL to redirect after successful onboarding
 * @param refreshUrl - URL to redirect if link expires
 * @returns Account link details
 */
export async function createAccountLink(
  userId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<AccountLinkResult> {
  const admin = getSupabaseAdmin();
  
  // Get user's Connect account ID
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('stripe_connect_account_id, email')
    .eq('id', userId)
    .single();
  
  if (profileError) {
    if (profileError.code === 'PGRST116') {
      throw new NotFoundError('User', userId);
    }
    throw new ExternalServiceError('Supabase', 'Failed to fetch user profile', {
      error: profileError.message,
    });
  }
  
  let accountId = profile?.stripe_connect_account_id;
  
  // Create account if doesn't exist
  if (!accountId) {
    const email = profile?.email;
    if (!email) {
      throw new ValidationError('User email is required to create Connect account');
    }
    accountId = await createConnectAccount(userId, email);
  }
  
  try {
    // Generate account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    
    logger.info({
      userId,
      accountId,
    }, '[StripeConnect] Generated account link for onboarding');
    
    return {
      url: accountLink.url,
      accountId,
      expiresAt: accountLink.expires_at,
    };
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * Verify that a user has completed Stripe Connect onboarding
 * Updates stripe_connect_onboarded_at timestamp if onboarding is complete
 * 
 * @param userId - User ID
 * @returns Onboarding verification result
 */
export async function verifyOnboarding(
  userId: string
): Promise<OnboardingVerificationResult> {
  const admin = getSupabaseAdmin();
  
  // Get user's Connect account ID
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('stripe_connect_account_id, stripe_connect_onboarded_at')
    .eq('id', userId)
    .single();
  
  if (profileError) {
    if (profileError.code === 'PGRST116') {
      throw new NotFoundError('User', userId);
    }
    throw new ExternalServiceError('Supabase', 'Failed to fetch user profile', {
      error: profileError.message,
    });
  }
  
  const accountId = profile?.stripe_connect_account_id;
  
  if (!accountId) {
    throw new NotFoundError('Stripe Connect account');
  }
  
  try {
    // Retrieve account details from Stripe
    const account = await stripe.accounts.retrieve(accountId);
    
    const chargesEnabled = account.charges_enabled || false;
    const payoutsEnabled = account.payouts_enabled || false;
    const detailsSubmitted = account.details_submitted || false;
    const onboarded = chargesEnabled && payoutsEnabled;
    
    // Update onboarded_at timestamp if onboarding is complete and not yet set
    if (onboarded && !profile.stripe_connect_onboarded_at) {
      const { error: updateError } = await admin
        .from('profiles')
        .update({ stripe_connect_onboarded_at: new Date().toISOString() })
        .eq('id', userId);
      
      if (updateError) {
        logger.error({
          userId,
          accountId,
          error: updateError,
        }, '[StripeConnect] Failed to update onboarded_at timestamp');
      } else {
        logger.info({
          userId,
          accountId,
        }, '[StripeConnect] User completed onboarding');
      }
    }
    
    return {
      onboarded,
      accountId,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
    };
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * Create a transfer from user's wallet to their Stripe Connect account
 * Verifies onboarding, checks balance, creates wallet withdrawal, and initiates Stripe transfer
 * 
 * @param userId - User ID
 * @param amount - Amount in USD
 * @param currency - Currency code (default: 'usd')
 * @returns Transfer result
 */
export async function createTransfer(
  userId: string,
  amount: number,
  currency: string = 'usd'
): Promise<TransferResult> {
  // Validate amount
  if (amount <= 0) {
    throw new ValidationError('Transfer amount must be positive');
  }
  
  const admin = getSupabaseAdmin();
  
  // Get user's Connect account and onboarding status
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('stripe_connect_account_id, stripe_connect_onboarded_at, balance')
    .eq('id', userId)
    .single();
  
  if (profileError) {
    if (profileError.code === 'PGRST116') {
      throw new NotFoundError('User', userId);
    }
    throw new ExternalServiceError('Supabase', 'Failed to fetch user profile', {
      error: profileError.message,
    });
  }
  
  const accountId = profile?.stripe_connect_account_id;
  
  // Verify user has Connect account
  if (!accountId) {
    throw new ValidationError('Stripe Connect account not found. Please create an account first.');
  }
  
  // Verify user has completed onboarding
  if (!profile.stripe_connect_onboarded_at) {
    throw new ValidationError('Complete Stripe Connect onboarding first');
  }
  
  try {
    // Create withdrawal transaction via wallet service
    // This will deduct balance atomically and create the transaction
    const transaction = await createWithdrawal(userId, amount, accountId);
    
    logger.info({
      userId,
      accountId,
      amount,
      transactionId: transaction.id,
      transferId: transaction.stripe_transfer_id,
    }, '[StripeConnect] Transfer created successfully');
    
    // Calculate estimated arrival (2 calendar days - actual arrival depends on bank processing)
    const estimatedArrival = new Date();
    estimatedArrival.setDate(estimatedArrival.getDate() + 2);
    
    return {
      transferId: transaction.stripe_transfer_id!,
      status: transaction.status,
      amount,
      estimatedArrival: estimatedArrival.toISOString(),
    };
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * Retry a failed transfer
 * Checks transaction exists, belongs to user, is failed, and hasn't exceeded max retries
 * Creates new Stripe transfer and updates transaction
 * 
 * @param transactionId - Wallet transaction ID
 * @param userId - User ID
 * @returns Transfer result
 */
export async function retryTransfer(
  transactionId: string,
  userId: string
): Promise<TransferResult> {
  const admin = getSupabaseAdmin();
  
  // Get the failed transaction
  const { data: transaction, error: txError } = await admin
    .from('wallet_transactions')
    .select('*')
    .eq('id', transactionId)
    .eq('user_id', userId)
    .single();
  
  if (txError || !transaction) {
    throw new NotFoundError('Transaction', transactionId);
  }
  
  // Verify transaction is failed
  if (transaction.status !== 'failed') {
    throw new ValidationError('Only failed transactions can be retried');
  }
  
  // Check retry count (max 3 retries)
  const retryCount = transaction.metadata?.retry_count || 0;
  if (retryCount >= 3) {
    throw new ValidationError('Maximum retry attempts reached');
  }
  
  const amount = Math.abs(transaction.amount);
  const accountId = transaction.stripe_connect_account_id;
  
  if (!accountId) {
    throw new ValidationError('Transaction missing Stripe Connect account ID');
  }
  
  // Get user's Connect account and verify onboarding
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('stripe_connect_onboarded_at, balance')
    .eq('id', userId)
    .single();
  
  if (profileError) {
    throw new ExternalServiceError('Supabase', 'Failed to fetch user profile', {
      error: profileError.message,
    });
  }
  
  // Verify user still has onboarded Connect account
  if (!profile.stripe_connect_onboarded_at) {
    throw new ValidationError('Complete Stripe Connect onboarding first');
  }
  
  // Check sufficient balance (was refunded on failure)
  const balance = profile.balance || 0;
  if (balance < amount) {
    throw new ValidationError('Insufficient wallet balance');
  }
  
  try {
    // Deduct balance again atomically
    await updateBalance(userId, -amount);
    
    // Create new Stripe transfer
    const transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      destination: accountId,
      metadata: {
        user_id: userId,
        transaction_id: transactionId,
        retry_attempt: retryCount + 1,
      },
    });
    
    // Update transaction with new transfer ID and incremented retry count
    const { error: updateError } = await admin
      .from('wallet_transactions')
      .update({
        stripe_transfer_id: transfer.id,
        status: 'pending',
        metadata: {
          ...(transaction.metadata || {}),
          retry_count: retryCount + 1,
          previous_transfer_id: transaction.stripe_transfer_id,
          retried_at: new Date().toISOString(),
        },
      })
      .eq('id', transactionId);
    
    if (updateError) {
      logger.error({
        userId,
        transactionId,
        transferId: transfer.id,
        error: updateError,
      }, '[StripeConnect] Failed to update transaction after retry');
    }
    
    logger.info({
      userId,
      transactionId,
      transferId: transfer.id,
      retryAttempt: retryCount + 1,
    }, '[StripeConnect] Transfer retried successfully');
    
    // Calculate estimated arrival (2 calendar days - actual arrival depends on bank processing)
    const estimatedArrival = new Date();
    estimatedArrival.setDate(estimatedArrival.getDate() + 2);
    
    return {
      transferId: transfer.id,
      status: 'pending',
      amount,
      estimatedArrival: estimatedArrival.toISOString(),
    };
  } catch (error) {
    // On failure, refund the balance
    try {
      await updateBalance(userId, amount);
    } catch (rollbackError) {
      logger.error({
        userId,
        transactionId,
        amount,
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      }, '[StripeConnect] CRITICAL: Failed to rollback balance after retry failure');
    }
    
    throw handleStripeError(error);
  }
}

/**
 * Get detailed account status from Stripe
 * 
 * @param userId - User ID
 * @returns Account status
 */
export async function getAccountStatus(
  userId: string
): Promise<AccountStatusResult> {
  const admin = getSupabaseAdmin();
  
  // Get user's Connect account ID
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('stripe_connect_account_id')
    .eq('id', userId)
    .single();
  
  if (profileError) {
    if (profileError.code === 'PGRST116') {
      throw new NotFoundError('User', userId);
    }
    throw new ExternalServiceError('Supabase', 'Failed to fetch user profile', {
      error: profileError.message,
    });
  }
  
  const accountId = profile?.stripe_connect_account_id;
  
  if (!accountId) {
    throw new NotFoundError('Stripe Connect account');
  }
  
  try {
    // Retrieve account details from Stripe
    const account = await stripe.accounts.retrieve(accountId);
    
    const chargesEnabled = account.charges_enabled || false;
    const payoutsEnabled = account.payouts_enabled || false;
    const detailsSubmitted = account.details_submitted || false;
    const currentlyDue = account.requirements?.currently_due || [];
    const requiresAction = !detailsSubmitted || currentlyDue.length > 0;
    
    return {
      accountId,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
      requiresAction,
      currentlyDue: currentlyDue.length > 0 ? currentlyDue : undefined,
    };
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * Export service instance
 */
export const consolidatedStripeConnectService = {
  createConnectAccount,
  createAccountLink,
  verifyOnboarding,
  createTransfer,
  retryTransfer,
  getAccountStatus,
};
