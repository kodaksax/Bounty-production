/**
 * Initiates a Connect-native payout — money already held in the user's Stripe
 * Connect account going out to their bank account or debit card.
 *
 * This never debits a local ledger and never asks the server to move platform
 * funds first; the balance is already in the connected account. See
 * docs/payments/CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md.
 *
 * Amounts are in cents throughout, matching Stripe and useConnectBalance.
 */
import { useCallback, useRef, useState } from 'react';
import { useAuthContext } from './use-auth-context';
import { config } from '../lib/config';
import { API_BASE_URL } from '../lib/config/api';

export type PayoutMethod = 'instant' | 'standard';

export type PayoutPhase = 'idle' | 'processing' | 'completed' | 'failed';

export interface PayoutResult {
  payoutId: string | null;
  payoutMethod: PayoutMethod;
  /** Stripe's own payout status: pending | in_transit | paid | failed | canceled. */
  status: string;
  amountCents: number;
  currency: string;
  /** Stripe's estimated arrival, epoch seconds. Null when Stripe did not supply one. */
  arrivalDate: number | null;
  remainingAvailableCents: number | null;
  duplicate: boolean;
  message: string;
}

export interface PayoutError {
  code: string;
  message: string;
  /** True when retrying the same request could plausibly succeed. */
  retryable: boolean;
}

export interface UseConnectPayoutResult {
  phase: PayoutPhase;
  result: PayoutResult | null;
  error: PayoutError | null;
  isProcessing: boolean;
  withdraw: (input: {
    amountCents: number;
    method: PayoutMethod;
    destinationId?: string;
  }) => Promise<PayoutResult | null>;
  reset: () => void;
}

/**
 * Failures where the request itself is the problem — retrying it unchanged
 * would fail identically, so the UI offers "fix and try again" rather than a
 * bare Retry.
 */
const NON_RETRYABLE_CODES = new Set([
  'no_connect_account',
  'connect_not_onboarded',
  'payouts_disabled',
  'no_available_funds',
  'insufficient_balance',
  'instant_unsupported',
  'no_debit_card',
  'debit_card_not_found',
  'account_suspended',
  'account_banned',
  'instant_limit_exceeded',
  'native_payouts_disabled',
]);

/**
 * Idempotency key for a single withdrawal attempt. Generated client-side and
 * held across retries of that attempt so a network timeout followed by a retry
 * cannot produce two payouts — the server replays the first result instead.
 */
function newIdempotencyKey(): string {
  const random = Math.random().toString(36).slice(2);
  return `payout_${Date.now()}_${random}`;
}

export function useConnectPayout(): UseConnectPayoutResult {
  const { session } = useAuthContext();
  const [phase, setPhase] = useState<PayoutPhase>('idle');
  const [result, setResult] = useState<PayoutResult | null>(null);
  const [error, setError] = useState<PayoutError | null>(null);

  // Held per attempt, not per request, so a retry of the same withdrawal
  // reuses the key and the server can recognise it as a replay.
  const idempotencyKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const reset = useCallback(() => {
    idempotencyKeyRef.current = null;
    setPhase('idle');
    setResult(null);
    setError(null);
  }, []);

  const withdraw = useCallback(
    async (input: { amountCents: number; method: PayoutMethod; destinationId?: string }) => {
      const token = session?.access_token;
      if (!token) {
        setError({ code: 'not_authenticated', message: 'Please sign in again.', retryable: false });
        setPhase('failed');
        return null;
      }

      // Double-submit guard: a second tap while the first is in flight must
      // never start a second payout.
      if (inFlightRef.current) return null;
      inFlightRef.current = true;

      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = newIdempotencyKey();
      }

      setPhase('processing');
      setError(null);

      const endpoint = input.method === 'instant' ? '/connect/instant-payout' : '/connect/payout';

      try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
          },
          body: JSON.stringify({
            // The server derives the Connect account from the JWT. Deliberately
            // no account id here — the client cannot name one.
            amount: input.amountCents / 100,
            idempotencyKey: idempotencyKeyRef.current,
            ...(input.destinationId ? { destinationId: input.destinationId } : {}),
          }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const code = typeof data?.code === 'string' ? data.code : 'payout_failed';
          const payoutError: PayoutError = {
            code,
            message:
              typeof data?.error === 'string'
                ? data.error
                : 'We could not complete your withdrawal. Please try again.',
            retryable: !NON_RETRYABLE_CODES.has(code),
          };
          // A non-retryable failure means this attempt is closed; drop the key
          // so a corrected attempt is treated as genuinely new.
          if (!payoutError.retryable) idempotencyKeyRef.current = null;
          setError(payoutError);
          setPhase('failed');
          return null;
        }

        const payoutResult: PayoutResult = {
          payoutId: typeof data.payoutId === 'string' ? data.payoutId : null,
          payoutMethod: data.payoutMethod === 'instant' ? 'instant' : 'standard',
          status: typeof data.status === 'string' ? data.status : 'pending',
          amountCents:
            typeof data.amount === 'number' ? Math.round(data.amount * 100) : input.amountCents,
          currency: typeof data.currency === 'string' ? data.currency : 'usd',
          arrivalDate: typeof data.arrivalDate === 'number' ? data.arrivalDate : null,
          remainingAvailableCents:
            typeof data.remainingAvailableCents === 'number' ? data.remainingAvailableCents : null,
          duplicate: data.duplicate === true,
          message: typeof data.message === 'string' ? data.message : 'Withdrawal sent.',
        };

        idempotencyKeyRef.current = null;
        setResult(payoutResult);
        setPhase('completed');
        return payoutResult;
      } catch (networkError) {
        console.error('[use-connect-payout] withdrawal request failed:', networkError);
        // The request may or may not have reached Stripe. The idempotency key
        // is deliberately RETAINED so a retry replays rather than double-pays.
        setError({
          code: 'network_error',
          message:
            'We could not reach the server. If your withdrawal already went through, retrying is safe — it will not send twice.',
          retryable: true,
        });
        setPhase('failed');
        return null;
      } finally {
        inFlightRef.current = false;
      }
    },
    [session?.access_token]
  );

  return {
    phase,
    result,
    error,
    isProcessing: phase === 'processing',
    withdraw,
    reset,
  };
}
