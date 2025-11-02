import Stripe from 'stripe';
import { db } from '../db/connection';
import { users, bounties } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface EscrowPaymentIntentResponse {
  paymentIntentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: string;
}

export interface OnboardingLinkRequest {
  userId: string;
  refreshUrl?: string;
  returnUrl?: string;
}

export interface OnboardingLinkResponse {
  url: string;
  expiresAt: number;
}

export interface ConnectStatusResponse {
  hasStripeAccount: boolean;
  stripeAccountId?: string;
  detailsSubmitted?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  requiresAction?: boolean;
  currentlyDue?: string[];
}

class StripeConnectService {
  private stripe: Stripe | null = null;
  private isConfigured: boolean = false;

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (secretKey) {
      this.stripe = new Stripe(secretKey);
      this.isConfigured = true;
    } else {
      console.warn('[StripeConnectService] STRIPE_SECRET_KEY not configured. Service will be disabled.');
    }
  }

  private ensureConfigured() {
    if (!this.isConfigured || !this.stripe) {
      throw new Error('Stripe service not configured. Set STRIPE_SECRET_KEY environment variable.');
    }
  }

  /**
   * Create a Stripe Connect onboarding link for Express accounts
   */
  async createOnboardingLink(request: OnboardingLinkRequest): Promise<OnboardingLinkResponse> {
    this.ensureConfigured();
    
    try {
      const { userId, refreshUrl, returnUrl } = request;

      // Check if user already has a Stripe account
      const userRecord = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!userRecord.length) {
        throw new Error('User not found');
      }

      const user = userRecord[0];
      let stripeAccountId = user.stripe_account_id;

      // Create Stripe Express account if doesn't exist
      if (!stripeAccountId) {
        const account = await this.stripe!.accounts.create({
          type: 'express',
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          settings: {
            payouts: {
              schedule: {
                interval: 'daily',
              },
            },
          },
        });

        stripeAccountId = account.id;

        // Update user record with Stripe account ID
        await db
          .update(users)
          .set({ stripe_account_id: stripeAccountId })
          .where(eq(users.id, userId));

        console.log(`✅ Created Stripe Express account ${stripeAccountId} for user ${userId}`);
      }

      // Create onboarding link
      const accountLink = await this.stripe!.accountLinks.create({
        account: stripeAccountId,
        refresh_url: refreshUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/onboarding/refresh`,
        return_url: returnUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/onboarding/return`,
        type: 'account_onboarding',
      });

      return {
        url: accountLink.url,
        expiresAt: accountLink.expires_at,
      };
    } catch (error) {
      console.error('Error creating onboarding link:', error);
      if (error instanceof Stripe.errors.StripeError) {
        throw new Error(`Stripe error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get the onboarding/account status for a user
   */
  async getConnectStatus(userId: string): Promise<ConnectStatusResponse> {
    this.ensureConfigured();
    
    try {
      // Get user record
      const userRecord = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!userRecord.length) {
        throw new Error('User not found');
      }

      const user = userRecord[0];
      const stripeAccountId = user.stripe_account_id;

      if (!stripeAccountId) {
        return {
          hasStripeAccount: false,
        };
      }

      // Get account details from Stripe
      const account = await this.stripe!.accounts.retrieve(stripeAccountId);

      return {
        hasStripeAccount: true,
        stripeAccountId,
        detailsSubmitted: account.details_submitted,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        requiresAction: !account.details_submitted || 
          (account.requirements?.currently_due?.length ?? 0) > 0,
        currentlyDue: account.requirements?.currently_due || [],
      };
    } catch (error) {
      console.error('Error getting connect status:', error);
      if (error instanceof Stripe.errors.StripeError) {
        throw new Error(`Stripe error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Create a PaymentIntent for escrow (capture funds on platform)
   */
  async createEscrowPaymentIntent(bountyId: string): Promise<EscrowPaymentIntentResponse> {
    this.ensureConfigured();

    try {
      // Get bounty details
      const bountyRecord = await db
        .select()
        .from(bounties)
        .where(eq(bounties.id, bountyId))
        .limit(1);

      if (!bountyRecord.length) {
        throw new Error('Bounty not found');
      }

      const bounty = bountyRecord[0];

      if (bounty.is_for_honor) {
        throw new Error('Cannot create escrow for honor-only bounties');
      }

      if (bounty.amount_cents <= 0) {
        throw new Error('Cannot create escrow for zero amount bounties');
      }

      // Get creator details for payment method
      const creatorRecord = await db
        .select()
        .from(users)
        .where(eq(users.id, bounty.creator_id))
        .limit(1);

      if (!creatorRecord.length) {
        throw new Error('Bounty creator not found');
      }

      // Create real Stripe PaymentIntent
      const paymentIntent = await this.stripe!.paymentIntents.create({
        amount: bounty.amount_cents,
        currency: 'usd',
        capture_method: 'automatic', // Capture funds immediately
        payment_method_types: ['card'],
        metadata: {
          bounty_id: bountyId,
          creator_id: bounty.creator_id,
          type: 'escrow',
          bounty_title: bounty.title,
        },
        description: `Escrow for bounty: ${bounty.title}`,
      });

      // Update bounty with payment intent ID
      await db
        .update(bounties)
        .set({ 
          payment_intent_id: paymentIntent.id,
          updated_at: new Date(),
        })
        .where(eq(bounties.id, bountyId));

      console.log(`✅ Created Stripe PaymentIntent ${paymentIntent.id} for bounty ${bountyId} (${bounty.amount_cents} cents)`);

      return {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret || '',
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
      };

    } catch (error) {
      console.error(`❌ Error creating escrow PaymentIntent for bounty ${bountyId}:`, error);
      if (error instanceof Stripe.errors.StripeError) {
        throw new Error(`Stripe error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Refund a PaymentIntent (for cancelled bounties)
   */
  async refundPaymentIntent(paymentIntentId: string, bountyId: string, reason?: string): Promise<{
    success: boolean;
    refundId?: string;
    amount?: number;
    error?: string;
  }> {
    this.ensureConfigured();

    try {
      // Get the payment intent to ensure it exists and is refundable
      const paymentIntent = await this.stripe!.paymentIntents.retrieve(paymentIntentId);

      if (paymentIntent.status !== 'succeeded') {
        return {
          success: false,
          error: `Payment intent status is ${paymentIntent.status}, can only refund succeeded payments`,
        };
      }

      // Create the refund
      // Map reason to Stripe's accepted values or default to 'requested_by_customer'
      const stripeReason: 'duplicate' | 'fraudulent' | 'requested_by_customer' = 
        reason === 'duplicate' || reason === 'fraudulent' ? reason : 'requested_by_customer';
      
      const refund = await this.stripe!.refunds.create({
        payment_intent: paymentIntentId,
        reason: stripeReason,
        metadata: {
          bounty_id: bountyId,
          type: 'bounty_cancellation',
        },
      });

      console.log(`✅ Created refund ${refund.id} for PaymentIntent ${paymentIntentId} (${refund.amount} cents)`);

      return {
        success: true,
        refundId: refund.id,
        amount: refund.amount,
      };

    } catch (error) {
      console.error(`❌ Error refunding PaymentIntent ${paymentIntentId}:`, error);
      
      let errorMessage = 'Unknown error';
      if (error instanceof Stripe.errors.StripeError) {
        errorMessage = error.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Check if a payment has sufficient funds and account is verified
   */
  async validatePaymentCapability(userId: string, amountCents: number): Promise<{
    canPay: boolean;
    error?: string;
  }> {
    this.ensureConfigured();

    try {
      const userRecord = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!userRecord.length) {
        return {
          canPay: false,
          error: 'User not found',
        };
      }

      const user = userRecord[0];

      // Check if user has Stripe account for payment methods
      if (!user.stripe_account_id) {
        return {
          canPay: false,
          error: 'User has not set up payment method. Please complete Stripe onboarding first.',
        };
      }

      // Verify the Stripe account is active
      try {
        const account = await this.stripe!.accounts.retrieve(user.stripe_account_id);
        
        if (!account.charges_enabled) {
          return {
            canPay: false,
            error: 'User account is not verified to make payments. Please complete account verification.',
          };
        }
      } catch (stripeError) {
        console.error('Error checking Stripe account:', stripeError);
        return {
          canPay: false,
          error: 'Unable to verify payment account status',
        };
      }

      // Amount validation
      if (amountCents < 50) { // Stripe minimum is $0.50
        return {
          canPay: false,
          error: 'Amount must be at least $0.50',
        };
      }

      return {
        canPay: true,
      };

    } catch (error) {
      console.error('Error validating payment capability:', error);
      return {
        canPay: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Handle webhook events (for future use)
   */
  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    try {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        throw new Error('STRIPE_WEBHOOK_SECRET not configured');
      }

      const event = this.stripe!.webhooks.constructEvent(payload, signature, webhookSecret);

      console.log(`📨 Received Stripe webhook: ${event.type}`);

      switch (event.type) {
        case 'account.updated':
          // Handle account updates (onboarding completion, etc.)
          const account = event.data.object as Stripe.Account;
          console.log(`Account ${account.id} updated - details_submitted: ${account.details_submitted}`);
          break;
        default:
          console.log(`Unhandled webhook event type: ${event.type}`);
      }
    } catch (error) {
      console.error('Error handling webhook:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const stripeConnectService = new StripeConnectService();