/**
 * Singleton manager for the Stripe native SDK.
 *
 * Holds the publishable key, initialized SDK module, and init state.
 * Extracted from the original `stripe-service.ts` so that focused
 * sub-services (`escrow-service`, `payment-methods-service`,
 * `connect-service`) can lazily initialize / access the SDK
 * without duplicating init logic.
 */
import { logger } from '../utils/error-logger';
import { merchantId as APPLE_PAY_MERCHANT_ID } from '../config/apple-pay.json';

class StripeSdkManager {
  private publishableKey: string = '';
  private initPromise: Promise<void> | null = null;
  private stripeSDK: any = null;
  private applePayMerchantId: string = APPLE_PAY_MERCHANT_ID;
  private applePayInitError: string | null = null;

  constructor() {
    // Read from Expo public env (must be prefixed EXPO_PUBLIC_ to reach client bundle)
    const key = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      logger.error(
        '[StripeSdk] Missing EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY env variable. Payments disabled.'
      );
      this.publishableKey = '';
    } else {
      this.publishableKey = key;
    }
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      // Initialize the Stripe React Native SDK if available
      // NOTE: The merchantIdentifier must be registered in Apple Developer portal for Apple Pay to work.
      // See STRIPE_INTEGRATION_BACKEND.md for setup instructions.
      try {
        const rawModule: any = await import('@stripe/stripe-react-native');
        // Handle both ESM (named export) and CJS/default-wrapped shapes
        const stripeModule = rawModule?.default ?? rawModule;
        const initStripe = stripeModule?.initStripe ?? rawModule?.initStripe;
        if (initStripe && this.publishableKey) {
          // merchantIdentifier must exactly match the com.apple.developer.in-app-payments
          // entitlement baked into this build (see lib/config/apple-pay.json — the single
          // source of truth app.config.js uses to generate that entitlement). A mismatch
          // here makes Apple Pay fail silently at the native layer, before any network
          // call, with no JS-visible error — see docs/payments/APPLE_PAY_PRODUCTION_FAILURE_REPORT.md.
          const envMerchantId = process.env.EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID;
          const merchantId = envMerchantId || this.applePayMerchantId;
          if (envMerchantId && envMerchantId !== this.applePayMerchantId) {
            // app.config.js already fails production builds on this drift; this is a
            // defense-in-depth log in case a build shipped before that guard existed.
            logger.error(
              '[StripeSdk] EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID does not match the entitled ' +
                'Apple Pay merchant ID — Apple Pay will fail silently.',
              { envMerchantId, entitledMerchantId: this.applePayMerchantId }
            );
          }
          this.applePayMerchantId = merchantId;
          // Use centralized deep link scheme constant
          const { DEEP_LINK_SCHEME } = await import('../config/app');
          await initStripe({
            publishableKey: this.publishableKey,
            merchantIdentifier: merchantId,
            urlScheme: DEEP_LINK_SCHEME,
          });
          this.stripeSDK = stripeModule;
        }
      } catch (sdkError) {
        this.applePayInitError = sdkError instanceof Error ? sdkError.message : String(sdkError);
        // SDK initialization may fail in non-native environments (e.g., web, Node)
        if (__DEV__) {
          logger.error(
            '[StripeSdk] Unable to initialize SDK (expected in non-native environments):',
            { error: sdkError }
          );
        }
      }
    } catch (error) {
      logger.error('[StripeSdk] Failed to initialize:', { error });
      throw new Error('Failed to initialize payment service');
    }
  }

  /** Native Stripe SDK reference, or null when unavailable. */
  getSDK(): any {
    return this.stripeSDK;
  }

  isSDKAvailable(): boolean {
    return !!this.stripeSDK;
  }

  getPublishableKey(): string {
    return this.publishableKey;
  }

  /** Merchant ID actually passed to initStripe() — for diagnostics/telemetry only, never logged with secrets. */
  getApplePayMerchantId(): string {
    return this.applePayMerchantId;
  }

  /** Set when the native SDK import/initStripe() call itself threw. Null on a clean init (does not imply Apple Pay is usable). */
  getApplePayInitError(): string | null {
    return this.applePayInitError;
  }

  /**
   * Detect the mode of a Stripe key (test or live)
   * @param key Stripe publishable key (pk_test_... or pk_live_...) or secret key (sk_test_... or sk_live_...)
   * @returns 'test' | 'live' | 'unknown'
   */
  getKeyMode(key: string): 'test' | 'live' | 'unknown' {
    if (!key) return 'unknown';
    if (key.startsWith('pk_test_') || key.startsWith('sk_test_')) return 'test';
    if (key.startsWith('pk_live_') || key.startsWith('sk_live_')) return 'live';
    return 'unknown';
  }

  /** Get the mode of the configured publishable key. */
  getPublishableKeyMode(): 'test' | 'live' | 'unknown' {
    return this.getKeyMode(this.publishableKey);
  }
}

/** Shared singleton — must only be instantiated once per process. */
export const stripeSdk = new StripeSdkManager();
