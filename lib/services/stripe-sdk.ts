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

class StripeSdkManager {
  private publishableKey: string = '';
  private initPromise: Promise<void> | null = null;
  private stripeSDK: any = null;

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
          // merchantIdentifier should match your Apple Pay Merchant ID from Apple Developer portal
          const merchantId =
            process.env.EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID || 'com.bounty0.BOUNTYExpo';
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
