/**
 * Withdrawal history sourced from Stripe (Phase 6).
 *
 * The list comes from the connected account's actual payouts, not from
 * wallet_transactions, so what the user sees is what Stripe did. Local rows
 * are matched in server-side to attach our own context and to expose
 * reconciliation drift rather than paper over it.
 *
 * Amounts are in cents; timestamps are epoch seconds, as Stripe reports them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthContext } from './use-auth-context';
import { config } from '../lib/config';
import { API_BASE_URL } from '../lib/config/api';

/** Stripe's payout lifecycle, verbatim. */
export type StripePayoutStatus =
  | 'pending'
  | 'in_transit'
  | 'paid'
  | 'failed'
  | 'canceled';

export interface PayoutHistoryEntry {
  payoutId: string;
  /** Stripe's status — authoritative. */
  status: StripePayoutStatus | string;
  amountCents: number;
  currency: string;
  method: 'instant' | 'standard' | string;
  /** Epoch seconds, or null when Stripe has not estimated one. */
  arrivalDate: number | null;
  createdAt: number;
  failureCode: string | null;
  failureMessage: string | null;
  destinationId: string | null;
  /** Status recorded in our own ledger, for comparison. Null when unmatched. */
  ledgerStatus: string | null;
  transactionId: string | null;
  bountyId: string | null;
  description: string | null;
  /** False when Stripe has a payout we have no local record of. */
  reconciled: boolean;
  /** False when our ledger status disagrees with Stripe's. Null when unmatched. */
  statusMatchesLedger: boolean | null;
}

/** A local withdrawal row whose payout Stripe did not return. */
export interface UnreconciledEntry {
  transactionId: string;
  payoutId: string;
  ledgerStatus: string;
  createdAt: string;
}

export interface UsePayoutHistoryResult {
  payouts: PayoutHistoryEntry[];
  unreconciled: UnreconciledEntry[];
  hasConnectAccount: boolean;
  /** True when Stripe and our ledger disagree anywhere in this page. */
  hasDrift: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: (options?: { force?: boolean }) => Promise<void>;
}

const MIN_REFRESH_INTERVAL_MS = 10_000;

export function usePayoutHistory(options: { enabled?: boolean; limit?: number } = {}): UsePayoutHistoryResult {
  const enabled = options.enabled !== false;
  const limit = options.limit ?? 25;
  const { session } = useAuthContext();
  const accessToken = session?.access_token;

  const [payouts, setPayouts] = useState<PayoutHistoryEntry[]>([]);
  const [unreconciled, setUnreconciled] = useState<UnreconciledEntry[]>([]);
  const [hasConnectAccount, setHasConnectAccount] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);
  const lastFetchAtRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (refreshOptions?: { force?: boolean }) => {
      if (!accessToken || !enabled) return;
      if (inFlightRef.current) return inFlightRef.current;

      const force = refreshOptions?.force === true;
      if (!force && hasLoadedRef.current && Date.now() - lastFetchAtRef.current < MIN_REFRESH_INTERVAL_MS) {
        return;
      }

      const request = (async () => {
        if (hasLoadedRef.current) setIsRefreshing(true);
        else setIsLoading(true);
        setError(null);

        try {
          const response = await fetch(`${API_BASE_URL}/connect/payouts?limit=${limit}`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
            },
          });

          if (!mountedRef.current) return;

          if (!response.ok) {
            setError('Could not load your withdrawal history from Stripe.');
            return;
          }

          const data = await response.json();
          if (!mountedRef.current) return;

          hasLoadedRef.current = true;
          lastFetchAtRef.current = Date.now();
          setPayouts(Array.isArray(data.payouts) ? data.payouts : []);
          setUnreconciled(Array.isArray(data.unreconciled) ? data.unreconciled : []);
          setHasConnectAccount(data.hasConnectAccount === true);
        } catch (fetchError) {
          console.error('[use-payout-history] failed to load payout history:', fetchError);
          if (!mountedRef.current) return;
          setError('Could not reach Stripe. Pull to refresh to try again.');
        } finally {
          if (mountedRef.current) {
            setIsLoading(false);
            setIsRefreshing(false);
          }
        }
      })();

      inFlightRef.current = request;
      try {
        await request;
      } finally {
        inFlightRef.current = null;
      }
    },
    [accessToken, enabled, limit]
  );

  useEffect(() => {
    hasLoadedRef.current = false;
    lastFetchAtRef.current = 0;
    setPayouts([]);
    setUnreconciled([]);
    if (accessToken && enabled) {
      refresh({ force: true });
    } else {
      setIsLoading(false);
    }
  }, [accessToken, enabled, refresh]);

  const hasDrift =
    unreconciled.length > 0 ||
    payouts.some(p => p.reconciled === false || p.statusMatchesLedger === false);

  return {
    payouts,
    unreconciled,
    hasConnectAccount,
    hasDrift,
    isLoading,
    isRefreshing,
    error,
    refresh,
  };
}

/** User-facing label for a Stripe payout status. */
export function payoutStatusLabel(status: string, method?: string): string {
  switch (status) {
    case 'pending':
      return 'Payout initiated';
    case 'in_transit':
      return method === 'instant' ? 'Sending' : 'On its way';
    case 'paid':
      return 'Payout paid';
    case 'failed':
      return 'Payout failed';
    case 'canceled':
      return 'Payout canceled';
    default:
      return status;
  }
}
