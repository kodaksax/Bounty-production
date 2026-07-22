/**
 * Bank accounts + debit cards on the user's Stripe Connect account, shared
 * across withdraw-with-bank-screen, instant-cash-out-screen,
 * withdraw-method-select, and payout-methods-screen. Previously each screen
 * fetched GET /connect/bank-accounts and GET /connect/debit-cards
 * independently with near-identical boilerplate; this is the single source
 * of truth, including `openPayoutDashboard`.
 *
 * Adding, removing, and setting a default external account can no longer be
 * done via API calls (POST/DELETE /connect/bank-accounts and /debit-cards) —
 * these Connect accounts have `controller.requirement_collection: "stripe"`,
 * which means Stripe itself owns writes to external accounts and rejects
 * stripe.accounts.createExternalAccount/updateExternalAccount/
 * deleteExternalAccount with a permissions error, unconditionally. Those
 * endpoints are now deprecated (410) server-side. The only supported way to
 * manage payout methods is Stripe's own hosted Express Dashboard, reached via
 * a Login Link — see openPayoutDashboard().
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthContext } from './use-auth-context';
import { config } from '../lib/config';
import { API_BASE_URL } from '../lib/config/api';
import { MIN_WITHDRAWAL_AMOUNT } from '../lib/constants';
import { openUrlInBrowser } from '../lib/utils/browser';

export interface BankAccount {
  id: string;
  accountHolderName?: string;
  bankName?: string | null;
  last4: string | null;
  accountType?: 'checking' | 'savings' | string;
  status: string;
  default: boolean;
}

export interface DebitCard {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  instantEligible: boolean;
}

export interface UsePayoutMethodsResult {
  bankAccounts: BankAccount[];
  debitCards: DebitCard[];
  /** True when at least one linked card supports instant payouts, regardless of current instant-available balance. Use for "add a card" messaging. */
  hasInstantEligibleCard: boolean;
  /**
   * The connected account's CURRENT balance.instant_available (USD, cents) —
   * informational only, NOT a pre-flight eligibility gate. This is
   * necessarily $0 (or residue from a previous instant payout) for any
   * hunter who hasn't already completed a prior withdrawal: money only
   * moves into the connected account's Stripe balance at the moment
   * POST /connect/instant-payout runs its own transfer step, so nothing
   * pre-funds it ahead of time. Gating UI on `> 0` here was the root cause
   * of Instant Cash Out staying permanently locked for first-time users
   * even after linking an eligible debit card (2026-07-21 audit) — do not
   * reintroduce that check. Display only.
   */
  instantAvailableCents: number;
  /** Server-side INSTANT_CASHOUT_ENABLED flag (from GET /connect/debit-cards). When false, Instant Cash Out is off platform-wide regardless of card eligibility — surface this distinctly from "no eligible card" so users get an accurate reason. */
  instantCashOutEnabled: boolean;
  /** hasInstantEligibleCard && instantCashOutEnabled. The actual per-attempt balance check happens server-side, live, at the moment of the request (see instantAvailableCents doc above for why it can't be pre-checked here). */
  canInstantCashOut: boolean;
  minWithdrawal: number;
  maxWithdrawal: number | null;
  /** Available-to-withdraw balance as computed server-side (balance minus holds). */
  availableBalance: number | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Opens the user's Stripe Express Dashboard (via a fresh Login Link) so they can add, remove, or set the default bank account/debit card. Refreshes the list on return. */
  openPayoutDashboard: () => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function usePayoutMethods(): UsePayoutMethodsResult {
  const { session } = useAuthContext();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [debitCards, setDebitCards] = useState<DebitCard[]>([]);
  const [instantAvailableCents, setInstantAvailableCents] = useState<number>(0);
  const [instantCashOutEnabled, setInstantCashOutEnabled] = useState<boolean>(true);
  const [minWithdrawal, setMinWithdrawal] = useState<number>(MIN_WITHDRAWAL_AMOUNT);
  const [maxWithdrawal, setMaxWithdrawal] = useState<number | null>(null);
  const [availableBalance, setAvailableBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
    }),
    [session?.access_token]
  );

  const refresh = useCallback(async () => {
    if (!session?.access_token) return;
    setIsLoading(true);
    setError(null);
    try {
      const [bankRes, cardRes] = await Promise.all([
        fetch(`${API_BASE_URL}/connect/bank-accounts`, { method: 'GET', headers: authHeaders() }),
        fetch(`${API_BASE_URL}/connect/debit-cards`, { method: 'GET', headers: authHeaders() }),
      ]);

      const bankData = bankRes.ok ? await bankRes.json() : { bankAccounts: [] };
      const cardData = cardRes.ok ? await cardRes.json() : { debitCards: [] };

      setBankAccounts(bankData.bankAccounts ?? []);
      setDebitCards(cardData.debitCards ?? []);
      setInstantAvailableCents(typeof cardData.instantAvailableCents === 'number' ? cardData.instantAvailableCents : 0);
      if (typeof cardData.instantCashOutEnabled === 'boolean') setInstantCashOutEnabled(cardData.instantCashOutEnabled);
      if (typeof bankData.minWithdrawal === 'number') setMinWithdrawal(bankData.minWithdrawal);
      if (typeof bankData.maxWithdrawal === 'number') setMaxWithdrawal(bankData.maxWithdrawal);
      if (typeof bankData.availableBalance === 'number') setAvailableBalance(bankData.availableBalance);

      if (!bankRes.ok && !cardRes.ok) {
        setError('Could not load your payout methods. Please try again.');
      }
    } catch (err) {
      console.error('[use-payout-methods] Failed to load payout methods:', err);
      setError('Could not reach the server. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [session?.access_token, authHeaders]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openPayoutDashboard = useCallback(async () => {
    console.log('[use-payout-methods] openPayoutDashboard: API request sent', {
      url: `${API_BASE_URL}/connect/login-link`,
    });
    try {
      const response = await fetch(`${API_BASE_URL}/connect/login-link`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.url) {
        console.error('[use-payout-methods] openPayoutDashboard: login-link request failed', {
          status: response.status,
          code: data?.code,
          error: data?.error,
        });
        return {
          ok: false as const,
          error: data?.error ?? 'Could not open your payout dashboard. Please try again.',
        };
      }

      console.log('[use-payout-methods] openPayoutDashboard: login link received, opening browser');
      const browserResult = await openUrlInBrowser(data.url);
      if (!browserResult.success) {
        console.error('[use-payout-methods] openPayoutDashboard: failed to open browser', {
          error: browserResult.error,
        });
        return {
          ok: false as const,
          error: browserResult.error ?? 'Could not open the browser. Please try again.',
        };
      }

      console.log('[use-payout-methods] openPayoutDashboard: returned from browser, refreshing payout state');
      await refresh();
      console.log('[use-payout-methods] openPayoutDashboard: payout state refreshed');
      return { ok: true as const };
    } catch (err) {
      console.error('[use-payout-methods] openPayoutDashboard: unexpected error', err);
      return { ok: false as const, error: 'Could not reach the server. Please try again.' };
    }
  }, [authHeaders, refresh]);

  const hasInstantEligibleCard = useMemo(
    () => debitCards.some(c => c.instantEligible),
    [debitCards]
  );
  // NOT gated on instantAvailableCents > 0 — see the doc comment on
  // instantAvailableCents above for why that balance is structurally $0
  // pre-flight and must not block Instant Cash Out from being offered.
  const canInstantCashOut = hasInstantEligibleCard && instantCashOutEnabled;

  return {
    bankAccounts,
    debitCards,
    hasInstantEligibleCard,
    instantAvailableCents,
    instantCashOutEnabled,
    canInstantCashOut,
    minWithdrawal,
    maxWithdrawal,
    availableBalance,
    isLoading,
    error,
    refresh,
    openPayoutDashboard,
  };
}
