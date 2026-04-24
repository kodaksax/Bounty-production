/**
 * Stripe service — thin barrel/facade that delegates to focused sub-services.
 *
 * Historically this file was a ~2,400-line god-class handling SDK init,
 * PaymentIntents, SetupIntents, payment methods, escrow, Apple Pay, and
 * Stripe Connect. It has been split into focused modules:
 *
 *  - `stripe-sdk.ts`                — native SDK singleton (init, keys)
 *  - `stripe-internal.ts`           — shared helpers (invokePayments,
 *                                     handleStripeError, map helpers, types)
 *  - `escrow-service.ts`            — manual-capture PaymentIntent escrow
 *  - `payment-methods-service.ts`   — SetupIntents, save/list/remove cards
 *  - `connect-service.ts`           — Stripe Connect / hunter accounts
 *
 * This module keeps two responsibilities only:
 *  1. Re-exporting the shared types and the sub-service singletons for
 *     consumers that imported them from here historically.
 *  2. Exposing the legacy `stripeService` singleton whose methods delegate
 *     to the sub-services, preserving the full public API (initialize(),
 *     createPaymentIntent(), confirmPayment(), Apple Pay helpers, etc.).
 *
 * Prefer importing `escrowService`, `paymentMethodsService`, or
 * `connectService` directly in new code.
 */
import { logger } from '../utils/error-logger';
import { analyticsService } from './analytics-service';
import { connectService } from './connect-service';
import { escrowService } from './escrow-service';
import {
  completePaymentAttempt,
  checkDuplicatePayment,
  generateIdempotencyKey,
  logPaymentError,
  parsePaymentError,
  recordPaymentAttempt,
  withPaymentRetry,
} from './payment-error-handler';
import { paymentMethodsService } from './payment-methods-service';
import { performanceService } from './performance-service';
import {
  handleStripeError,
  invokePayments,
  mapPaymentIntentStatus,
  validateCardNumber as validateCardNumberFn,
} from './stripe-internal';
import { stripeSdk } from './stripe-sdk';

// Type-only imports for method signatures below (duplicates what we re-export,
// but imports must come before any `export ... from` statements).
import type {
  CreatePaymentMethodData,
  StripeConnectAccountResponse,
  StripeConnectVerificationResponse,
  StripeError,
  StripeEscrowCreateResponse,
  StripeEscrowRefundResponse,
  StripeEscrowReleaseResponse,
  StripePaymentIntent,
  StripePaymentMethod,
  StripeSetupIntent,
} from './stripe-internal';

// ─── Re-export shared types ────────────────────────────────────────────────
export type {
  CreatePaymentMethodData,
  PaymentConfirmationResult,
  StripeConnectAccountLinkResponse,
  StripeConnectAccountResponse,
  StripeConnectVerificationResponse,
  StripeError,
  StripeEscrowCreateResponse,
  StripeEscrowRefundResponse,
  StripeEscrowReleaseResponse,
  StripePaymentIntent,
  StripePaymentMethod,
  StripeSetupIntent,
} from './stripe-internal';

// ─── Re-export focused sub-service singletons ──────────────────────────────
export { connectService } from './connect-service';
export { escrowService } from './escrow-service';
export { paymentMethodsService } from './payment-methods-service';

/**
 * Legacy facade for existing callers. Methods delegate to the focused
 * sub-services. Prefer importing `escrowService`, `paymentMethodsService`,
 * or `connectService` directly in new code.
 */
class StripeService {
  // ── SDK lifecycle (delegates to stripeSdk singleton) ─────────────────────

  async initialize(): Promise<void> {
    return stripeSdk.initialize();
  }

  getStripeSDK(): any {
    return stripeSdk.getSDK();
  }

  isSDKAvailable(): boolean {
    return stripeSdk.isSDKAvailable();
  }

  getKeyMode(key: string): 'test' | 'live' | 'unknown' {
    return stripeSdk.getKeyMode(key);
  }

