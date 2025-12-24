/**
 * Payment Business Logic Service
 * Separates payment operations from UI components
 * Provides a clean API for payment operations
 */

import {
    isSCARequired,
    PAYMENT_SECURITY_CONFIG,
    validatePaymentSecurity,
} from '../security/payment-security-config';
import {
    PaymentMethodResponse
} from '../types/payment-types';
import { analyticsService } from './analytics-service';
import { StripePaymentMethod, stripeService } from './stripe-service';

export interface CreatePaymentOptions {
  amount: number;
  currency?: string;
  userId: string;
  purpose?: string;
  metadata?: Record<string, string>;
  customerRegion?: string;
  isFirstTransaction?: boolean;
}

export interface ConfirmPaymentOptions {
  paymentIntentClientSecret: string;
  paymentMethodId: string;
  userId: string;
}

export interface PaymentResult {
  success: boolean;
  paymentIntentId?: string;
  amount?: number;
  currency?: string;
  status?: string;
  requiresAction?: boolean;
  error?: {
    type: string;
    message: string;
    code?: string;
  };
}

export interface PaymentMethodListResult {
  success: boolean;
  paymentMethods: PaymentMethodResponse[];
  error?: {
    message: string;
  };
}

export interface CreateEscrowOptions {
  bountyId: string;
  amount: number; // dollars
  posterId: string;
  hunterId: string;
  userId: string; // for logging/attribution
  currency?: string;
  paymentMethodId?: string; // if provided, confirm immediately
}

export interface EscrowCreateResult {
  success: boolean;
  escrowId?: string;
  paymentIntentId?: string;
  clientSecret?: string;
  status?: string;
  requiresAction?: boolean;
  error?: {
    type: string;
    message: string;
    code?: string;
  };
}

export interface EscrowReleaseResult {
  success: boolean;
  transferId?: string;
  paymentIntentId?: string;
  error?: { message: string };
}

/**
 * Payment Service
 * Centralizes all payment operations with business logic
 */
