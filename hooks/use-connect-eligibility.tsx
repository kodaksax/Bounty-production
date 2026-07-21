/**
 * Stripe Connect onboarding/payout eligibility, shared across every
 * withdrawal-adjacent screen (withdraw-with-bank-screen, instant-cash-out-screen,
 * withdraw-method-select). Previously each screen called
 * POST /connect/verify-onboarding independently with near-identical
 * boilerplate; this is the single source of truth.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuthContext } from './use-auth-context';
import { config } from '../lib/config';
import { API_BASE_URL } from '../lib/config/api';

export interface ConnectEligibilityState {
  loading: boolean;
  /** True once a Stripe Connect account exists at all. */
  connectedAccountExists: boolean;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** Equivalent to the withdraw screen's historical `hasConnectedAccount` — onboarded AND payouts are currently enabled. */
  isFullyOnboarded: boolean;
  error: string | null;
}

export interface UseConnectEligibilityResult extends ConnectEligibilityState {
  refresh: () => Promise<void>;
}

const INITIAL_STATE: ConnectEligibilityState = {
  loading: true,
  connectedAccountExists: false,
  detailsSubmitted: false,
  chargesEnabled: false,
  payoutsEnabled: false,
  isFullyOnboarded: false,
  error: null,
};

export function useConnectEligibility(): UseConnectEligibilityResult {
  const { session } = useAuthContext();
  const [state, setState] = useState<ConnectEligibilityState>(INITIAL_STATE);

  const refresh = useCallback(async () => {
    if (!session?.access_token) return;
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch(`${API_BASE_URL}/connect/verify-onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
        },
      });

      if (!response.ok) {
        setState(prev => ({ ...prev, loading: false, error: 'Could not check your payout account status.' }));
        return;
      }

      const data = await response.json();
      setState({
        loading: false,
        connectedAccountExists: !!data.accountId,
        detailsSubmitted: !!data.detailsSubmitted,
        chargesEnabled: !!data.chargesEnabled,
        payoutsEnabled: !!data.payoutsEnabled,
        isFullyOnboarded: !!data.onboarded && !!data.payoutsEnabled,
        error: null,
      });
    } catch (error) {
      console.error('[use-connect-eligibility] Failed to load Connect status:', error);
      setState(prev => ({ ...prev, loading: false, error: 'Could not reach the server. Please try again.' }));
    }
  }, [session?.access_token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