  getPublishableKeyMode(): 'test' | 'live' | 'unknown' {
    return stripeSdk.getPublishableKeyMode();
  }

  // ── Payment-methods / SetupIntents (delegates to paymentMethodsService) ──

  async createPaymentMethod(cardData: CreatePaymentMethodData): Promise<StripePaymentMethod> {
    return paymentMethodsService.createPaymentMethod(cardData);
  }

  async listPaymentMethods(authToken?: string): Promise<StripePaymentMethod[]> {
    return paymentMethodsService.listPaymentMethods(authToken);
  }

  async detachPaymentMethod(paymentMethodId: string, authToken?: string): Promise<void> {
    return paymentMethodsService.detachPaymentMethod(paymentMethodId, authToken);
  }

  async attachPaymentMethod(
    paymentMethodId: string,
    authToken?: string
  ): Promise<StripePaymentMethod> {
    return paymentMethodsService.attachPaymentMethod(paymentMethodId, authToken);
  }

  async createSetupIntent(authToken?: string): Promise<StripeSetupIntent> {
    return paymentMethodsService.createSetupIntent(authToken);
  }

  async confirmSetupIntent(clientSecret: string): Promise<{
    success: boolean;
    paymentMethodId?: string;
    error?: StripeError;
  }> {
    return paymentMethodsService.confirmSetupIntent(clientSecret);
  }

  // ── Escrow (delegates to escrowService) ──────────────────────────────────

  async createEscrow(
    params: {
      bountyId: string;
      amount: number;
      posterId: string;
      hunterId: string;
      currency?: string;
    },
    authToken?: string
  ): Promise<StripeEscrowCreateResponse> {
    return escrowService.createEscrow(params, authToken);
  }

  async releaseEscrow(
    escrowId: string,
    authToken?: string
  ): Promise<StripeEscrowReleaseResponse> {
    return escrowService.releaseEscrow(escrowId, authToken);
  }

  async refundEscrow(escrowId: string, authToken?: string): Promise<StripeEscrowRefundResponse> {
    return escrowService.refundEscrow(escrowId, authToken);
  }

  // ── Stripe Connect (delegates to connectService) ─────────────────────────

  async createConnectAccount(
    userId: string,
    email: string,
    authToken?: string
  ): Promise<StripeConnectAccountResponse> {
    return connectService.createConnectAccount(userId, email, authToken);
  }

  async createConnectAccountLink(accountId: string, authToken?: string): Promise<string> {
    return connectService.createConnectAccountLink(accountId, authToken);
  }

  async verifyConnectAccount(
    accountId: string,
    authToken?: string
  ): Promise<StripeConnectVerificationResponse> {
    return connectService.verifyConnectAccount(accountId, authToken);
  }

  // ── PaymentIntent flows (kept here — SDK-bound payment confirmation) ─────

