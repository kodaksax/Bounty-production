/**
 * Bank accounts + debit cards on the user's Stripe Connect account, shared
 * across withdraw-with-bank-screen, instant-cash-out-screen,
 * withdraw-method-select, and payout-methods-screen. Previously each screen
 * fetched GET /connect/bank-accounts and GET /connect/debit-cards
 * independently with near-identical boilerplate; this is the single source
 * of truth, including the mutation helpers (remove / set default).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthContext } from './use-auth-context';
import { config } from '../lib/config';
import { API_BASE_URL } from '../lib/config/api';
import { MIN_WITHDRAWAL_AMOUNT } from '../lib/constants';

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
  hasInstantEligibleCard: boolean;
  minWithdrawal: number;
  maxWithdrawal: number | null;
  /** Available-to-withdraw balance as computed server-side (balance minus holds). */
  availableBalance: number | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  removeBankAccount: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  removeDebitCard: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  setDefaultBankAccount: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function usePayoutMethods(): UsePayoutMethodsResult {
  const { session } = useAuthContext();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [debitCards, setDebitCards] = useState<DebitCard[]>([]);
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

  const removeBankAccount = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`${API_BASE_URL}/connect/bank-accounts/${id}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
        if (!response.ok) return { ok: false as const, error: 'Failed to remove bank account.' };
        await refresh();
        return { ok: true as const };
      } catch {
        return { ok: false as const, error: 'Could not reach the server. Please try again.' };
      }
    },
    [authHeaders, refresh]
  );

  const removeDebitCard = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`${API_BASE_URL}/connect/debit-cards/${id}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
        if (!response.ok) return { ok: false as const, error: 'Failed to remove debit card.' };
        await refresh();
        return { ok: true as const };
      } catch {
        return { ok: false as const, error: 'Could not reach the server. Please try again.' };
      }
    },
    [authHeaders, refresh]
  );

  const setDefaultBankAccount = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`${API_BASE_URL}/connect/bank-accounts/${id}/default`, {
          method: 'POST',
          headers: authHeaders(),
        });
        if (!response.ok) return { ok: false as const, error: 'Failed to update your default bank account.' };
        await refresh();
        return { ok: true as const };
      } catch {
        return { ok: false as const, error: 'Could not reach the server. Please try again.' };
      }
    },
    [authHeaders, refresh]
  );

  const hasInstantEligibleCard = useMemo(
    () => debitCards.some(c => c.instantEligible),
    [debitCards]
  );

  return {
    bankAccounts,
    debitCards,
    hasInstantEligibleCard,
    minWithdrawal,
    maxWithdrawal,
    availableBalance,
    isLoading,
    error,
    refresh,
    removeBankAccount,
    removeDebitCard,
    setDefaultBankAccount,
  };
}
