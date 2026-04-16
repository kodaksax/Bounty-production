import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { config } from './config';
import { FINANCIAL_API_BASE_URL } from './config/api';
import { API_TIMEOUTS } from './config/network';
import { bountyService } from './services/bounty-service';
import { paymentService } from './services/payment-service';
import { supabase } from './supabase';
import { fetchWithTimeout } from './utils/fetch-with-timeout';
import { getNetworkErrorMessage } from './utils/network-connectivity';
import {
    getSecureJSON,
    migrateSecureStorageKeys,
    SecureKeys,
    setSecureJSON,
} from './utils/secure-storage';

// Platform fee configuration
// Service fees are deducted during bounty completion (when funds are released to hunter)
// NOT at withdrawal - this ensures transparency and consistency
export const PLATFORM_FEE_PERCENTAGE = 0.1; // 10% platform fee on bounty completion
export const CANCELLATION_FEE_EARLY = 0.05; // 5% fee for early cancellation
export const CANCELLATION_FEE_AFTER_WORK = 0.15; // 15% fee for cancellation after work started

// Local transaction shape (subset aligning with transaction history component)
export type WalletTransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'bounty_posted'
  | 'bounty_completed'
  | 'bounty_received'
  | 'escrow'
  | 'release'
  | 'refund'
  | 'platform_fee';
export interface WalletTransactionRecord {
  id: string;
  type: WalletTransactionType;
  amount: number; // positive for inflow, negative for outflow
  date: Date;
  details: {
    title?: string;
    method?: string;
    status?: string;
    counterparty?: string;
    bounty_id?: string | number;
    gross_amount?: number; // Original amount before fees
    platform_fee?: number; // Fee amount deducted
    fee_percentage?: number; // Fee percentage applied
  };
  disputeStatus?: 'none' | 'pending' | 'resolved';
  escrowStatus?: 'funded' | 'pending' | 'released';
}

interface WalletContextValue {
  balance: number;
  isLoading: boolean;
  secureStoreAvailable: boolean;
  payoutFailed: boolean;
  payoutFailureCode: string | null;
  // Clears the payout failure state (used after verify-onboarding succeeds)
  clearPayoutFailure: () => void;
  deposit: (amount: number, meta?: Partial<WalletTransactionRecord['details']>) => Promise<void>;
  withdraw: (
    amount: number,
    meta?: Partial<WalletTransactionRecord['details']>
  ) => Promise<boolean>; // false if insufficient
  setBalance: (amount: number) => void;
  refresh: () => Promise<void>;
  refreshFromApi: (accessToken?: string) => Promise<void>; // Refresh from API with auth token
  transactions: WalletTransactionRecord[];
  logTransaction: (
    tx: Omit<WalletTransactionRecord, 'id' | 'date'> & { date?: Date }
  ) => Promise<WalletTransactionRecord>;
  clearAllTransactions: () => Promise<void>;
  updateDisputeStatus: (
    transactionId: string,
    status: 'none' | 'pending' | 'resolved'
  ) => Promise<void>;
  createEscrow: (
    bountyId: string | number,
    amount: number,
    title: string,
    posterId: string
  ) => Promise<WalletTransactionRecord>;
  releaseFunds: (bountyId: string | number, hunterId: string, title: string) => Promise<boolean>;
  refundEscrow: (
    bountyId: string | number,
    title: string,
    refundPercentage: number
  ) => Promise<boolean>;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

// Use SecureStore for sensitive wallet data (balance and transactions)
// Start with 0 balance for production readiness - balance comes from API or deposits
const INITIAL_BALANCE = 0;

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [balance, setBalance] = useState<number>(INITIAL_BALANCE);
  const [secureStoreAvailable, setSecureStoreAvailable] = useState<boolean>(true);
  const balanceRef = useRef<number>(INITIAL_BALANCE);
  const [isLoading, setIsLoading] = useState(true);
  const [transactions, setTransactions] = useState<WalletTransactionRecord[]>([]);
  const [payoutFailed, setPayoutFailed] = useState<boolean>(false);
  const [payoutFailureCode, setPayoutFailureCode] = useState<string | null>(null);
  const lastOptimisticDepositRef = useRef<number | null>(null);
  // Tracks whether the WalletProvider is still mounted so async callbacks
  // (refresh, refreshFromApi) can skip setState calls after unmount.
  const mountedRef = useRef(true);

