/**
 * Consolidated Payment Service
 * Merges payment logic from server/index.js and existing payment services
 * Handles Stripe PaymentIntents, payment methods, and webhooks
 */

import Stripe from 'stripe';
import { config } from '../config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../types/database.types';
import {
  ValidationError,
  ExternalServiceError,
  handleStripeError,
} from '../middleware/error-handler';

// Initialize Stripe
const stripe = new Stripe(config.stripe.secretKey, {
  // Align with repository-wide pinned Stripe API version
  apiVersion: '2025-08-27.basil',
  typescript: true,
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
 * Get or create Stripe customer for user
 */
async function getOrCreateStripeCustomer(
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
  
  // Return existing customer ID if present
  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }
  
  // Create new Stripe customer
  const customerEmail = email || profile?.email;
  if (!customerEmail) {
    throw new ValidationError('Email required to create Stripe customer');
  }
  
  try {
    const customer = await stripe.customers.create({
      email: customerEmail,
      metadata: { user_id: userId },
    });
    
    // Save customer ID to profile
    const { error: updateError } = await admin
      .from('profiles')
      .update({ stripe_customer_id: customer.id })
      .eq('id', userId);
    
    if (updateError) {
      // Log error but don't fail - customer was created successfully
      console.error('[PaymentService] Failed to save customer ID:', updateError);
    }
    
    return customer.id;
  } catch (error) {
    throw handleStripeError(error);
  }
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
    
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
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
    });
    
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
  paymentMethodId?: string
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
        confirmParams
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
    
    return paymentMethods.data.map((pm) => ({
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
export async function createSetupIntent(userId: string): Promise<{
  clientSecret: string;
  setupIntentId: string;
}> {
  try {
    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(userId);
    
    // Create setup intent
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      metadata: { user_id: userId },
    });
    
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
  reason?: string
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
      
      await stripe.paymentIntents.cancel(paymentIntentId, {
        cancellation_reason: cancellationReason,
      });
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
