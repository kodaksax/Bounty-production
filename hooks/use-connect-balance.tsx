/**
 * The user's live Stripe Connect account balance — the authoritative source of
 * withdrawable funds under the Phase 2 payment architecture.
 *
 * This hook deliberately never reads profiles.balance (the legacy v1 custodial
 * ledger) and never blends the two figures. Under v2, bounty releases Transfer
 * money directly into the hunter's connected account and never touch
 * profiles.balance, so the ledger figure is not a valid fallback — showing it
 * would mean showing a number the user cannot actually withdraw.
 * See docs/payments/CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md.
 *
 * All amounts are in the smallest currency unit (cents for USD), matching
 * Stripe's own representation. Format for display with formatCurrencyCents().
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthContext } from './use-auth-context';
import { config } from '../lib/config';
import { API_BASE_URL } from '../lib/config/api';

/**
 * Minimum gap between network refreshes. The wallet refreshes on screen focus,
 * pull-to-refresh, app foreground, and after every payout — without this, a
 * user tabbing back and forth would issue a Stripe API call per focus event.
 * An explicit pull-to-refresh bypasses this via refresh({ force: true }).
 */
const MIN_REFRESH_INTERVAL_MS = 10_000;

export interface ConnectBalanceState {
  /** Settled funds, withdrawable via a standard payout. Cents. */
  available: number;
  /** Funds still clearing, not yet withdrawable by standard payout. Cents. */
  pending: number;
  /**
   * Funds eligible for an instant payout, NET of the instant payout fee.
   * Sourced from Stripe's instant_available[].net_available — never .amount,
   * which is the gross figure the user cannot actually receive.
   */
  instantAvailable: number;
  currency: string;
  /** When this snapshot was taken server-side, ISO 8601. Null before first load. */
  lastUpdated: string | null;
  /** False when the user has not onboarded to Connect yet — render an onboarding CTA, not $0. */
  hasConnectAccount: boolean;
  payoutsEnabled: boolean;
  /** True only during the very first load, when there is nothing to show yet. */
  isLoading: boolean;
  /** True while re-fetching with a previous value still on screen. */
  isRefreshing: boolean;
  error: string | null;
}

export interface UseConnectBalanceResult extends ConnectBalanceState {
  refresh: (options?: { force?: boolean }) => Promise<void>;
}

const INITIAL_STATE: ConnectBalanceState = {
  available: 0,
  pending: 0,
  instantAvailable: 0,
  currency: 'usd',
  lastUpdated: null,
  hasConnectAccount: false,
  payoutsEnabled: false,
  isLoading: true,
  isRefreshing: false,
  error: null,
};

const toCents = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;

export interface UseConnectBalanceOptions {
  /**
   * When false the hook holds still and issues no requests. Used to avoid
   * spending a Stripe API call per wallet render while the balance source is
   * still flagged to the legacy ledger. Defaults to true.
   */
  enabled?: boolean;
}

export function useConnectBalance(
  options: UseConnectBalanceOptions = {}
): UseConnectBalanceResult {
  const enabled = options.enabled !== false;
  const { session } = useAuthContext();
  const accessToken = session?.access_token;
  const [state, setState] = useState<ConnectBalanceState>(INITIAL_STATE);

  // Tracks whether a live value has ever landed, so we can distinguish the
  // first load (show a skeleton) from a refresh (keep showing the old value).
  const hasLoadedRef = useRef(false);
  const lastFetchAtRef = useRef(0);
  // Dedupes concurrent callers (focus + foreground can fire together) onto a
  // single in-flight request rather than two Stripe round trips.
  const inFlightRef = useRef<Promise<void> | null>(null);
  // Guards against setState after unmount during a slow Stripe call.
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
      const sinceLast = Date.now() - lastFetchAtRef.current;
      if (!force && hasLoadedRef.current && sinceLast < MIN_REFRESH_INTERVAL_MS) {
        return;
      }

      const request = (async () => {
        setState(prev => ({
          ...prev,
          isLoading: !hasLoadedRef.current,
          isRefreshing: hasLoadedRef.current,
          error: null,
        }));

        try {
          const response = await fetch(`${API_BASE_URL}/connect/balance`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
            },
          });

          if (!response.ok) {
            if (!mountedRef.current) return;
            // Keep whatever figure is already on screen; surface the failure so
            // the UI can offer Retry. Never silently fall back to a stale or
            // ledger-derived number presented as if it were live.
            setState(prev => ({
              ...prev,
              isLoading: false,
              isRefreshing: false,
              error: 'Could not load your balance from Stripe.',
            }));
            return;
          }

          const data = await response.json();
          if (!mountedRef.current) return;

          hasLoadedRef.current = true;
          lastFetchAtRef.current = Date.now();

          setState({
            available: toCents(data.available),
            pending: toCents(data.pending),
            instantAvailable: toCents(data.instantAvailable),
            currency: typeof data.currency === 'string' ? data.currency : 'usd',
            lastUpdated:
              typeof data.lastUpdated === 'string' ? data.lastUpdated : new Date().toISOString(),
            hasConnectAccount: data.hasConnectAccount === true,
            payoutsEnabled: data.payoutsEnabled === true,
            isLoading: false,
            isRefreshing: false,
            error: null,
          });
        } catch (error) {
          console.error('[use-connect-balance] Failed to load Stripe balance:', error);
          if (!mountedRef.current) return;
          setState(prev => ({
            ...prev,
            isLoading: false,
            isRefreshing: false,
            error: 'Could not reach Stripe. Pull to refresh to try again.',
          }));
        }
      })();

      inFlightRef.current = request;
      try {
        await request;
      } finally {
        inFlightRef.current = null;
      }
    },
    [accessToken, enabled]
  );

  // Reset when the signed-in user changes so one account's balance can never
  // be shown to the next.
  useEffect(() => {
    hasLoadedRef.current = false;
    lastFetchAtRef.current = 0;
    setState(accessToken && enabled ? INITIAL_STATE : { ...INITIAL_STATE, isLoading: false });
    if (accessToken && enabled) {
      refresh({ force: true });
    }
  }, [accessToken, enabled, refresh]);

  return { ...state, refresh };
}
