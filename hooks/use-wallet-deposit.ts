import { useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { config } from '../lib/config';
import { API_BASE_URL } from '../lib/config/api';
import { analyticsService } from '../lib/services/analytics-service';
import { applePayService } from '../lib/services/apple-pay-service';
import { stripeService } from '../lib/services/stripe-service';
import { useStripe } from '../lib/stripe-context';
import { logger } from '../lib/utils/error-logger';
import { describePaymentFailure } from '../lib/utils/payment-failure-message';
import { failureEventProps, type FailureEventProps } from '../lib/utils/stripe-error';
import { useWallet } from '../lib/wallet-context';
import { useAuthContext } from './use-auth-context';

export interface DepositSuccessInfo {
  amount: number;
  persisted: boolean;
  via: 'card' | 'applePay' | 'paymentSheet';
}

/**
 * How a `payWithCard` / `payWithApplePay` attempt ended. Callers that need to
 * react to the outcome (e.g. the pay-at-accept gate) should use this return
 * value rather than inferring it from `isProcessing` transitioning — that
 * inference misses any exit that never sets `isProcessing` at all, such as a
 * validation failure or a preflight availability check.
 */
export type DepositOutcome = 'succeeded' | 'cancelled' | 'failed';

export interface DepositResult {
  outcome: DepositOutcome;
  /**
   * Why it failed, in the same shape as payment_failed (real Stripe
   * decline_code / code / type / payment_method_type). Set when outcome is
   * 'failed'.
   */
  failure?: FailureEventProps;
}

const failed = (code: string): DepositResult => ({
  outcome: 'failed',
  failure: failureEventProps(undefined, code),
});

/**
 * Shared wallet-deposit business logic behind both the general "Add Cash"
 * keypad screen (components/add-money-screen.tsx) and the fixed-amount
 * onboarding funding confirmation (components/onboarding/PosterFundingScreen.tsx).
 * Keeping this in one place means the Stripe/Apple Pay/retry/persistence
 * behavior can't drift between the two UIs.
 *
 * Retries up to 3 times with exponential back-off so transient network blips
 * don't silently drop the server-side balance update.
 */
async function persistDeposit(
  paymentIntentId: string | undefined,
  amount: number,
  accessToken?: string,
  source?: string
): Promise<boolean> {
  if (!paymentIntentId || !accessToken) return false;
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${API_BASE_URL}/wallet/deposit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
        },
        body: JSON.stringify({ amount, paymentIntentId }),
      });

      if (res.ok) {
        return true;
      }

      const requestId = res.headers.get('x-request-id') || undefined;
      let bodyText = '';
      let responseCode: string | undefined;
      let responseRetryable: boolean | undefined;
      try {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (typeof data?.code === 'string') responseCode = data.code;
          if (typeof data?.retryable === 'boolean') responseRetryable = data.retryable;
          bodyText = JSON.stringify(data);
        } else {
          bodyText = await res.text();
        }
      } catch {
        bodyText = '<unable to read response body>';
      }
      logger.warning(`Wallet deposit persistence attempt failed`, {
        operation: 'wallet_deposit_persist',
        source,
        attempt,
        maxAttempts: MAX_RETRIES,
        status: res.status,
        statusText: res.statusText,
        requestId,
        code: responseCode,
        retryable: responseRetryable,
        response: bodyText.slice(0, 500),
      });

      // Don't retry on 4xx client errors (except 408/429) — they won't succeed
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return false;
      }
    } catch (e) {
      logger.warning(`Wallet deposit persistence request failed`, {
        operation: 'wallet_deposit_persist',
        source,
        attempt,
        maxAttempts: MAX_RETRIES,
        error: e,
      });
    }
    // Exponential back-off: 1s, 2s, 4s
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }
  return false;
}

