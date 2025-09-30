import Stripe from 'stripe';
import { db } from '../db/connection';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

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
  private stripe: Stripe;

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }

    this.stripe = new Stripe(secretKey);
  }

  /**
   * Create a Stripe Connect onboarding link for Express accounts
   */
  async createOnboardingLink(request: OnboardingLinkRequest): Promise<OnboardingLinkResponse> {
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
        const account = await this.stripe.accounts.create({
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
      const accountLink = await this.stripe.accountLinks.create({
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
      const account = await this.stripe.accounts.retrieve(stripeAccountId);

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
   * Handle webhook events (for future use)
   */
  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    try {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        throw new Error('STRIPE_WEBHOOK_SECRET not configured');
      }

      const event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);

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