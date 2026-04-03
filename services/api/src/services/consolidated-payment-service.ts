/**
 * Consolidated Payment Service
 * Merges payment logic from server/index.js and existing payment services
 * Handles Stripe PaymentIntents, payment methods, and webhooks
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { config } from '../config';
import {
    ExternalServiceError,
    handleStripeError,
    ValidationError,
} from '../middleware/error-handler';
import { logger } from './logger';

/**
 * Build Stripe request options with optional idempotency key
 * @param idempotencyKey - Optional idempotency key for duplicate prevention
 * @returns Stripe RequestOptions object
 */
const buildStripeRequestOptions = (idempotencyKey?: string): Stripe.RequestOptions =>
  idempotencyKey ? { idempotencyKey } : {};

// Lazily-initialise the Stripe singleton so that importing this module does NOT
// require STRIPE_SECRET_KEY to be present at module-load time.  This lets the
// payments route register 501 fallbacks when the key is absent without crashing.
let _stripeInstance: Stripe | null = null;

function getStripeInstance(): Stripe {
  if (!_stripeInstance) {
    const key = config.stripe.secretKey; // throws if missing – intentional at call-time
    _stripeInstance = new Stripe(key, {
      apiVersion: '2026-02-25.clover',
      typescript: true,
    });
  }
  return _stripeInstance;
}

// Proxy so existing `stripe.xyz()` call sites continue working without changes.
// The Stripe SDK is NOT initialised until the first method call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop: string | symbol) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getStripeInstance() as any)[prop];
  },
});

// Initialize Supabase admin client
let supabaseAdmin: SupabaseClient<any> | null = null;

