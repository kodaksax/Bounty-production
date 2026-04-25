/**
 * Stripe payment-method and SetupIntent flows.
 *
 * Handles:
 *  - `createPaymentMethod` — native-SDK / fallback card tokenization
 *  - `listPaymentMethods`  — fetch saved PMs via Edge Function with a
 *    direct-DB fallback via PostgREST when the function is unavailable
 *  - `attachPaymentMethod` — persist a PM to the user's Stripe customer
 *  - `detachPaymentMethod` — remove a saved PM
 *  - `createSetupIntent`   — off-session SetupIntent for saving cards
 *  - `confirmSetupIntent`  — present PaymentSheet for SetupIntent confirmation
 *
 * Extracted from the original monolithic `stripe-service.ts`.
 */
import { supabase } from '../supabase';
import { logger } from '../utils/error-logger';
import { getNetworkErrorMessage } from '../utils/network-connectivity';
import { analyticsService } from './analytics-service';
import { performanceService } from './performance-service';
import {
  CreatePaymentMethodData,
  detectCardBrand,
  handleStripeError,
  invokePayments,
  StripeError,
  StripePaymentMethod,
  StripeSetupIntent,
  validateCardNumber,
} from './stripe-internal';
import { stripeSdk } from './stripe-sdk';

class PaymentMethodsService {
  /**
   * Create a payment method using the Stripe SDK.
   * For production, this uses the native Stripe SDK to tokenize card data.
   */
  async createPaymentMethod(cardData: CreatePaymentMethodData): Promise<StripePaymentMethod> {
    try {
      await stripeSdk.initialize();

      // Detect manual entry usage: when explicit card fields are provided, avoid SDK path
      const isManualEntry =
        !!cardData.cardNumber && !!cardData.expiryDate && !!cardData.securityCode;

      const sdk = stripeSdk.getSDK();

      // Try to use the native Stripe SDK if available, only when not using manual entry
      if (sdk?.createPaymentMethod && !isManualEntry) {
        const { paymentMethod, error } = await sdk.createPaymentMethod({
          paymentMethodType: 'Card',
          paymentMethodData: {
            billingDetails: {
              name: cardData.cardholderName,
            },
          },
        });

        if (error) {
          throw {
            type: 'card_error',
            code: error.code,
            message: error.message,
          };
        }

        if (paymentMethod) {
          return {
            id: paymentMethod.id,
            type: 'card',
            card: {
              brand: paymentMethod.Card?.brand || 'unknown',
              last4: paymentMethod.Card?.last4 || '****',
              exp_month: paymentMethod.Card?.expMonth || 0,
              exp_year: paymentMethod.Card?.expYear || 0,
            },
            created: Math.floor(Date.now() / 1000),
          };
        }
      }

      // Fallback: Create payment method using card details (for development/testing)
      // In production, this should use CardField or PaymentSheet
      // Validate basic card inputs for fallback
      const cleanNumber = cardData.cardNumber.replace(/\s/g, '');
      if (!validateCardNumber(cleanNumber)) {
        throw {
          type: 'validation_error',
          code: 'incorrect_number',
          message: 'Please enter a valid card number',
        };
      }
      const [mm, yy] = cardData.expiryDate.split('/');
      const expMonth = parseInt(mm, 10);
      const expYear = parseInt('20' + yy, 10);
      if (!expMonth || expMonth < 1 || expMonth > 12 || !expYear) {
        throw {
          type: 'validation_error',
          code: 'expired_card',
          message: 'Please enter a valid expiry date',
        };
      }
      const paymentMethod: StripePaymentMethod = {
        id: `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'card',
        card: {
          brand: detectCardBrand(cardData.cardNumber),
          last4: cleanNumber.slice(-4),
          exp_month: expMonth,
          exp_year: expYear,
        },
        created: Math.floor(Date.now() / 1000),
      };

      // Simulate network delay for fallback
      await new Promise(resolve => setTimeout(resolve, 500));

      return paymentMethod;
    } catch (error) {
      logger.error('[StripeService] Error creating payment method:', { error });
      throw handleStripeError(error);
    }
  }

  /**
   * List saved payment methods for the current user
   * Fetches from the backend API which queries Stripe.
   */
  async listPaymentMethods(authToken?: string): Promise<StripePaymentMethod[]> {
    try {
      await stripeSdk.initialize();

      // If no auth token, return empty array
      if (!authToken) {
        return [];
      }

      // Helper to map raw API response rows to StripePaymentMethod objects
      const mapMethods = (fnData: { paymentMethods: unknown[] }): StripePaymentMethod[] =>
        (fnData?.paymentMethods || []).map((pm: unknown) => {
          const pmData = pm as Record<string, unknown>;
          const typeStr = (pmData.type as string) || 'card';
          if (typeStr === 'us_bank_account') {
            const bank = (pmData.us_bank_account || {}) as Record<string, unknown>;
            return {
              id: (pmData.id as string) || '',
              type: 'us_bank_account' as const,
              // Card field is required by the type but unused for ACH; populate
              // with stable defaults so downstream code doesn't crash.
              card: { brand: 'unknown', last4: '****', exp_month: 0, exp_year: 0 },
              us_bank_account: {
                bank_name: (bank.bank_name as string | null) ?? null,
                last4: (bank.last4 as string | null) ?? null,
                account_type: (bank.account_type as string | null) ?? null,
                fc_account_id: (bank.fc_account_id as string | null) ?? null,
                stripe_external_account_id:
                  (bank.stripe_external_account_id as string | null) ?? null,
                verification_status:
                  (bank.verification_status as
                    | 'verified'
                    | 'pending_microdeposits'
                    | 'failed'
                    | null) ?? null,
                is_default: Boolean(bank.is_default),
              },
              created: (pmData.created as number) || Math.floor(Date.now() / 1000),
            };
          }
          const cardData = (pmData.card || {}) as Record<string, unknown>;
          return {
            id: (pmData.id as string) || '',
            type: 'card' as const,
            card: {
              brand: (cardData.brand || pmData.card_brand || 'unknown') as string,
              last4: (cardData.last4 || pmData.card_last4 || '****') as string,
              exp_month: (cardData.exp_month || pmData.card_exp_month || 0) as number,
              exp_year: (cardData.exp_year || pmData.card_exp_year || 0) as number,
            },
            created: (pmData.created as number) || Math.floor(Date.now() / 1000),
          };
        });

      // First attempt: use the React-state token directly (fast path — avoids
      // supabase-js getSession() lock contention described in invokePayments).
      let fnData: { paymentMethods: unknown[] };
      try {
        fnData = await invokePayments<{ paymentMethods: unknown[] }>('payments/methods', {
          method: 'GET',
          accessToken: authToken,
        });
      } catch (firstErr: unknown) {
        const fe = firstErr as Record<string, unknown>;
        const is401 = fe?.type === 'api_error' && String(fe?.code) === '401';
        if (!is401) throw firstErr;

        // 401: the React-state token is stale (server-side expiry or clock-skew).
        // Use refreshSession() instead of getSession() — getSession() can return
        // the same stale cached token from the supabase-js internal session lock,
        // while refreshSession() makes a real server call and returns the fresh
        // token directly in the result.
        logger.warning(
          '[StripeService] 401 on payment methods — retrying with fresh session token.',
          {}
        );
        let freshToken: string | undefined;
        try {
          const refreshResult = await Promise.race([
            supabase.auth.refreshSession() as Promise<{
              data: { session: { access_token: string } | null };
              error: unknown;
            }>,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('refreshSession timeout')), 5000)
            ),
          ]);
          freshToken = refreshResult.data?.session?.access_token;
        } catch {
          // refreshSession() timed out or errored — propagate the original 401
          throw firstErr;
        }

        if (!freshToken) {
          // No session after refresh — propagate the 401
          throw firstErr;
        }

        // Retry with the fresh token.  If this also fails, the outer catch handles it.
        fnData = await invokePayments<{ paymentMethods: unknown[] }>('payments/methods', {
          method: 'GET',
          accessToken: freshToken,
        });
      }

      return mapMethods(fnData);
    } catch (error) {
      // Any 401 that survived the internal retry above is a persistent auth
      // failure (session revoked, wrong project, etc.).  Log at warning level
      // so the StripeContext catch-handler can decide how to surface it.
      const _err = error as Record<string, unknown> | null;
      const _is401AuthError = _err && _err.type === 'api_error' && String(_err.code) === '401';
      if (_is401AuthError) {
        logger.warning(
          '[StripeService] 401 on payment methods (after retry) — trying direct DB fallback.',
          { error }
        );
      } else {
        logger.error('[StripeService] Error fetching payment methods via Edge Function:', {
          error,
        });
      }

      // ── Direct DB fallback ───────────────────────────────────────────────
      // When the Edge Function call fails (e.g. 401 "Invalid JWT" from the
      // Supabase gateway, cold-start timeout, or network issue), try querying
      // the payment_methods table directly via PostgREST.  The Supabase JS
      // client manages its own auth token internally (via refreshSession),
      // which may succeed even when the React-state token passed to the Edge
      // Function was stale.  The payment_methods table has RLS policies that
      // allow users to SELECT their own rows (auth.uid() = user_id).
      try {
        interface PaymentMethodRow {
          stripe_payment_method_id: string | null;
          type: string | null;
          card_brand: string | null;
          card_last4: string | null;
          card_exp_month: number | null;
          card_exp_year: number | null;
          created_at: string | null;
        }
        const { data: dbMethods, error: dbError } = await supabase
          .from('payment_methods')
          .select(
            'stripe_payment_method_id, type, card_brand, card_last4, card_exp_month, card_exp_year, created_at'
          )
          .order('created_at', { ascending: false });

        if (!dbError && dbMethods && dbMethods.length > 0) {
          logger.info('[StripeService] Direct DB fallback returned payment methods.', {
            count: dbMethods.length,
          });
          return (dbMethods as PaymentMethodRow[]).map(pm => ({
            id: pm.stripe_payment_method_id ?? '',
            type: 'card' as const,
            card: {
              brand: pm.card_brand ?? 'unknown',
              last4: pm.card_last4 ?? '****',
              exp_month: pm.card_exp_month ?? 0,
              exp_year: pm.card_exp_year ?? 0,
            },
            created: pm.created_at
              ? Math.floor(new Date(pm.created_at).getTime() / 1000)
              : Math.floor(Date.now() / 1000),
          }));
        }
        // DB returned no rows — fall through to throw the original error
        if (dbError) {
          logger.warning('[StripeService] Direct DB fallback also failed.', { dbError });
        }
      } catch (dbFallbackErr) {
        logger.warning('[StripeService] Direct DB fallback threw.', { error: dbFallbackErr });
      }

      // Use proper typing for enhanced error with dynamic properties
      type EnhancedError = Error & Record<string, unknown> & { cause?: unknown };

      // For structured API errors (e.g. 4xx/5xx from Edge Function), preserve the
      // original message so callers see the actual status code rather than a generic
      // "Connection failed" string produced by getNetworkErrorMessage.
      const isStructuredApiError =
        error &&
        typeof error === 'object' &&
        !Array.isArray(error) &&
        (error as Record<string, unknown>).type === 'api_error' &&
        (error as Record<string, unknown>).code;

      let enhancedError: EnhancedError;
      if (isStructuredApiError) {
        // Keep the original message; only wrap in an Error if needed
        const originalError = error as Record<string, unknown>;
        enhancedError = (
          error instanceof Error ? error : new Error(String(originalError.message))
        ) as EnhancedError;
        // Copy structured fields so handleStripeError can read type/code
        for (const [key, value] of Object.entries(originalError)) {
          if (!(key in enhancedError)) {
            enhancedError[key] = value;
          }
        }
      } else {
        // For network-level errors, enhance with a user-friendly message
        const errorMessage = getNetworkErrorMessage(error);
        enhancedError =
          error instanceof Error
            ? (error as EnhancedError)
            : (new Error(errorMessage) as EnhancedError);
        if (errorMessage && enhancedError.message !== errorMessage) {
          enhancedError.message = errorMessage;
        }
        // Preserve structured fields (type, code) from non-Error throws for handleStripeError
        if (error && typeof error === 'object' && !(error instanceof Error)) {
          const originalError = error as Record<string, unknown>;
          for (const [key, value] of Object.entries(originalError)) {
            if (key !== 'message' && key !== 'name' && key !== 'stack' && !(key in enhancedError)) {
              enhancedError[key] = value;
            }
          }
        }
      }

      if (!enhancedError.name) {
        enhancedError.name = error instanceof Error ? error.name : 'Error';
      }

      // Preserve original error for debugging
      if (!enhancedError.cause) {
        enhancedError.cause = error;
      }

      // Rethrow a handled error so upstream callers (context/services) can
      // present a clear error message to the user instead of silently
      // treating an error as "no payment methods".
      throw handleStripeError(enhancedError);
    }
  }

  /**
   * Detach (remove) a payment method.
   */
  async detachPaymentMethod(paymentMethodId: string, authToken?: string): Promise<void> {
    try {
      await stripeSdk.initialize();

      if (!authToken) {
        throw new Error('Authentication required to remove payment method');
      }

      await invokePayments(`payments/methods/${paymentMethodId}`, {
        method: 'DELETE',
        accessToken: authToken,
      });
    } catch (error) {
      logger.error('[StripeService] Error detaching payment method:', { error });
      throw handleStripeError(error);
    }
  }

  /**
   * Attach (save) an existing payment method to the current user's Stripe customer.
   * Calls POST /payments/methods on the backend to persist the payment method.
   */
  async attachPaymentMethod(
    paymentMethodId: string,
    authToken?: string
  ): Promise<StripePaymentMethod> {
    try {
      await stripeSdk.initialize();

      if (!authToken) {
        throw new Error('Authentication required to save payment method');
      }

      let rawJson: Record<string, unknown> | null = null;
      try {
        rawJson = await invokePayments<Record<string, unknown>>('payments/methods', {
          body: { paymentMethodId } as Record<string, unknown>,
          ...(authToken ? { accessToken: authToken } : {}),
        });
      } catch (parseErr: unknown) {
        // Log unexpected (unstructured) errors before re-throwing so we preserve
        // the original cause in production logs instead of masking it with the
        // generic "invalid response format" error that follows this block.
        if (!parseErr || typeof parseErr !== 'object' || !('type' in (parseErr as object))) {
          logger.error(
            '[StripeService] Failed to invoke attachPaymentMethod (network or unexpected error):',
            { error: parseErr }
          );
        }
        // Always re-throw — structured API/auth errors AND raw network errors must
        // propagate to the outer catch so callers receive the real failure reason.
        throw parseErr;
      }
      if (!rawJson || typeof rawJson !== 'object') {
        throw {
          type: 'api_error',
          code: 'invalid_response',
          message: 'Payment method save failed: invalid response format from server',
        };
      }

      const pmValue = rawJson.paymentMethod;
      if (!pmValue || typeof pmValue !== 'object') {
        throw {
          type: 'api_error',
          code: 'invalid_response',
          message: 'Payment method save failed: missing payment method in server response',
        };
      }

      const pm = pmValue as Record<string, unknown>;
      const rawCard = pm.card;
      const cardData = (rawCard && typeof rawCard === 'object' ? rawCard : {}) as Record<
        string,
        unknown
      >;
      return {
        id: (typeof pm.id === 'string' ? pm.id : '') || '',
        type: 'card' as const,
        card: {
          brand: typeof cardData.brand === 'string' ? cardData.brand : 'unknown',
          last4: typeof cardData.last4 === 'string' ? cardData.last4 : '****',
          exp_month: typeof cardData.exp_month === 'number' ? cardData.exp_month : 0,
          exp_year: typeof cardData.exp_year === 'number' ? cardData.exp_year : 0,
        },
        created: typeof pm.created === 'number' ? pm.created : Math.floor(Date.now() / 1000),
      };
    } catch (error) {
      logger.error('[StripeService] Error attaching payment method:', { error });

      // Use proper typing for enhanced error with known Stripe error fields
      type EnhancedError = Error & { type?: string; code?: string; cause?: unknown };

      // For structured API errors (e.g. 4xx/5xx from Edge Function), preserve the
      // original message so the status code surfaces to the caller.
      const isStructuredApiError =
        error &&
        typeof error === 'object' &&
        !Array.isArray(error) &&
        (error as Record<string, unknown>).type === 'api_error' &&
        (error as Record<string, unknown>).code;

      let enhancedError: EnhancedError;
      if (isStructuredApiError) {
        const originalError = error as Record<string, string | undefined>;
        enhancedError = (
          error instanceof Error ? error : new Error(String(originalError.message))
        ) as EnhancedError;
        if (!enhancedError.type) enhancedError.type = originalError.type;
        if (!enhancedError.code) enhancedError.code = originalError.code;
      } else {
        const errorMessage = getNetworkErrorMessage(error);
        enhancedError =
          error instanceof Error
            ? (error as EnhancedError)
            : (new Error(errorMessage) as EnhancedError);
        if (errorMessage && enhancedError.message !== errorMessage) {
          enhancedError.message = errorMessage;
        }
      }

      if (!enhancedError.name) {
        enhancedError.name = error instanceof Error ? error.name : 'Error';
      }
      if (!enhancedError.cause) {
        enhancedError.cause = error;
      }

      throw handleStripeError(enhancedError);
    }
  }

  /**
   * Create a SetupIntent for saving a payment method without charging.
   * This is the recommended approach for PCI compliance when saving cards.
   */
  async createSetupIntent(authToken?: string): Promise<StripeSetupIntent> {
    performanceService.startMeasurement('setup_intent_create', 'payment_process', {});

    try {
      await stripeSdk.initialize();

      const { clientSecret, setupIntentId } = await invokePayments<{
        clientSecret: string;
        setupIntentId: string;
      }>('payments/create-setup-intent', {
        body: { usage: 'off_session' } as Record<string, unknown>,
        ...(authToken ? { accessToken: authToken } : {}),
      });

      const setupIntent: StripeSetupIntent = {
        id: setupIntentId,
        client_secret: clientSecret,
        status: 'requires_payment_method',
      };

      await analyticsService.trackEvent('setup_intent_created', {
        setupIntentId: setupIntent.id,
      });

      await performanceService.endMeasurement('setup_intent_create', {
        success: true,
      });

      return setupIntent;
    } catch (error) {
      logger.error('[StripeService] Error creating setup intent:', { error });

      await analyticsService.trackEvent('setup_intent_failed', {
        error: String(error),
      });

      await performanceService.endMeasurement('setup_intent_create', {
        success: false,
        error: String(error),
      });

      throw handleStripeError(error);
    }
  }

  /**
   * Confirm a SetupIntent using the Payment Sheet.
   * This saves the payment method for future use.
   */
  async confirmSetupIntent(clientSecret: string): Promise<{
    success: boolean;
    paymentMethodId?: string;
    error?: StripeError;
  }> {
    try {
      await stripeSdk.initialize();

      const sdk = stripeSdk.getSDK();
      if (!sdk?.initPaymentSheet || !sdk?.presentPaymentSheet) {
        return {
          success: false,
          error: {
            type: 'api_error',
            code: 'not_supported',
            message: 'Payment setup is not available. Please use the card form.',
          },
        };
      }

      // Initialize payment sheet for setup
      const { DEEP_LINK_SCHEME } = await import('../config/app');
      const { error: initError } = await sdk.initPaymentSheet({
        setupIntentClientSecret: clientSecret,
        merchantDisplayName: 'BountyExpo',
        style: 'automatic',
        applePay: {
          merchantCountryCode: 'US',
        },
        googlePay: {
          merchantCountryCode: 'US',
          testEnv: !stripeSdk.getPublishableKey().startsWith('pk_live'),
        },
        returnURL: `${DEEP_LINK_SCHEME}://setup-complete`,
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
        if (presentError.code === 'Canceled') {
          return {
            success: false,
            error: {
              type: 'card_error',
              code: 'canceled',
              message: 'Setup was cancelled',
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

      // Extract setup intent ID from client secret to get payment method
      const setupIntentId = clientSecret.split('_secret_')[0];

      await analyticsService.trackEvent('setup_intent_confirmed', {
        setupIntentId,
      });

      return { success: true };
    } catch (error) {
      logger.error('[StripeService] Error confirming setup intent:', { error });
      return {
        success: false,
        error: handleStripeError(error) as StripeError,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Stripe Financial Connections (US ACH bank linking)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Link a US bank account using Stripe Financial Connections.
   *
   * Flow:
   *   1. Server creates a Financial Connections session bound to the user's
   *      Stripe Customer.
   *   2. Stripe's native UI is presented via collectFinancialConnectionsAccounts
   *      (no manual routing/account number entry — never PCI/NACHA in scope).
   *   3. Server attaches the resulting us_bank_account PaymentMethod to the
   *      Customer AND mirrors it onto the user's Connect account as an external
   *      account (when a Connect account exists). Persists a unified row so the
   *      same bank powers both deposits and withdrawals.
   *
   * Returns the list of newly linked banks (canonical rows from payment_methods).
   */
  async linkBankWithFinancialConnections(
    authToken: string,
    options: { setAsDefault?: boolean } = {}
  ): Promise<StripePaymentMethod[]> {
    performanceService.startMeasurement(
      'financial_connections_link',
      'payment_process',
      {}
    );

    try {
      await stripeSdk.initialize();

      if (!authToken) {
        throw new Error('Authentication required to link a bank account');
      }

      // 1. Create the FC session on the server.
      const { clientSecret, sessionId } = await invokePayments<{
        clientSecret: string;
        sessionId: string;
      }>('payments/create-financial-connections-session', {
        body: {} as Record<string, unknown>,
        accessToken: authToken,
      });

      if (!clientSecret || !sessionId) {
        throw new Error('Failed to create bank linking session');
      }

      analyticsService
        .trackEvent('ach_link_started', { sessionId })
        .catch(() => {
          /* fire-and-forget */
        });

      // 2. Present Stripe's native Financial Connections sheet.
      const sdk = stripeSdk.getSDK();
      if (!sdk?.collectFinancialConnectionsAccounts) {
        throw new Error(
          'Bank linking is not available on this platform. Please update the app and try again.'
        );
      }

      const result = await sdk.collectFinancialConnectionsAccounts(clientSecret);
      if (result?.error) {
        analyticsService
          .trackEvent('ach_link_failed', {
            sessionId,
            code: result.error.code,
            message: result.error.message,
          })
          .catch(() => {
            /* fire-and-forget */
          });
        // User cancellations come back with a "Canceled" code — surface a
        // friendly StripeError so callers can treat them as soft failures.
        throw {
          type: 'card_error',
          code: result.error.code,
          message: result.error.message ?? 'Bank linking was cancelled.',
        };
      }

      const linkedAccounts = result?.session?.accounts?.data ?? [];
      if (linkedAccounts.length === 0) {
        throw {
          type: 'api_error',
          code: 'no_accounts_linked',
          message: 'No bank account was selected. Please try again.',
        };
      }

      // 3. Have the server attach the PaymentMethod to the customer and mirror
      //    it on the Connect account.
      const { linkedBanks } = await invokePayments<{ linkedBanks: unknown[] }>(
        'payments/financial-connections-complete',
        {
          body: {
            sessionId,
            setAsDefault: options.setAsDefault === true,
          } as Record<string, unknown>,
          accessToken: authToken,
        }
      );

      const mapped = (linkedBanks ?? []).map((row: any) => {
        return {
          id: String(row.stripe_payment_method_id ?? row.id ?? ''),
          type: 'us_bank_account' as const,
          card: { brand: 'unknown', last4: '****', exp_month: 0, exp_year: 0 },
          us_bank_account: {
            bank_name: (row.bank_name as string | null) ?? null,
            last4: (row.bank_last4 as string | null) ?? null,
            account_type: (row.account_type as string | null) ?? null,
            fc_account_id: (row.fc_account_id as string | null) ?? null,
            stripe_external_account_id:
              (row.stripe_external_account_id as string | null) ?? null,
            verification_status:
              (row.verification_status as
                | 'verified'
                | 'pending_microdeposits'
                | 'failed'
                | null) ?? null,
            is_default: Boolean(row.is_default),
          },
          created: typeof row.created === 'number' ? row.created : Math.floor(Date.now() / 1000),
        } satisfies StripePaymentMethod;
      });

      analyticsService
        .trackEvent('ach_link_completed', {
          sessionId,
          count: mapped.length,
        })
        .catch(() => {
          /* fire-and-forget */
        });

      await performanceService.endMeasurement('financial_connections_link', {
        success: true,
        count: mapped.length,
      });

      return mapped;
    } catch (error) {
      logger.error('[StripeService] Error linking bank via Financial Connections:', { error });

      analyticsService
        .trackEvent('ach_link_failed', {
          error: getNetworkErrorMessage(error),
        })
        .catch(() => {
          /* fire-and-forget */
        });

      await performanceService.endMeasurement('financial_connections_link', {
        success: false,
        error: String(error),
      });

      throw handleStripeError(error);
    }
  }

  /**
   * Initiate an ACH deposit using a previously linked us_bank_account
   * PaymentMethod. The server creates and confirms the PaymentIntent in a
   * single round-trip and returns the resulting status:
   *
   *   - 'processing'        → ACH debit in flight (typical happy path).
   *   - 'requires_action'   → microdeposit verification needed; client should
   *                           call `verifyMicrodepositsForPayment` later.
   *   - 'succeeded'         → settled immediately (rare for ACH).
   *
   * Wallet credit is applied by the `payment_intent.succeeded` webhook (or via
   * the existing `/wallet/deposit` endpoint when the client wants to optimistically
   * record the deposit), so this method does not credit the wallet directly.
   */
  async createAchDeposit(
    params: {
      amount: number;
      paymentMethodId: string;
      currency?: string;
      metadata?: Record<string, string>;
    },
    authToken: string
  ): Promise<{
    paymentIntentId: string;
    clientSecret: string;
    status: string;
    requiresAction: boolean;
    nextAction: unknown | null;
  }> {
    performanceService.startMeasurement('ach_deposit', 'payment_process', {
      amount: params.amount,
    });

    try {
      await stripeSdk.initialize();

      if (!authToken) {
        throw new Error('Authentication required to start a bank deposit');
      }
      if (!params.paymentMethodId) {
        throw new Error('paymentMethodId is required');
      }
      if (!Number.isFinite(params.amount) || params.amount <= 0) {
        throw new Error('Invalid amount');
      }

      const result = await invokePayments<{
        clientSecret: string;
        paymentIntentId: string;
        status: string;
        requiresAction?: boolean;
        nextAction?: unknown | null;
      }>('payments/create-payment-intent', {
        body: {
          amountCents: Math.round(params.amount * 100),
          currency: params.currency ?? 'usd',
          paymentMethodId: params.paymentMethodId,
          paymentMethodType: 'us_bank_account',
          confirm: true,
          metadata: { purpose: 'wallet_deposit', ...(params.metadata ?? {}) },
        } as Record<string, unknown>,
        accessToken: authToken,
      });

      analyticsService
        .trackEvent('ach_deposit_started', {
          paymentIntentId: result.paymentIntentId,
          status: result.status,
          amount: params.amount,
        })
        .catch(() => {
          /* fire-and-forget */
        });

      await performanceService.endMeasurement('ach_deposit', {
        success: true,
        status: result.status,
      });

      return {
        paymentIntentId: result.paymentIntentId,
        clientSecret: result.clientSecret,
        status: result.status,
        requiresAction: Boolean(result.requiresAction),
        nextAction: result.nextAction ?? null,
      };
    } catch (error) {
      logger.error('[StripeService] Error creating ACH deposit:', { error });

      analyticsService
        .trackEvent('ach_deposit_failed', {
          error: getNetworkErrorMessage(error),
        })
        .catch(() => {
          /* fire-and-forget */
        });

      await performanceService.endMeasurement('ach_deposit', {
        success: false,
        error: String(error),
      });

      throw handleStripeError(error);
    }
  }
}

/** Exported singleton — use instead of constructing `new PaymentMethodsService()`. */
export const paymentMethodsService = new PaymentMethodsService();