  /**
   * Create a PaymentIntent via the backend API.
   *
   * NOTE: This method uses retries for reliability but is NOT idempotent.
   * If the backend doesn't use idempotency keys, retries could create duplicate
   * PaymentIntents. For critical payment flows, use createPaymentIntentSecure()
   * which includes built-in idempotency protection.
   *
   * @deprecated Use createPaymentIntentSecure() for all new payment flows.
   */
  async createPaymentIntent(
    amount: number,
    currency: string = 'usd',
    authToken?: string
  ): Promise<StripePaymentIntent> {
    performanceService.startMeasurement('payment_initiate', 'payment_process', {
      amount,
      currency,
    });

    try {
      await stripeSdk.initialize();

      // Validate amount before sending to backend
      if (amount <= 0) {
        throw {
          type: 'validation_error',
          code: 'invalid_amount',
          message: 'Amount must be positive',
        };
      }

      const { clientSecret, paymentIntentId } = await invokePayments<{
        clientSecret: string;
        paymentIntentId: string;
      }>('payments/create-payment-intent', {
        body: {
          amountCents: Math.round(amount * 100),
          currency,
          metadata: { purpose: 'wallet_deposit' },
        },
        ...(authToken ? { accessToken: authToken } : {}),
      });

      const paymentIntent: StripePaymentIntent = {
        id: paymentIntentId,
        client_secret: clientSecret,
        amount: Math.round(amount * 100),
        currency,
        status: 'requires_payment_method',
      };

      // Track payment initiated
      await analyticsService.trackEvent('payment_initiated', {
        amount,
        currency,
        paymentIntentId: paymentIntent.id,
      });

      await performanceService.endMeasurement('payment_initiate', {
        success: true,
        amount,
      });

      return paymentIntent;
    } catch (error) {
      logger.error('[StripeService] Error creating payment intent:', { error });

      await analyticsService.trackEvent('payment_failed', {
        amount,
        currency,
        error: String(error),
        stage: 'initiate',
      });

      await performanceService.endMeasurement('payment_initiate', {
        success: false,
        error: String(error),
      });

      throw handleStripeError(error);
    }
  }