function getSupabaseAdmin(): SupabaseClient<any> {
  if (!supabaseAdmin) {
    // Relax typing to avoid PostgREST `never` inference on partial selects
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
 * Payment Intent creation options
 */
export interface CreatePaymentIntentOptions {
  userId: string;
  amountCents: number;
  currency?: string;
  metadata?: Record<string, string>;
  description?: string;
  paymentMethodTypes?: string[];
  idempotencyKey?: string;
}

/**
 * Payment Intent result
 */
export interface PaymentIntentResult {
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
}

/**
 * Payment method result
 */
export interface PaymentMethodResult {
  id: string;
  type: string;
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
  created: number;
}

/**
 * Create Stripe customer for new user at signup.
 * This is the eager-creation path – call it after the profile row exists.
 * On any error it logs and returns null so the caller can fall back to lazy
 * creation at first-payment time without breaking signup.
 *
 * @param userId - User ID
 * @param email - User email (optional; Stripe supports metadata-only customers)
 * @returns Customer ID or null if creation failed
 */
export async function createStripeCustomerForNewUser(
  userId: string,
  email?: string
): Promise<string | null> {
  const admin = getSupabaseAdmin();

  try {
    const customer = await stripe.customers.create(
      {
        // Only pass email when we actually have a non-empty value – Stripe
        // supports metadata-only customers and an empty string is invalid.
        ...(email ? { email } : {}),
        // Keep metadata deterministic so Stripe retries for the same
        // idempotency key do not fail due to parameter mismatch.
        metadata: {
          user_id: userId,
        },
      },
      { idempotencyKey: `customer_signup_${userId}` }
    );

    // Persist the customer ID so subsequent calls find it immediately
    const { error: updateError } = await admin
      .from('profiles')
      .update({ stripe_customer_id: customer.id })
      .eq('id', userId);

    if (updateError) {
      logger.error(
        { userId, customerId: customer.id, error: updateError },
        '[PaymentService] createStripeCustomerForNewUser: failed to save customer ID to profile'
      );
      // Still return the ID – the customer was created in Stripe successfully
    }

    logger.info(
      { userId, customerId: customer.id },
      '[PaymentService] createStripeCustomerForNewUser: Stripe customer created'
    );

    return customer.id;
  } catch (error) {
    logger.error(
      { userId, error },
      '[PaymentService] createStripeCustomerForNewUser: failed to create Stripe customer'
    );
    return null;
  }
}

/**
 * Get or create Stripe customer for user.
 * Reads/writes stripe_customer_id from the profiles table.
 * This is the DB-backed implementation; use this instead of any in-memory cache.
 *
 * Fast path: if the profile already has a stripe_customer_id (set at signup
 * when the eager-creation flag is enabled), return it immediately.
 * Slow / lazy path: customer is created here during the first payment if the
 * profile does not yet have one (preserves existing behaviour when the flag is
 * disabled or eager creation failed at signup).
 *
 * Email is included when available but is NOT required – Stripe supports
 * creating customers without one, and the profile trigger only stores
 * id/username/balance (not email).
 */
export async function getOrCreateStripeCustomer(
  userId: string,
  email?: string
): Promise<string> {
  const admin = getSupabaseAdmin();
  
  // Check if user already has a Stripe customer ID
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('stripe_customer_id, email')
    .eq('id', userId)
    .single();
  
  if (profileError) {
    throw new ExternalServiceError('Supabase', 'Failed to fetch user profile', {
      error: profileError.message,
    });
  }
  
  // Fast path: return existing customer ID if present (eager creation already ran)
  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  // Lazy path: customer not yet created – create it now during first payment
  logger.info(
    { userId },
    '[PaymentService] getOrCreateStripeCustomer: no stripe_customer_id found; creating customer during payment (lazy path)'
  );

  // Resolve email: prefer explicit arg, then profile column (may be NULL)
  const customerEmail = email || profile?.email || undefined;

  try {
    const customerId = await createStripeCustomerForNewUser(userId, customerEmail);
    if (customerId) {
      return customerId;
    }
  } catch (error) {
    throw handleStripeError(error);
  }

  // createStripeCustomerForNewUser already logged the error; surface it as a
  // hard failure here because the payment cannot proceed without a customer.
  throw new ExternalServiceError('Stripe', 'Failed to create Stripe customer for user');
}

/**
 * Look up the Stripe customer ID stored in the profiles table.
 * Returns null if the user does not have a customer ID yet.
 * Uses the shared Supabase admin singleton and surfaces DB errors.
 */
export async function getStripeCustomerId(userId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();

  const { data: profile, error } = await admin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new ExternalServiceError('Supabase', 'Failed to fetch Stripe customer ID', {
      error: error.message,
    });
  }

  return profile?.stripe_customer_id ?? null;
}

/**
 * Create a payment intent
 */
export async function createPaymentIntent(
  options: CreatePaymentIntentOptions
): Promise<PaymentIntentResult> {
  const {
    userId,
    amountCents,
    currency = 'usd',
    metadata = {},
    description,
    paymentMethodTypes = ['card'],
    idempotencyKey,
  } = options;
  
  // Validate amount
  if (!amountCents || amountCents < 50) {
    throw new ValidationError('Amount must be at least $0.50 (50 cents)');
  }
  
  // Validate currency
  const validCurrencies = ['usd', 'eur', 'gbp'];
  if (!validCurrencies.includes(currency.toLowerCase())) {
    throw new ValidationError(`Invalid currency. Supported: ${validCurrencies.join(', ')}`);
  }
  
  try {
    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(userId);
    
    // Create payment intent with optional idempotency key
    const createOptions: Stripe.PaymentIntentCreateParams = {
      amount: amountCents,
      currency: currency.toLowerCase(),
      customer: customerId,
      metadata: {
        user_id: userId,
        ...metadata,
      },
      description,
      payment_method_types: paymentMethodTypes,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
    };
    
    const paymentIntent = await stripe.paymentIntents.create(
      createOptions,
      buildStripeRequestOptions(idempotencyKey)
    );
    
    const clientSecret = paymentIntent.client_secret;
    if (!clientSecret) {
      throw new ExternalServiceError(
        'Stripe',
        'Payment intent created but no client secret returned'
      );
    }
    
    return {
      clientSecret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    };
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * Confirm a payment intent
 */
export async function confirmPaymentIntent(
  paymentIntentId: string,
  userId: string,
  paymentMethodId?: string,
  idempotencyKey?: string
): Promise<{
  success: boolean;
  status: string;
  requiresAction?: boolean;
  clientSecret?: string;
  nextAction?: any;
}> {
  try {
    // Retrieve payment intent
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    // Verify ownership
    if (paymentIntent.metadata?.user_id !== userId) {
      throw new ValidationError('Not authorized to confirm this payment');
    }
    
    // If already succeeded or processing, return current status
    if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing') {
      return {
        success: true,
        status: paymentIntent.status,
      };
    }
    
    // Confirm if needed
    let confirmedIntent = paymentIntent;
    if (
      paymentIntent.status === 'requires_confirmation' ||
      paymentIntent.status === 'requires_payment_method'
    ) {
      const confirmParams: Stripe.PaymentIntentConfirmParams = {};
      if (paymentMethodId) {
        confirmParams.payment_method = paymentMethodId;
      }
      
      confirmedIntent = await stripe.paymentIntents.confirm(
        paymentIntentId,
        confirmParams,
        buildStripeRequestOptions(idempotencyKey)
      );
    }
    
    // Handle 3D Secure / requires_action
    if (confirmedIntent.status === 'requires_action') {
      const clientSecret = confirmedIntent.client_secret;
      if (!clientSecret) {
        throw new ValidationError(
          'Payment requires additional authentication, but Stripe did not provide a client secret'
        );
      }
      
      return {
        success: false,
        status: 'requires_action',
        requiresAction: true,
        clientSecret,
        nextAction: confirmedIntent.next_action,
      };
    }
    
    return {
      success: confirmedIntent.status === 'succeeded',
      status: confirmedIntent.status,
    };
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * List payment methods for a user
 */
export async function listPaymentMethods(userId: string): Promise<PaymentMethodResult[]> {
  const admin = getSupabaseAdmin();
  
  try {
    // Get user's Stripe customer ID
    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();
    
    if (!profile?.stripe_customer_id) {
      return [];
    }
    
    // Fetch payment methods from Stripe
    const paymentMethods = await stripe.paymentMethods.list({
      customer: profile.stripe_customer_id,
      type: 'card',
    });
    
    return paymentMethods.data.map((pm: Stripe.PaymentMethod) => ({
      id: pm.id,
      type: 'card',
      card: pm.card
        ? {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          }
        : undefined,
      created: pm.created,
    }));
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * Attach payment method to user
 */
export async function attachPaymentMethod(
  userId: string,
  paymentMethodId: string
): Promise<PaymentMethodResult> {
  try {
    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(userId);
    
    // Attach payment method
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
    
    // Fetch payment method details
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    
    return {
      id: paymentMethod.id,
      type: 'card',
      card: paymentMethod.card
        ? {
            brand: paymentMethod.card.brand,
            last4: paymentMethod.card.last4,
            expMonth: paymentMethod.card.exp_month,
            expYear: paymentMethod.card.exp_year,
          }
        : undefined,
      created: paymentMethod.created,
    };
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * Detach payment method from user
 */
export async function detachPaymentMethod(
  userId: string,
  paymentMethodId: string
): Promise<void> {
  const admin = getSupabaseAdmin();
  
  try {
    // Get user's Stripe customer ID
    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();
    
    if (!profile?.stripe_customer_id) {
      throw new ValidationError('No payment methods found');
    }
    
    // Verify payment method belongs to user
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    
    if (paymentMethod.customer !== profile.stripe_customer_id) {
      throw new ValidationError('Not authorized to remove this payment method');
    }
    
    // Detach payment method
    await stripe.paymentMethods.detach(paymentMethodId);
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * Create setup intent for adding payment method without immediate charge
 */
export async function createSetupIntent(
  userId: string,
  idempotencyKey?: string
): Promise<{
  clientSecret: string;
  setupIntentId: string;
}> {
  try {
    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(userId);
    
    // Create setup intent with optional idempotency key
    const setupIntentParams: Stripe.SetupIntentCreateParams = {
      customer: customerId,
      payment_method_types: ['card'],
      metadata: { user_id: userId },
    };
    
    const setupIntent = await stripe.setupIntents.create(
      setupIntentParams,
      buildStripeRequestOptions(idempotencyKey)
    );
    
    if (!setupIntent.client_secret) {
      throw new ExternalServiceError(
        'Stripe',
        'Setup intent created but no client secret returned'
      );
    }
    
    return {
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
    };
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * Cancel a payment intent
 */
export async function cancelPaymentIntent(
  paymentIntentId: string,
  userId: string,
  reason?: string,
  idempotencyKey?: string
): Promise<void> {
  try {
    // Retrieve payment intent to verify ownership
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.metadata?.user_id !== userId) {
      throw new ValidationError('Not authorized to cancel this payment');
    }
    
    // Cancel if cancelable
    if (paymentIntent.status === 'requires_payment_method' || 
        paymentIntent.status === 'requires_confirmation' ||
        paymentIntent.status === 'requires_action') {
      
      // Map reason to Stripe's allowed cancellation reasons
      let cancellationReason: Stripe.PaymentIntentCancelParams.CancellationReason | undefined;
      if (reason) {
        const validReasons = ['duplicate', 'fraudulent', 'requested_by_customer', 'abandoned'];
        if (validReasons.includes(reason)) {
          cancellationReason = reason as Stripe.PaymentIntentCancelParams.CancellationReason;
        } else {
          // Default to 'requested_by_customer' for any other reason
          cancellationReason = 'requested_by_customer';
        }
      }
      
      const cancelParams: Stripe.PaymentIntentCancelParams = {
        cancellation_reason: cancellationReason,
      };
      
      await stripe.paymentIntents.cancel(
        paymentIntentId,
        cancelParams,
        buildStripeRequestOptions(idempotencyKey)
      );
    } else {
      throw new ValidationError(
        `Cannot cancel payment intent with status: ${paymentIntent.status}`
      );
    }
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * Get payment intent status
 */
export async function getPaymentIntentStatus(
  paymentIntentId: string,
  userId: string
): Promise<{
  id: string;
  status: string;
  amount: number;
  currency: string;
  clientSecret?: string;
}> {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    // Verify ownership
    if (paymentIntent.metadata?.user_id !== userId) {
      throw new ValidationError('Not authorized to view this payment');
    }
    
    return {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      clientSecret: paymentIntent.client_secret || undefined,
    };
  } catch (error) {
    throw handleStripeError(error);
  }
}

/**
 * Export Stripe instance for advanced use cases
 */
export { stripe };