  const persist = useCallback(async (value: number) => {
    try {
      await setSecureJSON(SecureKeys.WALLET_BALANCE, value);
    } catch (error: any) {
      // If secure store is unavailable for sensitive keys, set a flag so
      // the UI can surface a clear, user-facing warning (do not silently
      // continue degrading security).
      if (error?.message === 'SecureStoreUnavailable') {
        console.error('[wallet] SecureStore is unavailable for sensitive keys:', error);
        setSecureStoreAvailable(false);
        return;
      }
      console.error('[wallet] Error persisting balance:', error);
    }
  }, []);

  // Keep a ref in sync with the latest balance so callbacks can read the
  // current value without capturing a stale closure. This lets refreshFromApi
  // run immediately after optimistic updates (setBalance) and observe the
  // most recent value.
  useEffect(() => {
    balanceRef.current = balance;
  }, [balance]);

  const persistTransactions = useCallback(async (list: WalletTransactionRecord[]) => {
    try {
      await setSecureJSON(SecureKeys.WALLET_TRANSACTIONS, list);
    } catch (error) {
      console.error('[wallet] Error persisting transactions:', error);
    }
  }, []);

  /** Helper: return the current session access token, or null if not signed in. */
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      return sessionData.session?.access_token ?? null;
    } catch {
      return null;
    }
  }, []);

  // Refresh wallet data from the API (fetches real transaction history and balance)
  // Defined before useEffect so it can be called on mount for initial API sync.
  const refreshFromApi = useCallback(
    async (accessToken?: string) => {
      if (!accessToken) {
        return;
      }

      if (!mountedRef.current) return;
      setIsLoading(true);
      try {
        // Diagnostic logging to help trace persistent 401s on wallet calls
        if (__DEV__) {
          try {
            const [, payload] = accessToken.split('.');
            const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
            const nowSec = Math.floor(Date.now() / 1000);
            console.log('[wallet] refreshFromApi token info', {
              tokenExpired: decoded.exp < nowSec,
              tokenExpiresIn: decoded.exp - nowSec,
              tokenIss: decoded.iss,
              tokenSub: decoded.sub,
              hasAnonKey: !!config.supabase.anonKey,
            });
          } catch {
            /* ignore diagnostic errors */
          }
        }

        // Fetch balance from API with timeout and retry
        const balanceResponse = await fetchWithTimeout(`${FINANCIAL_API_BASE_URL}/wallet/balance`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
          },
          timeout: API_TIMEOUTS.DEFAULT,
          retries: 2,
        });

        if (balanceResponse.headers?.get?.('X-Deprecated') === 'true') {
          console.warn(
            '[API] Received X-Deprecated header on GET /wallet/balance — this server surface is deprecated. ' +
              'Please ensure EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL is set so requests ' +
              'route to the Supabase Edge Function.'
          );
        }

        if (balanceResponse.ok && mountedRef.current) {
          const balanceData = await balanceResponse.json();
          const apiBalance = typeof balanceData.balance === 'number' ? balanceData.balance : 0;

          // Compute resolvedBalance synchronously from the closure-captured balance.
          // Mutating a local variable as a side effect inside the setBalance updater
          // is unsafe: the updater is called asynchronously (or even twice in Strict
          // Mode), so persist(resolvedBalance) could run before the updater executes
          // and end up persisting the wrong value.
          const now = Date.now();
          // Use a 5-minute window (up from 60s) to cover slow webhook processing
          // and, critically, persisted timestamps that survive cold restarts.
          const OPTIMISTIC_WINDOW_MS = 5 * 60 * 1000;
          const hasRecentOptimisticDeposit =
            lastOptimisticDepositRef.current !== null &&
            now - lastOptimisticDepositRef.current < OPTIMISTIC_WINDOW_MS;

          const currentBalance = balanceRef.current;

          const resolvedBalance =
            hasRecentOptimisticDeposit && currentBalance > apiBalance ? currentBalance : apiBalance;

          if (!hasRecentOptimisticDeposit || currentBalance <= apiBalance) {
            lastOptimisticDepositRef.current = null;
            // Clear persisted timestamp so future cold starts don't use a stale guard
            setSecureJSON(SecureKeys.WALLET_LAST_DEPOSIT_TS, null).catch(e => {
              console.error('[wallet] Failed to clear deposit timestamp', e);
            });
          }

          if (mountedRef.current) {
            setBalance(resolvedBalance);

            // Update payout failure state from API response
            setPayoutFailed(!!balanceData.payoutFailedAt);
            setPayoutFailureCode(
              typeof balanceData.payoutFailureCode === 'string'
                ? balanceData.payoutFailureCode
                : null
            );

            try {
              await persist(resolvedBalance);
            } catch (persistError) {
              console.error('[wallet] Failed to persist balance', persistError);
            }
          }

          // Fetch transactions from API with timeout and retry
          const txResponse = await fetchWithTimeout(
            `${FINANCIAL_API_BASE_URL}/wallet/transactions?limit=100`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
              },
              timeout: API_TIMEOUTS.DEFAULT,
              retries: 2,
            }
          );

          if (txResponse.headers?.get?.('X-Deprecated') === 'true') {
            console.warn(
              '[API] Received X-Deprecated header on GET /wallet/transactions — this server surface is deprecated. ' +
                'Please ensure EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL is set so requests ' +
                'route to the Supabase Edge Function.'
            );
          }

          // Transaction types that represent outflow (money leaving the user's wallet)
          const OUTFLOW_TYPES = ['escrow', 'withdrawal', 'bounty_posted'];

          if (txResponse.ok && mountedRef.current) {
            const txData = await txResponse.json();
            if (txData.transactions && Array.isArray(txData.transactions)) {
              // Determine which bounty IDs have already been settled (release or refund)
              // so escrow rows can be tagged as 'released' rather than 'funded' after a
              // cold reload. Without this, escrowStatus is undefined for all transactions
              // fetched from the API, causing releaseFunds to fail silently on restart.
              const settledBountyIds = new Set<string>(
                (txData.transactions as any[])
                  .filter((tx: any) => tx.type === 'release' || tx.type === 'refund')
                  .map((tx: any) => String(tx.details?.bounty_id ?? ''))
                  .filter(Boolean)
              );

              // Map API transactions to local format
              const mappedTransactions: WalletTransactionRecord[] = txData.transactions.map(
                (tx: any) => {
                  let escrowStatus: 'funded' | 'pending' | 'released' | undefined;
                  if (tx.type === 'escrow') {
                    const bid = String(tx.details?.bounty_id ?? '');
                    if (settledBountyIds.has(bid)) {
                      escrowStatus = 'released';
                    } else if (tx.details?.status === 'completed') {
                      escrowStatus = 'funded';
                    } else {
                      escrowStatus = 'pending';
                    }
                  }
                  return {
                    id: tx.id,
                    type: tx.type as WalletTransactionType,
                    // Use centralized config for transaction sign
                    amount: OUTFLOW_TYPES.includes(tx.type)
                      ? -Math.abs(tx.amount)
                      : Math.abs(tx.amount),
                    date: new Date(tx.date),
                    escrowStatus,
                    details: {
                      title: tx.details?.title,
                      method: tx.details?.method,
                      status: tx.details?.status,
                      bounty_id: tx.details?.bounty_id,
                    },
                  };
                }
              );

              // Merge inside the setTransactions updater so the merge always runs
              // against the latest state, not a potentially stale closed-over snapshot.
              // This also makes refreshFromApi safe to call from the mount effect
              // whose dependency array is [] (initial closure has transactions = []).
              if (mountedRef.current) {
                setTransactions(prev => {
                  const apiTxIds = new Set(mappedTransactions.map(tx => tx.id));
                  const localOnlyTx = prev.filter(tx => !apiTxIds.has(tx.id));
                  const mergedTransactions = [...mappedTransactions, ...localOnlyTx];
                  mergedTransactions.sort((a, b) => b.date.getTime() - a.date.getTime());
                  persistTransactions(mergedTransactions); // fire-and-forget inside updater
                  return mergedTransactions;
                });
              }
            }
          }
        }
      } catch (error) {
        const errorMessage = getNetworkErrorMessage(error);
        console.error('[wallet] Error refreshing from API:', errorMessage, error);
        // Fall back to local data
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    },
    [persist, persistTransactions]
  );

  // Keep a stable ref to `refreshFromApi` so subscription callbacks can call
  // the latest implementation without forcing the auth-state effect to
  // re-subscribe if the function identity changes.
  const refreshFromApiRef =
    useRef<(accessToken?: string) => Promise<void> | undefined>(refreshFromApi);

  useEffect(() => {
    refreshFromApiRef.current = refreshFromApi;
  }, [refreshFromApi]);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    try {
      // Load balance from SecureStore
      const storedBalance = await getSecureJSON<number>(SecureKeys.WALLET_BALANCE);
      if (storedBalance !== null) {
        if (mountedRef.current) setBalance(storedBalance);
      } else {
        await persist(INITIAL_BALANCE);
      }

      // Restore last optimistic deposit timestamp so the guard survives cold
      // restarts.  Without this the ref is always null after a restart and
      // refreshFromApi would unconditionally overwrite the locally-persisted
      // balance with the (potentially stale) API balance.
      const storedDepositTs = await getSecureJSON<number>(SecureKeys.WALLET_LAST_DEPOSIT_TS);
      if (typeof storedDepositTs === 'number' && storedDepositTs > 0) {
        lastOptimisticDepositRef.current = storedDepositTs;
      }

      // Load transactions from SecureStore
      const storedTx = await getSecureJSON<any[]>(SecureKeys.WALLET_TRANSACTIONS);
      if (storedTx && Array.isArray(storedTx) && mountedRef.current) {
        setTransactions(storedTx.map(t => ({ ...t, date: new Date(t.date) })));
      }
    } catch (error) {
      console.error('[wallet] Error refreshing from storage:', error);
    }
    if (mountedRef.current) setIsLoading(false);
  }, [persist]);

  useEffect(() => {
    mountedRef.current = true;
    const init = async () => {
      // Migrate any keys that were stored before the colon-to-underscore
      // sanitization was applied (one-time, guarded by an AsyncStorage flag).
      await migrateSecureStorageKeys();
      await refresh();
      // After loading the SecureStore cache, sync from the API so the server
      // is the authoritative source of truth for balance and transactions.
      if (!mountedRef.current) return;
      try {
        const token = await getAccessToken();
        if (token && mountedRef.current) {
          await refreshFromApi(token);
        }
      } catch (err) {
        console.error('[wallet] Error syncing from API on mount:', err);
      }
    };
    init();
    return () => {
      mountedRef.current = false;
    };
  }, []); // Only run once on mount, not on every refresh change

  // Clear wallet data when the user signs out to prevent data leaks between users.
  // Re-fetch authoritative balance when the user signs back in (covers the case
  // where the session expired, SIGNED_OUT wiped local data, and the user re-auths).
  useEffect(() => {
    const ret = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        // Persist the cleared state first so that if a new user signs in before
        // the component re-initialises, SecureStore reflects the blank slate.
        try {
          await Promise.all([
            setSecureJSON(SecureKeys.WALLET_BALANCE, INITIAL_BALANCE),
            setSecureJSON(SecureKeys.WALLET_TRANSACTIONS, []),
            setSecureJSON(SecureKeys.WALLET_LAST_DEPOSIT_TS, null),
          ]);
        } catch (err) {
          console.error('[wallet] Error clearing data on sign-out:', err);
        }
        lastOptimisticDepositRef.current = null;
        setBalance(INITIAL_BALANCE);
        setTransactions([]);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        // Re-fetch authoritative balance from the server whenever the user
        // signs in (or their token is silently refreshed). This is the primary
        // recovery path after session expiry: SIGNED_OUT wipes local state →
        // user re-authenticates → SIGNED_IN triggers this sync so the real
        // server-side balance is restored without requiring a manual navigation
        // to the Wallet screen.
        const token = session?.access_token;
        if (token) {
          try {
            // Call the latest memoized implementation via ref so we don't
            // force the effect to re-run when the function identity changes.
            await refreshFromApiRef.current?.(token);
          } catch (err) {
            console.error('[wallet] Error syncing balance after sign-in:', err);
          }
        }
      }
    });

    // Support different return shapes from Supabase SDK across versions
    const maybeSub = ret as any;
    const subscription =
      (maybeSub && maybeSub.data && maybeSub.data.subscription) ||
      maybeSub.subscription ||
      undefined;

    return () => {
      try {
        subscription?.unsubscribe?.();
      } catch (e) {
        // Swallow unsubscribe errors - best effort cleanup
      }
    };
  }, []); // run once on mount; uses refreshFromApiRef to invoke the latest implementation

  const logTransaction = useCallback(
    async (tx: Omit<WalletTransactionRecord, 'id' | 'date'> & { date?: Date }) => {
      const record: WalletTransactionRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        date: tx.date || new Date(),
        ...tx,
      } as WalletTransactionRecord;
      setTransactions(prev => {
        const next = [record, ...prev];
        persistTransactions(next);
        return next;
      });
      return record;
    },
    [persistTransactions]
  );

  const deposit = useCallback(
    async (amount: number, meta?: Partial<WalletTransactionRecord['details']>) => {
      if (amount <= 0 || Number.isNaN(amount)) return;
      // Update the ref immediately so callers that run refreshFromApi right
      // after this optimistic update read the latest value instead of a stale
      // closure. Persist will be called inside the state updater as well.
      balanceRef.current = balanceRef.current + amount;
      setBalance(prev => {
        const next = prev + amount;
        persist(next);
        return next;
      });
      lastOptimisticDepositRef.current = Date.now();
      // Persist the timestamp so the optimistic guard survives cold restarts.
      // Fire-and-forget; the in-memory ref is already set above.
      setSecureJSON(SecureKeys.WALLET_LAST_DEPOSIT_TS, Date.now()).catch(e => {
        console.error('[wallet] Failed to persist deposit timestamp', e);
      });
      await logTransaction({
        type: 'deposit',
        amount: amount, // inflow positive
        details: { method: meta?.method, ...meta },
      });
    },
    [persist, logTransaction]
  );

  const withdraw = useCallback(
    async (amount: number, meta?: Partial<WalletTransactionRecord['details']>) => {
      if (amount <= 0 || Number.isNaN(amount)) return false;
      // Keep the guard inside the updater so concurrent calls always check the
      // latest committed balance (prev), preventing negative balances even when
      // multiple withdrawals are scheduled before a re-render occurs.
      // React calls the updater synchronously during dispatch, so `deducted` is
      // set correctly before the `if (!deducted)` check below.
      let deducted = false;
      setBalance(prev => {
        if (prev < amount) return prev;
        deducted = true;
        const next = prev - amount;
        persist(next);
        return next;
      });
      if (!deducted) return false;
      await logTransaction({
        type: 'withdrawal',
        amount: -amount, // outflow negative
        details: { method: meta?.method, ...meta },
      });
      return true;
    },
    [persist, logTransaction]
  );

  const clearAllTransactions = useCallback(async () => {
    setTransactions([]);
    try {
      await setSecureJSON(SecureKeys.WALLET_TRANSACTIONS, []);
    } catch (error) {
      console.error('[wallet] Error clearing transactions:', error);
    }
  }, []);

  const updateDisputeStatus = useCallback(
    async (transactionId: string, status: 'none' | 'pending' | 'resolved') => {
      setTransactions(prev => {
        const next = prev.map(tx =>
          tx.id === transactionId ? { ...tx, disputeStatus: status } : tx
        );
        persistTransactions(next);
        return next;
      });
    },
    [persistTransactions]
  );

  // Create escrow transaction when poster accepts a request
  const createEscrow = useCallback(
    async (bountyId: string | number, amount: number, title: string, posterId: string) => {
      if (amount <= 0 || Number.isNaN(amount)) {
        throw new Error('Invalid escrow amount');
      }

      // Check if poster has sufficient balance
      if (balance < amount) {
        throw new Error('Insufficient balance to create escrow');
      }

      const bountyIdStr = String(bountyId);

      // Attempt to create escrow on the server first so the server is the source
      // of truth. Only update local state after server confirmation.
      try {
        const token = await getAccessToken();
        if (token) {
          const response = await fetchWithTimeout(`${FINANCIAL_API_BASE_URL}/wallet/escrow`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
            },
            body: JSON.stringify({ bountyId: bountyIdStr, amount, title }),
            timeout: API_TIMEOUTS.DEFAULT,
            retries: 0, // No retries for financial operations to prevent double-spend
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error((errData as any).error || 'Failed to create escrow on server');
          }

          const apiData = await response.json();
          // Use server-confirmed balance as source of truth
          const newBalance =
            typeof apiData.newBalance === 'number' ? apiData.newBalance : balance - amount;
          setBalance(newBalance);
          await persist(newBalance);

          const record = await logTransaction({
            type: 'escrow',
            amount: -amount,
            details: { title, bounty_id: bountyIdStr, status: 'pending' },
            escrowStatus: 'funded',
          });
          return record;
        }
      } catch (error) {
        // Re-throw so callers can handle the failure and roll back (e.g. delete bounty)
        throw error;
      }

      // Fallback: no active session – update local state only (e.g. in development)
      setBalance(prev => {
        const next = prev - amount;
        persist(next);
        return next;
      });

      // Log escrow transaction (store bounty_id as string to avoid type mismatches)
      const record = await logTransaction({
        type: 'escrow',
        amount: -amount, // outflow negative
        details: {
          title,
          bounty_id: bountyIdStr,
          status: 'pending',
        },
        escrowStatus: 'funded',
      });

      return record;
    },
    [balance, persist, logTransaction, getAccessToken]
  );

  // Release escrowed funds to hunter when bounty is completed
  // Calls the backend API to capture PaymentIntent and transfer to hunter's Connect account
  const releaseFunds = useCallback(
    async (bountyId: string | number, hunterId: string, title: string) => {
      try {
        // Find the local escrow transaction for this bounty
        const bountyIdStr = String(bountyId);
        const escrowTx = transactions.find(
          tx =>
            tx.type === 'escrow' &&
            String(tx.details.bounty_id) === bountyIdStr &&
            tx.escrowStatus === 'funded'
        );

        // Fetch bounty data early — needed to determine the release path and as a
        // fallback amount source for legacy bounties that have no local escrow record.
        const bountyData = await bountyService.getById(bountyId);

        if (!escrowTx) {
          // If there's a Stripe PaymentIntent, the Stripe capture path doesn't require a
          // local wallet escrow record and we can continue. This handles bounties accepted
          // before the wallet-escrow-at-posting feature was deployed.
          if (!bountyData?.payment_intent_id) {
            console.error(
              '[wallet] No funded escrow found and no payment_intent_id for bounty:',
              bountyId
            );
            return false;
          }
        }

        // Use local escrow amount when available; fall back to the bounty's stated amount
        // for legacy bounties that were accepted before wallet escrow at posting was live.
        const grossAmount = escrowTx
          ? Math.abs(escrowTx.amount)
          : Math.abs(bountyData?.amount ?? 0);
        let platformFee: number;
        let netAmount: number;

        if (bountyData?.payment_intent_id) {
          // Legacy / Stripe path: capture the PaymentIntent and transfer to hunter's Connect account.
          const releaseResult = await paymentService.releaseEscrow(bountyData.payment_intent_id);

          if (!releaseResult.success) {
            console.error('Failed to release escrow via Stripe:', releaseResult.error);
            return false;
          }

          platformFee = releaseResult.platformFee || grossAmount * PLATFORM_FEE_PERCENTAGE;
          netAmount = releaseResult.hunterAmount || grossAmount - platformFee;
        } else {
          // Internal wallet path: bounty was escrowed at posting time via /wallet/escrow.
          // Use the server-side /wallet/release endpoint to credit the hunter's balance.
          const token = await getAccessToken();
          if (!token) {
            console.error('[wallet] Cannot release funds: no access token');
            return false;
          }

          const response = await fetchWithTimeout(`${FINANCIAL_API_BASE_URL}/wallet/release`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
            },
            body: JSON.stringify({ bountyId: bountyIdStr, hunterId }),
            timeout: API_TIMEOUTS.DEFAULT,
            retries: 0, // No retries for financial operations to prevent double-credit
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            console.error('[wallet] Server release failed:', (errData as any).error);
            return false;
          }

          const releaseData = await response.json();
          // Server returns the net amount after platform fee deduction.
          platformFee = releaseData.platformFee ?? grossAmount * PLATFORM_FEE_PERCENTAGE;
          netAmount = releaseData.releaseAmount ?? grossAmount - platformFee;
        }

        // Update local escrow transaction status (only when a local escrow record exists;
        // legacy Stripe-path bounties may not have one in the local state).
        if (escrowTx) {
          setTransactions(prev => {
            const next = prev.map(tx =>
              tx.id === escrowTx.id
                ? ({
                    ...tx,
                    escrowStatus: 'released',
                    details: { ...tx.details, status: 'completed' },
                  } as WalletTransactionRecord)
                : tx
            ) as WalletTransactionRecord[];
            persistTransactions(next);
            return next;
          });
        }

        // Log platform fee transaction (for local record keeping)
        await logTransaction({
          type: 'platform_fee',
          amount: -platformFee, // negative as it's a deduction
          details: {
            title: 'Platform Service Fee',
            bounty_id: bountyIdStr,
            fee_percentage: PLATFORM_FEE_PERCENTAGE * 100,
            status: 'completed',
          },
        });

        // Log release transaction with net amount (after fee deduction)
        await logTransaction({
          type: 'release',
          amount: netAmount, // Net amount after fee
          details: {
            title,
            bounty_id: bountyIdStr,
            counterparty: hunterId,
            gross_amount: grossAmount,
            platform_fee: platformFee,
            status: 'completed',
          },
        });

        return true;
      } catch (error) {
        console.error('Error releasing funds:', error);
        return false;
      }
    },
    [transactions, logTransaction, persistTransactions]
  );

  // Refund escrowed funds back to poster when bounty is cancelled
  const refundEscrow = useCallback(
    async (bountyId: string | number, title: string, refundPercentage: number = 100) => {
      // Find the escrow transaction for this bounty
      const bountyIdStr = String(bountyId);
      const escrowTx = transactions.find(
        tx =>
          tx.type === 'escrow' &&
          String(tx.details.bounty_id) === bountyIdStr &&
          tx.escrowStatus === 'funded'
      );

      if (!escrowTx) {
        console.error('No funded escrow found for bounty:', bountyId);
        return false;
      }

      const escrowAmount = Math.abs(escrowTx.amount);
      const refundAmount = (escrowAmount * refundPercentage) / 100;

      // Attempt server-side refund first to ensure server is the source of truth.
      try {
        const token = await getAccessToken();
        if (!token) {
          console.error('[wallet] Cannot process refund: no access token');
          return false;
        }
        const response = await fetchWithTimeout(`${FINANCIAL_API_BASE_URL}/wallet/refund`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
          },
          body: JSON.stringify({
            bountyId: bountyIdStr,
            reason: `${refundPercentage}% refund`,
            refundPercentage,
          }),
          timeout: API_TIMEOUTS.DEFAULT,
          retries: 0, // No retries for financial operations
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          console.error('[wallet] Server refund failed:', (errData as any).error);
          return false;
        }
      } catch (error) {
        console.error('[wallet] Error calling refund API:', error);
        return false;
      }

      // Update escrow transaction status
      setTransactions(prev => {
        const next = prev.map(tx =>
          tx.id === escrowTx.id
            ? ({
                ...tx,
                escrowStatus: 'released',
                details: { ...tx.details, status: 'refunded' },
              } as WalletTransactionRecord)
            : tx
        ) as WalletTransactionRecord[];
        persistTransactions(next);
        return next;
      });

      // Return refund amount to poster's balance
      setBalance(prev => {
        const next = prev + refundAmount;
        persist(next);
        return next;
      });

      // Log refund transaction
      await logTransaction({
        type: 'refund',
        amount: refundAmount, // positive for poster receiving refund
        details: {
          title,
          bounty_id: bountyIdStr,
          status: 'completed',
          method: `${refundPercentage}% refund`,
        },
      });

      // Sync balance from API to reconcile after the refund
      try {
        const token = await getAccessToken();
        if (token) {
          await refreshFromApi(token);
        }
      } catch {
        // Non-critical: local state already updated above
      }

      return true;
    },
    [transactions, persistTransactions, logTransaction, persist, refreshFromApi, getAccessToken]
  );

  // Clear payout failure state (used by UI flows that verify onboarding)
  const clearPayoutFailure = useCallback(() => {
    if (!mountedRef.current) return;
    setPayoutFailed(false);
    setPayoutFailureCode(null);
  }, []);

  const value: WalletContextValue = {
    balance,
    isLoading,
    secureStoreAvailable,
    payoutFailed,
    payoutFailureCode,
    // Expose an explicit API to allow callers to clear the payout failure flag
    // when they have independently verified onboarding (prevents transient
    // network failures from leaving the banner visible after the user fixes
    // their payment details).
    clearPayoutFailure,
    deposit,
    withdraw,
    setBalance: (amt: number) => {
      setBalance(amt);
      persist(amt);
    },
    refresh,
    refreshFromApi,
    transactions,
    logTransaction,
    clearAllTransactions,
    updateDisputeStatus,
    createEscrow,
    releaseFunds,
    refundEscrow,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = (): WalletContextValue => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
};