  /**
   * Confirm a payment using the Stripe SDK. Handles 3D Secure authentication
   * when required. Notifies the backend after successful confirmation.
   */
  async confirmPayment(
    paymentIntentClientSecret: string,
    paymentMethodId: string,
    authToken?: string
  ): Promise<StripePaymentIntent> {
    performanceService.startMeasurement('payment_confirm', 'payment_process', {
      paymentMethodId,
    });

    try {
      await stripeSdk.initialize();

      const sdk = stripeSdk.getSDK();
      let paymentIntent: StripePaymentIntent;

      // Try to use the native Stripe SDK for confirmation (handles 3DS)
      if (sdk?.confirmPayment) {
        const { paymentIntent: confirmedIntent, error } = await sdk.confirmPayment(
          paymentIntentClientSecret,
          {
            paymentMethodType: 'Card',
            paymentMethodData: {
              paymentMethodId,
            },
          }
        );

        if (error) {
          // Handle specific error cases
          if (error.code === 'Canceled') {
            throw {
              type: 'card_error',
              code: 'canceled',
              message: 'Payment was cancelled',
            };
          }
          throw {
            type: error.type || 'card_error',
            code: error.code,
            decline_code: error.declineCode,
            message: error.message || 'Payment confirmation failed',
          };
        }

        if (confirmedIntent) {
          paymentIntent = {
            id: confirmedIntent.id,
            client_secret: paymentIntentClientSecret,
            amount: confirmedIntent.amount,
            currency: confirmedIntent.currency,
            status: mapPaymentIntentStatus(confirmedIntent.status),
          };
        } else {
          throw {
            type: 'api_error',
            code: 'unknown',
            message: 'Payment confirmation returned empty result',
          };
        }
      } else {
        // Fallback for non-native environments (development/testing)
        // In production, this should always use the native SDK
        paymentIntent = {
          id: paymentIntentClientSecret.split('_secret_')[0],
          client_secret: paymentIntentClientSecret,
          amount: 0,
          currency: 'usd',
          status: 'succeeded',
        };

        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      // Handle requires_action status (3D Secure)
      if (paymentIntent.status === 'requires_action') {
        // The SDK should have already handled 3DS if native SDK is available
        // If we get here in fallback mode, we need to handle it manually
        if (!sdk?.handleNextAction) {
          throw {
            type: 'card_error',
            code: 'authentication_required',
            message: 'Additional authentication required. Please try again in a supported browser.',
          };
        }

        const { paymentIntent: handledIntent, error } =
          await sdk.handleNextAction(paymentIntentClientSecret);

        if (error) {
          throw {
            type: 'card_error',
            code: error.code || 'authentication_failed',
            message: error.message || 'Authentication failed',
          };
        }

        if (handledIntent) {
          paymentIntent = {
            id: handledIntent.id,
            client_secret: paymentIntentClientSecret,
            amount: handledIntent.amount,
            currency: handledIntent.currency,
            status: mapPaymentIntentStatus(handledIntent.status),
          };
        }
      }

      if (paymentIntent.status === 'succeeded') {
        // Notify backend about the successful payment confirmation
        // This ensures the backend is aware of 3DS authentication completion
        try {
          const paymentIntentId = paymentIntentClientSecret.split('_secret_')[0];
          await invokePayments('payments/confirm', {
            body: { paymentIntentId, paymentMethodId } as Record<string, unknown>,
          });
        } catch (backendError) {
          // Log but don't fail - the webhook will handle the actual balance update
          logger.error('[StripeService] Failed to notify backend of confirmation:', {
            error: backendError,
          });
        }

        // Track payment completed
        await analyticsService.trackEvent('payment_completed', {
          paymentIntentId: paymentIntent.id,
          paymentMethodId,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency,
        });

        // Increment user property for payments
        await analyticsService.incrementUserProperty('payments_completed');
      }

      await performanceService.endMeasurement('payment_confirm', {
        success: paymentIntent.status === 'succeeded',
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
      });

      return paymentIntent;
    } catch (error) {
      logger.error('[StripeService] Error confirming payment:', { error });

      await analyticsService.trackEvent('payment_failed', {
        paymentMethodId,
        error: String(error),
        stage: 'confirm',
      });

      await performanceService.endMeasurement('payment_confirm', {
        success: false,
        error: String(error),
      });

      throw handleStripeError(error);
    }
  }

  /**
   * Present the Stripe Payment Sheet for a streamlined checkout experience.
   */
  async presentPaymentSheet(clientSecret: string): Promise<{
    success: boolean;
    error?: StripeError;
  }> {
    try {
      await stripeSdk.initialize();

      const sdk = stripeSdk.getSDK();
      if (!sdk?.initPaymentSheet || !sdk?.presentPaymentSheet) {
        // Fallback for non-native environments
        return {
          success: false,
          error: {
            type: 'api_error',
            code: 'not_supported',
            message: 'Payment sheet is not available. Please use the card form.',
          },
        };
      }

      // Initialize the payment sheet
      const { DEEP_LINK_SCHEME } = await import('../config/app');
      const { error: initError } = await sdk.initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: 'BountyExpo',
        style: 'automatic',
        googlePay: {
          merchantCountryCode: 'US',
          testEnv: !stripeSdk.getPublishableKey().startsWith('pk_live'),
        },
        applePay: {
          merchantCountryCode: 'US',
        },
        defaultBillingDetails: {},
        returnURL: `${DEEP_LINK_SCHEME}://payment-complete`,
      });

      if (initError) {
        return {
          success: false,
          error: {
            type: 'api_error',
            code: initError.code,
            message: initError.message,
          },
        };
      }

      // Present the payment sheet
      const { error: presentError } = await sdk.presentPaymentSheet();

      if (presentError) {
        // User cancelled is a special case
        if (presentError.code === 'Canceled') {
          return {
            success: false,
            error: {
              type: 'card_error',
              code: 'canceled',
              message: 'Payment was cancelled',
            },
          };
        }

        return {
          success: false,
          error: {
            type: presentError.type || 'card_error',
            code: presentError.code,
            message: presentError.message,
          },
        };
      }

      return { success: true };
    } catch (error) {
      logger.error('[StripeService] Error presenting payment sheet:', { error });
      return {
        success: false,
        error: handleStripeError(error) as StripeError,
      };
    }
  }

  /**
   * Handle 3D Secure / next actions for a PaymentIntent client secret using the native SDK.
   * Returns the updated PaymentIntent status when available.
   */
  async handleNextAction(clientSecret: string): Promise<StripePaymentIntent> {
    performanceService.startMeasurement('payment_next_action', 'payment_process', {});

    try {
      await stripeSdk.initialize();

      if (!clientSecret) {
        throw {
          type: 'validation_error',
          code: 'invalid_params',
          message: 'clientSecret is required',
        };
      }

      const sdk = stripeSdk.getSDK();
      if (!sdk?.handleNextAction) {
        // Fallback: assume succeeded for dev environments
        const fallback: StripePaymentIntent = {
          id: clientSecret.split('_secret_')[0],
          client_secret: clientSecret,
          amount: 0,
          currency: 'usd',
          status: 'succeeded',
        };
        await performanceService.endMeasurement('payment_next_action', {
          success: true,
          status: fallback.status,
        });
        return fallback;
      }

      const { paymentIntent, error } = await sdk.handleNextAction(clientSecret);

      if (error) {
        await performanceService.endMeasurement('payment_next_action', {
          success: false,
          error: String(error),
        });
        throw handleStripeError(error);
      }

      if (paymentIntent) {
        const mapped: StripePaymentIntent = {
          id: paymentIntent.id,
          client_secret: clientSecret,
          amount: paymentIntent.amount ?? 0,
          currency: paymentIntent.currency ?? 'usd',
          status: mapPaymentIntentStatus(paymentIntent.status),
        };
        await performanceService.endMeasurement('payment_next_action', {
          success: true,
          status: mapped.status,
        });
        return mapped;
      }

      // No intent returned
      await performanceService.endMeasurement('payment_next_action', { success: false });
      throw { type: 'api_error', message: 'No payment intent returned from handleNextAction' };
    } catch (error) {
      logger.error('[StripeService] Error handling next action:', { error });
      await performanceService.endMeasurement('payment_next_action', {
        success: false,
        error: String(error),
      });
      throw handleStripeError(error);
    }
  }

  // ── Secure idempotent wrappers ───────────────────────────────────────────

  /**
   * Create a payment intent with idempotency and duplicate protection.
   * This is the secure way to create payments.
   */
  async createPaymentIntentSecure(
    amount: number,
    currency: string = 'usd',
    authToken?: string,
    options?: {
      userId?: string;
      purpose?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<StripePaymentIntent> {
    const { userId = 'anonymous', purpose = 'payment' } = options || {};

    // Generate idempotency key for duplicate protection
    const idempotencyKey = generateIdempotencyKey(userId, amount, purpose);

    // Check for duplicate submission
    if (checkDuplicatePayment(idempotencyKey)) {
      const duplicateError = {
        type: 'idempotency_error',
        code: 'duplicate_transaction',
        message: 'This payment is already being processed. Please wait.',
      };
      throw duplicateError;
    }

    // Record the payment attempt
    recordPaymentAttempt(idempotencyKey);

    try {
      // Use retry wrapper for transient errors
      const result = await withPaymentRetry(
        async () => {
          return await this.createPaymentIntent(amount, currency, authToken);
        },
        {
          maxRetries: 3,
          baseDelayMs: 1000,
          maxDelayMs: 5000,
        }
      );

      // Payment successful, complete the attempt tracking
      completePaymentAttempt(idempotencyKey);

      return result;
    } catch (error) {
      // Parse and log the error
      const paymentError = parsePaymentError(error);
      await logPaymentError(paymentError, {
        amount,
        currency,
        userId,
        stage: 'initiate',
      });

      // Complete the attempt tracking (allows retry after error)
      completePaymentAttempt(idempotencyKey);

      throw error;
    }
  }

  /**
   * Confirm payment with enhanced error handling and logging.
   */
  async confirmPaymentSecure(
    paymentIntentClientSecret: string,
    paymentMethodId: string,
    authToken?: string,
    options?: {
      userId?: string;
    }
  ): Promise<StripePaymentIntent> {
    const { userId } = options || {};

    try {
      const result = await withPaymentRetry(
        async () => {
          return await this.confirmPayment(paymentIntentClientSecret, paymentMethodId, authToken);
        },
        {
          maxRetries: 2, // Fewer retries for confirmation
          baseDelayMs: 2000,
          maxDelayMs: 5000,
        }
      );

      return result;
    } catch (error) {
      // Parse and log the error
      const paymentError = parsePaymentError(error);
      await logPaymentError(paymentError, {
        paymentIntentId: paymentIntentClientSecret.split('_secret_')[0],
        userId,
        stage: 'confirm',
      });

      throw error;
    }
  }

  // ── Apple Pay ────────────────────────────────────────────────────────────

  /**
   * Check if Apple Pay is supported on this device.
   */
  async isApplePaySupported(): Promise<boolean> {
    try {
      // Apple Pay is only available on iOS
      const { Platform } = await import('react-native');
      if (Platform.OS !== 'ios') {
        return false;
      }

      await stripeSdk.initialize();

      // Check if the SDK is available and has Apple Pay support
      const sdk = stripeSdk.getSDK();
      if (!sdk) {
        return false;
      }

      // Try to access isApplePaySupported from the SDK
      // The method might be at different locations depending on SDK version
      const isApplePaySupportedFn =
        sdk.isApplePaySupported || sdk.ApplePay?.isApplePaySupported;

      if (typeof isApplePaySupportedFn === 'function') {
        return await isApplePaySupportedFn();
      }

      return false;
    } catch (error) {
      logger.error('[StripeService] Error checking Apple Pay support:', { error });
      return false;
    }
  }

  /**
   * Present Apple Pay payment sheet.
   */
  async presentApplePay(
    amount: number,
    description: string = 'Add Money to Wallet',
    cartItems?: { label: string; amount: string; type?: 'final' | 'pending' }[]
  ): Promise<{
    success: boolean;
    error?: string;
    errorCode?: string;
  }> {
    try {
      // Check platform first - Apple Pay is iOS only
      const { Platform } = await import('react-native');
      if (Platform.OS !== 'ios') {
        return {
          success: false,
          error: 'Apple Pay is only available on iOS',
          errorCode: 'platform_not_supported',
        };
      }

      // Validate amount - enforce Stripe's minimum charge amount
      if (amount < 0.5) {
        return {
          success: false,
          error: 'Amount must be at least $0.50',
          errorCode: 'invalid_amount',
        };
      }

      // If custom cartItems are provided, validate that their total matches the amount
      if (cartItems && cartItems.length > 0) {
        const totalFromCart = cartItems.reduce((sum, item) => {
          const itemAmount = Number(item.amount);
          return Number.isFinite(itemAmount) ? sum + itemAmount : sum;
        }, 0);

        const totalFromCartInCents = Math.round(totalFromCart * 100);
        const amountInCents = Math.round(amount * 100);

        if (
          Number.isFinite(totalFromCartInCents) &&
          Number.isFinite(amountInCents) &&
          totalFromCartInCents !== amountInCents
        ) {
          logger.warning('[StripeService] Apple Pay amount mismatch:', { amount, totalFromCart });
          return {
            success: false,
            error: 'Payment amount does not match cart total',
            errorCode: 'amount_mismatch',
          };
        }
      }

      await stripeSdk.initialize();

      const sdk = stripeSdk.getSDK();
      if (!sdk) {
        return {
          success: false,
          error: 'Stripe SDK not available',
          errorCode: 'sdk_unavailable',
        };
      }

      // Get the presentApplePay function from SDK
      const presentApplePayFn =
        sdk.presentApplePay || sdk.ApplePay?.presentApplePay;

      if (typeof presentApplePayFn !== 'function') {
        return {
          success: false,
          error: 'Apple Pay not available in this SDK version',
          errorCode: 'apple_pay_unavailable',
        };
      }

      // Prepare cart items
      const items = cartItems || [
        {
          label: description,
          amount: amount.toFixed(2),
          type: 'final' as const,
        },
      ];

      // Present the Apple Pay sheet
      const { error: presentError } = await presentApplePayFn({
        cartItems: items,
        country: 'US',
        currency: 'USD',
        requiredShippingAddressFields: [],
        requiredBillingContactFields: ['postalAddress'],
      });

      if (presentError) {
        logger.error('[StripeService] Apple Pay presentation error:', { error: presentError });

        // Handle user cancellation separately
        const cancelCodes = ['Canceled', 'canceled', 'USER_CANCELLED', 'user_cancelled'];
        if (presentError.code && cancelCodes.includes(presentError.code)) {
          return {
            success: false,
            error: 'Payment cancelled by user',
            errorCode: 'cancelled',
          };
        }

        return {
          success: false,
          error: presentError.message || 'Failed to present Apple Pay',
          errorCode: presentError.code,
        };
      }

      // If we get here, the payment was presented successfully
      // Note: The actual payment confirmation should be handled separately
      // using confirmApplePayPayment with the client secret
      return {
        success: true,
      };
    } catch (error) {
      logger.error('[StripeService] Error presenting Apple Pay:', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'unknown_error',
      };
    }
  }

  // ── Small utilities ──────────────────────────────────────────────────────

  /** Format card brand + last-4 for display. */
  formatCardDisplay(paymentMethod: StripePaymentMethod): string {
    const brand = paymentMethod.card.brand.toUpperCase();
    const last4 = paymentMethod.card.last4;
    return `${brand} •••• •••• •••• ${last4}`;
  }

  /** Basic Luhn-algorithm card number validation. */
  validateCardNumber(cardNumber: string): boolean {
    return validateCardNumberFn(cardNumber);
  }

  /**
   * Parse a Stripe error to detect mode mismatch issues.
   * @returns User-friendly error message if mode mismatch is detected, otherwise original message
   */
  parseStripeError(error: any): string {
    if (!error) return 'An unknown error occurred';

    const errorMessage = error.message || error.toString();

    // Handle network and timeout errors with user-friendly messages
    // Distinguish our own infra timeouts (TIMEOUT code) from a browser/OS-level
    // TimeoutError so we don't blame the user's connection when the real cause
    // is an Edge Function that isn't deployed or a paused Supabase project.
    if (
      (error as any)?.code === 'TIMEOUT' ||
      ((error as any)?.type === 'network_error' && errorMessage.includes('timed out'))
    ) {
      return 'Payment service is temporarily unavailable. Please try again later.';
    }

    if (
      error.name === 'TimeoutError' ||
      errorMessage.includes('timed out') ||
      errorMessage.includes('timeout')
    ) {
      return 'Connection timed out. Please check your internet connection and try again.';
    }

    if (error.name === 'AbortError') {
      // Don't show the generic "Aborted" message
      return 'Connection interrupted. Please check your internet connection and try again.';
    }

    if (
      error.name === 'NetworkError' ||
      errorMessage.includes('Network') ||
      errorMessage.includes('fetch failed')
    ) {
      return 'Unable to connect. Please check your internet connection.';
    }

    // Detect test/live mode mismatch
    if (
      errorMessage.includes('No such setupintent') ||
      errorMessage.includes('No such paymentintent')
    ) {
      if (errorMessage.includes('live mode') && errorMessage.includes('test mode key')) {
        return 'Payment configuration error: Your payment keys are in different modes. Please contact support or check your environment configuration.';
      }
      if (errorMessage.includes('test mode') && errorMessage.includes('live mode key')) {
        return 'Payment configuration error: Your payment keys are in different modes. Please contact support or check your environment configuration.';
      }
    }

    // Return original message if no special case detected
    return errorMessage;
  }
}

/** Legacy singleton. Prefer the focused sub-services in new code. */
export const stripeService = new StripeService();
