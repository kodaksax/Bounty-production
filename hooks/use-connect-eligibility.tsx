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
  /** Stripe's own requirement codes currently blocking payouts (e.g. "individual.verification.document"), from account.requirements.currently_due. Empty when nothing is outstanding. */
  requirementsCurrentlyDue: string[];
  /** Requirement codes Stripe has received but is still reviewing, from account.requirements.pending_verification. */
  requirementsPendingVerification: string[];
  /** Stripe's own machine-readable reason payouts/charges are disabled (account.requirements.disabled_reason), e.g. "requirements.past_due" — null when not disabled. Surface this directly in the UI instead of a generic "locked" message. */
  disabledReason: string | null;
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
  requirementsCurrentlyDue: [],
  requirementsPendingVerification: [],
  disabledReason: null,
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
      console.log('[use-connect-eligibility] refreshed', {
        connectedAccountExists: !!data.accountId,
        payoutsEnabled: !!data.payoutsEnabled,
        chargesEnabled: !!data.chargesEnabled,
        requirementsCurrentlyDue: data.requirementsCurrentlyDue ?? [],
        disabledReason: data.disabledReason ?? null,
      });
      setState({
        loading: false,
        connectedAccountExists: !!data.accountId,
        detailsSubmitted: !!data.detailsSubmitted,
        chargesEnabled: !!data.chargesEnabled,
        payoutsEnabled: !!data.payoutsEnabled,
        isFullyOnboarded: !!data.onboarded && !!data.payoutsEnabled,
        requirementsCurrentlyDue: Array.isArray(data.requirementsCurrentlyDue) ? data.requirementsCurrentlyDue : [],
        requirementsPendingVerification: Array.isArray(data.requirementsPendingVerification)
          ? data.requirementsPendingVerification
          : [],
        disabledReason: typeof data.disabledReason === 'string' ? data.disabledReason : null,
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