class PaymentService {
  /**
   * Create a new payment with security validations
   */
  async createPayment(
    options: CreatePaymentOptions,
    authToken?: string
  ): Promise<PaymentResult> {
    try {
      // Validate security requirements
      const securityCheck = validatePaymentSecurity({
        protocol: typeof window !== 'undefined' ? window.location.protocol : 'https:',
        amount: options.amount,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      });

      if (!securityCheck.valid) {
        return {
          success: false,
          error: {
            type: 'validation_error',
            message: securityCheck.errors.join(', '),
          },
        };
      }

      // Log security warnings
      if (securityCheck.warnings.length > 0) {
        console.error('[PaymentService] Security warnings:', securityCheck.warnings);
        await analyticsService.trackEvent('payment_security_warning', {
          warnings: securityCheck.warnings.join(', '),
          userId: options.userId,
        });
      }

      // Check if SCA is required
      const scaRequired = isSCARequired({
        amount: options.amount,
        currency: options.currency || 'usd',
        customerRegion: options.customerRegion,
        isFirstTransaction: options.isFirstTransaction,
      });

      if (scaRequired) {
        await analyticsService.trackEvent('payment_sca_required', {
          amount: options.amount,
          currency: options.currency,
          userId: options.userId,
        });
      }

      // Create payment intent using secure method with retry
      const paymentIntent = await stripeService.createPaymentIntentSecure(
        options.amount,
        options.currency || 'usd',
        authToken,
        {
          userId: options.userId,
          purpose: options.purpose || 'payment',
          metadata: options.metadata,
        }
      );

      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
      };
    } catch (error: any) {
      console.error('[PaymentService] Error creating payment:', error);

      return {
        success: false,
        error: {
          type: error.type || 'unknown_error',
          message: error.message || 'Failed to create payment',
          code: error.code,
        },
      };
    }
  }

  /**
   * Create an escrow with manual capture. Optionally confirm immediately if a payment method is provided.
   * Server will create PaymentIntent (capture_method: manual) and escrow record, returning client secret.
   */
  async createEscrow(
    options: CreateEscrowOptions,
    authToken?: string
  ): Promise<EscrowCreateResult> {
    try {
      // Create escrow on backend and get client secret
      const escrow = await stripeService.createEscrow(
        {
          bountyId: options.bountyId,
          amount: options.amount,
          posterId: options.posterId,
          hunterId: options.hunterId,
          currency: options.currency || 'usd',
        },
        authToken
      );

      // If a payment method is provided, confirm to place the hold
      if (options.paymentMethodId) {
        const confirmed = await stripeService.confirmPaymentSecure(
          escrow.paymentIntentClientSecret,
          options.paymentMethodId,
          authToken,
          { userId: options.userId }
        );

        if (confirmed.status === 'requires_action') {
          // Attempt to complete 3DS via native SDK
          try {
            const next = await stripeService.handleNextAction(escrow.paymentIntentClientSecret);

            if (next.status === 'succeeded' || next.status === 'requires_capture') {
              return {
                success: true,
                escrowId: escrow.escrowId,
                paymentIntentId: next.id,
                clientSecret: escrow.paymentIntentClientSecret,
                status: next.status,
              };
            }

            return {
              success: false,
              escrowId: escrow.escrowId,
              paymentIntentId: next.id,
              clientSecret: escrow.paymentIntentClientSecret,
              status: next.status,
              requiresAction: true,
              error: {
                type: 'authentication_required',
                message: 'Additional authentication required',
              },
            };
          } catch (err: any) {
            // Provide specific feedback for authentication/3DS failures
            console.error('[PaymentService] Error completing 3DS authentication:', err);
            return {
              success: false,
              escrowId: escrow.escrowId,
              clientSecret: escrow.paymentIntentClientSecret,
              status: 'requires_action',
              requiresAction: true,
              error: {
                type: err?.type || 'authentication_error',
                message: err?.message || 'Failed to complete authentication. Please try again or use a different payment method.',
                code: err?.code,
              },
            };
          }
        }

        return {
          success: confirmed.status === 'succeeded' || confirmed.status === 'requires_capture',
          escrowId: escrow.escrowId,
          paymentIntentId: confirmed.id,
          clientSecret: escrow.paymentIntentClientSecret,
          status: confirmed.status,
        };
      }

      // If not confirmed here, return client secret to allow caller to confirm later
      return {
        success: true,
        escrowId: escrow.escrowId,
        paymentIntentId: escrow.paymentIntentId,
        clientSecret: escrow.paymentIntentClientSecret,
        status: escrow.status,
      };
    } catch (error: any) {
      console.error('[PaymentService] Error creating escrow:', error);
      return {
        success: false,
        error: {
          type: error.type || 'unknown_error',
          message: error.message || 'Failed to create escrow',
          code: error.code,
        },
      };
    }
  }

  /**
   * Release an escrow: server captures PaymentIntent and transfers funds to hunter
   */
  async releaseEscrow(
    escrowId: string,
    authToken?: string
  ): Promise<EscrowReleaseResult> {
    try {
      const res = await stripeService.releaseEscrow(escrowId, authToken);
      return {
        success: true,
        transferId: res.transferId,
        paymentIntentId: res.paymentIntentId,
      };
    } catch (error: any) {
      console.error('[PaymentService] Error releasing escrow:', error);
      return {
        success: false,
        error: { message: error.message || 'Failed to release escrow' },
      };
    }
  }

  /**
   * Confirm a payment with proper error handling
   */
  async confirmPayment(
    options: ConfirmPaymentOptions,
    authToken?: string
  ): Promise<PaymentResult> {
    try {
      // Confirm payment using secure method with retry
      const result = await stripeService.confirmPaymentSecure(
        options.paymentIntentClientSecret,
        options.paymentMethodId,
        authToken,
        {
          userId: options.userId,
        }
      );

      // Check if additional action is required (3D Secure)
      if (result.status === 'requires_action') {
        return {
          success: false,
          requiresAction: true,
          paymentIntentId: result.id,
          status: result.status,
          error: {
            type: 'authentication_required',
            message: 'Additional authentication required',
          },
        };
      }

      // Check if payment succeeded
      if (result.status === 'succeeded') {
        return {
          success: true,
          paymentIntentId: result.id,
          amount: result.amount / 100,
          currency: result.currency,
          status: result.status,
        };
      }

      // Other statuses
      return {
        success: false,
        paymentIntentId: result.id,
        status: result.status,
        error: {
          type: 'payment_error',
          message: `Payment status: ${result.status}`,
        },
      };
    } catch (error: any) {
      console.error('[PaymentService] Error confirming payment:', error);

      return {
        success: false,
        error: {
          type: error.type || 'unknown_error',
          message: error.message || 'Failed to confirm payment',
          code: error.code,
        },
      };
    }
  }

  /**
   * Convert StripePaymentMethod to PaymentMethodResponse
   */
  private convertToPaymentMethodResponse(method: StripePaymentMethod): PaymentMethodResponse {
    // Use actual values from method if available, otherwise fall back to safe defaults.
    // If the StripePaymentMethod type does not include these fields, consider extending it.
    return {
      id: method.id,
      object: 'payment_method',
      billing_details: {
        address: method.billing_details?.address ?? null,
        email: method.billing_details?.email ?? null,
        name: method.billing_details?.name ?? null,
        phone: method.billing_details?.phone ?? null,
      },
      card: {
        brand: method.card.brand,
        checks: method.card.checks ?? undefined,
        country: method.card.country ?? undefined,
        exp_month: method.card.exp_month,
        exp_year: method.card.exp_year,
        fingerprint: method.card.fingerprint ?? undefined,
        // Use actual funding type if available, otherwise default to 'credit'
        funding: method.card.funding ?? 'credit', // TODO (Post-Launch): Extend StripePaymentMethod type if missing
        last4: method.card.last4,
      },
      created: method.created,
      customer: method.customer ?? null,
      // Use actual livemode if available, otherwise default to false
      livemode: method.livemode ?? false, // TODO (Post-Launch): Extend StripePaymentMethod type if missing
      // Use actual metadata if available, otherwise default to empty object
      metadata: method.metadata ?? {}, // TODO (Post-Launch): Extend StripePaymentMethod type if missing
      type: (method.type ?? 'card') as unknown as import('stripe').Stripe.PaymentMethod.Type,
    };
  }

  /**
   * List all saved payment methods for a user
   */
  async listPaymentMethods(authToken?: string): Promise<PaymentMethodListResult> {
    try {
      const methods = await stripeService.listPaymentMethods(authToken);

      return {
        success: true,
        paymentMethods: methods.map(m => this.convertToPaymentMethodResponse(m)),
      };
    } catch (error: any) {
      console.error('[PaymentService] Error listing payment methods:', error);

      return {
        success: false,
        paymentMethods: [],
        error: {
          message: error.message || 'Failed to load payment methods',
        },
      };
    }
  }

  /**
   * Remove a payment method
   */
  async removePaymentMethod(
    paymentMethodId: string,
    authToken?: string
  ): Promise<{ success: boolean; error?: { message: string } }> {
    try {
      await stripeService.detachPaymentMethod(paymentMethodId, authToken);

      await analyticsService.trackEvent('payment_method_removed', {
        paymentMethodId,
      });

      return { success: true };
    } catch (error: any) {
      console.error('[PaymentService] Error removing payment method:', error);

      return {
        success: false,
        error: {
          message: error.message || 'Failed to remove payment method',
        },
      };
    }
  }

  /**
   * Save a new payment method (Setup Intent flow)
   */
  async savePaymentMethod(
    authToken?: string
  ): Promise<{
    success: boolean;
    clientSecret?: string;
    error?: { message: string };
  }> {
    try {
      // Create setup intent
      const setupIntent = await stripeService.createSetupIntent(authToken);

      return {
        success: true,
        clientSecret: setupIntent.client_secret,
      };
    } catch (error: any) {
      console.error('[PaymentService] Error creating setup intent:', error);

      return {
        success: false,
        error: {
          message: error.message || 'Failed to save payment method',
        },
      };
    }
  }

  /**
   * Confirm saved payment method (after user completes setup)
   */
  async confirmSavePaymentMethod(
    clientSecret: string
  ): Promise<{ success: boolean; error?: { message: string } }> {
    try {
      const result = await stripeService.confirmSetupIntent(clientSecret);

      if (result.success) {
        await analyticsService.trackEvent('payment_method_saved', {
          paymentMethodId: result.paymentMethodId,
        });

        return { success: true };
      }

      return {
        success: false,
        error: {
          message: result.error?.message || 'Failed to save payment method',
        },
      };
    } catch (error: any) {
      console.error('[PaymentService] Error confirming setup intent:', error);

      return {
        success: false,
        error: {
          message: error.message || 'Failed to save payment method',
        },
      };
    }
  }

  /**
   * [UNIMPLEMENTED] Get payment receipt information
   * This method is not yet implemented and will throw if called.
   */
  async _getPaymentReceiptNotImplemented(
    paymentIntentId: string,
    authToken?: string
  ): Promise<never> {
    throw new Error("getPaymentReceipt is not implemented yet. This method is a placeholder and should not be used until the backend endpoint is ready.");
  }

  /**
   * Validate card number using Luhn algorithm
   */
  validateCardNumber(cardNumber: string): boolean {
    return stripeService.validateCardNumber(cardNumber);
  }

  /**
   * Format card for display
   */
  formatCardDisplay(paymentMethod: PaymentMethodResponse): string {
    // Adapter: convert PaymentMethodResponse to the expected type for stripeService.formatCardDisplay
    const adapted = this._adaptPaymentMethodForStripe(paymentMethod);
    return stripeService.formatCardDisplay(adapted);
  }

  /**
   * Adapter to convert PaymentMethodResponse to the type expected by stripeService.formatCardDisplay
   * Adjust the returned object as needed to match the expected shape.
   */
  private _adaptPaymentMethodForStripe(paymentMethod: PaymentMethodResponse): any {
    // This is a minimal adapter. Adjust fields as needed to match the expected input.
    // For example, if stripeService expects { card: { brand, last4, exp_month, exp_year } }
    // and PaymentMethodResponse has these fields, map them accordingly.
    return {
      card: {
        brand: paymentMethod.card?.brand ?? '',
        last4: paymentMethod.card?.last4 ?? '',
        exp_month: paymentMethod.card?.exp_month ?? null,
        exp_year: paymentMethod.card?.exp_year ?? null,
      },
      id: paymentMethod.id,
      // Add other fields as needed
    };
  }

  /**
   * Check if Stripe SDK is available (for native features)
   */
  isNativeSDKAvailable(): boolean {
    return stripeService.isSDKAvailable();
  }

  /**
   * Get security configuration
   */
  getSecurityConfig() {
    return PAYMENT_SECURITY_CONFIG;
  }
}

// Export singleton instance
export const paymentService = new PaymentService();

// Export class for testing
export { PaymentService };