export function useWalletDeposit() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isApplePayAvailable, setIsApplePayAvailable] = useState(false);
  const [isGooglePayAvailable, setIsGooglePayAvailable] = useState(false);
  const [showPaymentMethodsModal, setShowPaymentMethodsModal] = useState(false);
  const [error, setError] = useState<any>(null);
  const [successInfo, setSuccessInfo] = useState<DepositSuccessInfo | null>(null);
  const { deposit, refreshFromApi } = useWallet();
  const {
    processPaymentSecure,
    paymentMethods,
    isLoading: stripeLoading,
    error: stripeError,
    loadPaymentMethods,
  } = useStripe();
  const { session } = useAuthContext();
  const cardPaymentMethods = paymentMethods.filter(method => method.type === 'card');
  const primaryCardPaymentMethod = cardPaymentMethods[0] ?? null;

  // Check Apple Pay / Google Pay availability on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const available = await applePayService.isAvailable();
        if (mounted) setIsApplePayAvailable(available);
      } catch {
        // ignore
      }
    })();
    stripeService
      .isGooglePayAvailable()
      .then(available => {
        if (mounted) setIsGooglePayAvailable(available);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const walletName = isApplePayAvailable
    ? ('Apple Pay' as const)
    : isGooglePayAvailable
      ? ('Google Pay' as const)
      : null;

  /** One place that turns a failure into the banner the deposit screens show. */
  const showFailure = (failure: FailureEventProps | undefined) => {
    const { title, message } = describePaymentFailure(failure, { walletName });
    setError({ message: `${title} ${message}`, type: 'payment', failure });
  };

  /** Credits the wallet after Stripe captured the charge; shared by every method. */
  const settleDeposit = async (
    numAmount: number,
    paymentIntentId: string | undefined,
    via: DepositSuccessInfo['via']
  ) => {
    const viaApplePay = via === 'applePay';
    // Optimistically update local wallet balance
    await deposit(numAmount, {
      method: viaApplePay ? 'Apple Pay' : 'Credit Card',
      title: viaApplePay ? 'Added Money via Apple Pay' : 'Added Money via Stripe',
      status: 'completed',
    });

    // Persist the deposit to the DB immediately (don't wait for the webhook).
    // apply_deposit is idempotent on paymentIntentId, so a later webhook
    // delivery is a safe no-op. This ensures profiles.balance is durable
    // and survives sign-out / cold restart.
    const persisted = await persistDeposit(
      paymentIntentId,
      numAmount,
      session?.access_token,
      viaApplePay ? 'Apple Pay' : via === 'paymentSheet' ? 'Payment Sheet' : 'Stripe'
    );

    // Sync balance from server so Supabase is the source of truth
    try {
      if (session?.access_token) {
        await refreshFromApi(session.access_token);
      }
    } catch (syncErr) {
      console.warn('[WalletDeposit] Failed to sync balance from server after deposit:', syncErr);
    }

    setSuccessInfo({ amount: numAmount, persisted, via });
  };

  const payWithCard = async (numAmount: number): Promise<DepositResult> => {
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than $0.', [
        { text: 'OK' },
      ]);
      return failed('invalid_amount');
    }

    if (!primaryCardPaymentMethod) {
      if (paymentMethods.length > 0) {
        Alert.alert(
          'Card Required',
Platform.OS === 'ios'
            ? 'Add Money currently charges a saved card. Please add a card or use Apple Pay.'
            : 'Add Money currently charges a saved card. Please add a card.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Add Card', onPress: () => setShowPaymentMethodsModal(true) },
          ]
        );
        return failed('no_card');
      }
      Alert.alert(
        'No Payment Method',
        'You need to add a payment method before you can add money to your wallet. Choose from cards or bank accounts.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Payment Method', onPress: () => setShowPaymentMethodsModal(true) },
        ]
      );
      return failed('no_payment_method');
    }

    setIsProcessing(true);
    setError(null);

    try {
      if (!session?.access_token) {
        throw new Error('Not authenticated. Please sign in again.');
      }

      // processPaymentSecure handles idempotent payment intent creation and confirmation
      const result = await processPaymentSecure(numAmount, {
        userId: session?.user?.id,
        purpose: 'wallet_deposit',
        paymentMethodId: primaryCardPaymentMethod.id,
      });

      if (result.success) {
        await settleDeposit(numAmount, result.paymentIntentId, 'card');
        return { outcome: 'succeeded' };
      }
      showFailure(result.failure);
      return { outcome: 'failed', failure: result.failure };
    } catch (err: any) {
      console.error('Payment error:', err);
      setError(err);
      return { outcome: 'failed', failure: failureEventProps(err, 'unknown', 'card') };
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Stripe Payment Sheet: Apple Pay / Google Pay, the payer's saved cards and
   * new card entry in one native sheet. A decline inside the sheet lets the
   * payer pick another method without leaving it.
   */
  const payWithPaymentSheet = async (numAmount: number): Promise<DepositResult> => {
    if (isNaN(numAmount) || numAmount < 0.5) {
      Alert.alert('Minimum Amount', 'Amount must be at least $0.50');
      return failed('invalid_amount');
    }

    setIsProcessing(true);
    setError(null);

    try {
      if (!session?.access_token) {
        throw new Error('Not authenticated. Please sign in again.');
      }
      const result = await stripeService.payWithPaymentSheet(numAmount, {
        authToken: session.access_token,
        userId: session.user?.id,
        purpose: 'wallet_deposit',
      });
      if (result.outcome === 'succeeded') {
        await settleDeposit(numAmount, result.paymentIntentId, 'paymentSheet');
        // A card saved inside the sheet becomes the one-tap card next time.
        loadPaymentMethods().catch(() => {});
        return { outcome: 'succeeded' };
      }
      if (result.outcome === 'cancelled') return { outcome: 'cancelled' };
      showFailure(result.failure);
      return { outcome: 'failed', failure: result.failure };
    } catch (err: any) {
      console.error('Payment sheet error:', err);
      setError(err);
      return { outcome: 'failed', failure: failureEventProps(err, 'unknown', 'payment_sheet') };
    } finally {
      setIsProcessing(false);
    }
  };

  const payWithApplePay = async (numAmount: number): Promise<DepositResult> => {
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount');
      return failed('invalid_amount');
    }

    if (numAmount < 0.5) {
      Alert.alert('Minimum Amount', 'Amount must be at least $0.50');
      return failed('invalid_amount');
    }

    // Locked before the availability re-check below (which is async) so a
    // caller gating a "cancel"/"not now" affordance on `isProcessing` can't
    // race a still-pending check with a user cancel — the whole attempt, not
    // just the eventual charge, is "busy". The try/finally guarantees this
    // clears again on every exit, including the preflight ones that return
    // before ever reaching Apple Pay.
    setIsProcessing(true);
    setError(null);

    try {
      // Apple Pay may not be set up on this device (no card provisioned in
      // the Wallet app). Re-check availability on tap so the button stays
      // discoverable — this is also what App Review needs to locate the
      // integration — and guide the user to set it up instead of silently
      // failing.
      let available = isApplePayAvailable;
      if (!available) {
        available = await applePayService.isAvailable();
        setIsApplePayAvailable(available);
      }
      if (!available) {
        // This dead-ends before any backend call, so without an explicit
        // event it's invisible in analytics — it can look identical to a
        // genuine "no card in Wallet" case even when it's actually a
        // config/entitlement problem (see
        // docs/payments/APPLE_PAY_PRODUCTION_FAILURE_REPORT.md).
        try {
          await analyticsService.trackEvent('apple_pay_unavailable', {
            platform: Platform.OS,
            screen: 'wallet_deposit',
          });
        } catch {
          /* analytics is best-effort */
        }
        Alert.alert(
          'Apple Pay Not Set Up',
          'Apple Pay isn’t set up on this device. Open the Wallet app and add a card to pay with Apple Pay, or use a linked card or bank account below.',
          [{ text: 'OK' }]
        );
        return failed('apple_pay_unavailable');
      }

      const result = await applePayService.processPayment(
        {
          amount: numAmount,
          description: 'Add Money to Wallet',
        },
        session?.access_token
      );

      if (result.success) {
        await settleDeposit(numAmount, result.paymentIntentId, 'applePay');
        return { outcome: 'succeeded' };
      } else if (result.errorCode === 'cancelled') {
        // user cancelled - no alert
        return { outcome: 'cancelled' };
      }
      const failure = result.failure ?? failureEventProps(result.error, 'unknown', 'apple_pay');
      showFailure(failure);
      return { outcome: 'failed', failure };
    } catch (err) {
      console.error('Apple Pay error:', err);
      setError(err);
      return { outcome: 'failed', failure: failureEventProps(err, 'unknown', 'apple_pay') };
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    isProcessing,
    isApplePayAvailable,
    isGooglePayAvailable,
    /** The wallet to offer as the alternative in failure copy, if any. */
    walletName,
    error,
    setError,
    successInfo,
    setSuccessInfo,
    showPaymentMethodsModal,
    setShowPaymentMethodsModal,
    paymentMethods,
    cardPaymentMethods,
    primaryCardPaymentMethod,
    stripeLoading,
    stripeError,
    loadPaymentMethods,
    payWithCard,
    payWithApplePay,
    payWithPaymentSheet,
  };
}

export function buildDepositSuccessMessage({ amount, persisted, via }: DepositSuccessInfo): string {
  const suffix = via === 'applePay' ? ' via Apple Pay' : '';
  const base = `$${amount.toFixed(2)} has been added to your wallet${suffix}.`;
  return persisted
    ? base
    : `${base}\n\nNote: There was a temporary issue syncing with the server. Your balance will update automatically shortly.`;
}
