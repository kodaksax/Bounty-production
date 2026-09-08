import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { config } from './config';
import { FINANCIAL_API_BASE_URL } from './config/api';
import { API_TIMEOUTS } from './config/network';
import { bountyPaymentsService } from './services/bounty-payments-service';
import { bountyService } from './services/bounty-service';
import { paymentService } from './services/payment-service';
import { supabase } from './supabase';
import { logger } from './utils/error-logger';
import { fetchWithTimeout } from './utils/fetch-with-timeout';
import { getNetworkErrorMessage } from './utils/network-connectivity';
import { isPhase2Bounty, isV3Bounty } from './utils/payment-architecture';
import {
    getSecureJSON,
    migrateSecureStorageKeys,
    SecureKeys,
    setSecureJSON,
} from './utils/secure-storage';
import type { SettlementState, SettlementTone } from './utils/settlement-vocabulary';
import {
    resolveSupabaseAuthSubscription,
    safeUnsubscribe,
    SupabaseAuthSubscription,
} from './utils/supabase-subscription';
import { PLATFORM_FEE_RATE, effectiveFeePercent } from './constants/fees';

// Platform fee configuration
// Service fees are deducted during bounty completion (when funds are released to hunter)
// NOT at withdrawal - this ensures transparency and consistency
//
// The rate itself lives in lib/constants/fees.ts, which mirrors the server's
// PLATFORM_FEE_PERCENT. This re-export is kept so existing importers (and the
// FAQ copy, which derives its "% service fee" line from it) keep working.
export { PLATFORM_FEE_PERCENT, PLATFORM_FEE_DISPLAY, calculateHunterEarnings } from './constants/fees';
export const PLATFORM_FEE_PERCENTAGE = PLATFORM_FEE_RATE;
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
    // What Stripe can prove about this row, computed server-side by
    // GET /wallet/transactions. Carried through so the transaction list and
    // detail modal render the real settlement status instead of the weakest
    // fallback label. Absent on rows cached before settlement state shipped.
    settlementState?: SettlementState;
    settlementLabel?: string;
    settlementDetail?: string;
    settlementTone?: SettlementTone;
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
  // Refresh from API with auth token. Pass { silent: true } for background
  // refreshes that must not toggle the loading flag. Pass { force: true } only
  // when the SERVER is known to have just moved money (e.g. escrow reserved
  // during acceptance) — it bypasses the optimistic-deposit guard so a
  // legitimate DECREASE cannot be masked by a recent optimistic increase.
  refreshFromApi: (
    accessToken?: string,
    options?: { silent?: boolean; force?: boolean }
  ) => Promise<void>;
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

type WalletApiErrorBody = {
  error?: unknown;
  code?: unknown;
  retryable?: unknown;
  requestId?: unknown;
  settlementType?: unknown;
  settlementStatus?: unknown;
  newBalance?: unknown;
};

async function readWalletApiError(response: Response): Promise<WalletApiErrorBody> {
  try {
    const data = await response.json();
    return data && typeof data === 'object' ? (data as WalletApiErrorBody) : {};
  } catch {
    return {};
  }
}

function walletApiCode(data: WalletApiErrorBody): string | undefined {
  return typeof data.code === 'string' ? data.code : undefined;
}

function walletApiRequestId(response: Response, data: WalletApiErrorBody): string | undefined {
  return typeof data.requestId === 'string'
    ? data.requestId
    : (response.headers?.get?.('x-request-id') ?? undefined);
}

function walletApiMessage(data: WalletApiErrorBody, fallback: string): string {
  return typeof data.error === 'string' && data.error.trim().length > 0 ? data.error : fallback;
}

function logWalletApiFailure(
  operation: string,
  response: Response,
  data: WalletApiErrorBody,
  context: Record<string, unknown> = {}
) {
  logger.warning('Wallet API request failed', {
    operation,
    status: response.status,
    code: walletApiCode(data),
    retryable: typeof data.retryable === 'boolean' ? data.retryable : undefined,
    requestId: walletApiRequestId(response, data),
    ...context,
  });
}

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
  // Tracks the signed-in user id so the realtime balance subscription below
  // can be scoped to the right row and rebuilt on sign-out/sign-in.
  const [userId, setUserId] = useState<string | null>(null);
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
    async (accessToken?: string, options?: { silent?: boolean; force?: boolean }) => {
      if (!accessToken) {
        return;
      }

      if (!mountedRef.current) return;
      // Background refreshes (the realtime balance subscription, auth/token
      // events, foreground re-sync, post-operation reconciles, the wallet
      // screen's session effect) pass { silent: true } so they don't flip the
      // shared `isLoading` flag that gates the balance render. Without this,
      // every background refetch blanks the balance to a skeleton and back —
      // the "balance flashing/refreshing constantly" bug. Only the initial
      // mount load and explicit pull-to-refresh should surface a loading state.
      const silent = options?.silent ?? false;
      if (!silent) setIsLoading(true);
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
          // `force` short-circuits the guard. The guard's whole purpose is to stop
          // a webhook-lagged API read from clobbering a just-made optimistic
          // deposit — it assumes the local value may be NEWER than the server's.
          // After a server-side debit (escrow reserved during acceptance) that
          // assumption is inverted: the server value is newer by construction,
          // and honouring the guard would hold a stale, too-high balance on
          // screen for up to five minutes right after the poster was charged.
          const hasRecentOptimisticDeposit =
            !options?.force &&
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
                      // Settlement fields (see WalletTransactionRecord.details).
                      settlementState: tx.details?.settlementState,
                      settlementLabel: tx.details?.settlementLabel,
                      settlementDetail: tx.details?.settlementDetail,
                      settlementTone: tx.details?.settlementTone,
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
        if (!silent && mountedRef.current) setIsLoading(false);
      }
    },
    [persist, persistTransactions]
  );

  // Keep a stable ref to `refreshFromApi` so subscription callbacks can call
  // the latest implementation without forcing the auth-state effect to
  // re-subscribe if the function identity changes.
  const refreshFromApiRef =
    useRef<(accessToken?: string, options?: { silent?: boolean }) => Promise<void> | undefined>(
      refreshFromApi
    );

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
    let cleanupRequested = false;
    let authSubscription: SupabaseAuthSubscription | undefined;

    const ret = supabase.auth.onAuthStateChange((event, session) => {
      // Keep auth callback lock-safe: defer all async storage/network work.
      setTimeout(() => {
        void (async () => {
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
                // Silent: background recovery must not flash the balance UI.
                await refreshFromApiRef.current?.(token, { silent: true });
              } catch (err) {
                console.error('[wallet] Error syncing balance after sign-in:', err);
              }
            }
          }
        })();
      }, 0);
    });

    resolveSupabaseAuthSubscription(
      ret,
      resolvedSubscription => {
        authSubscription = resolvedSubscription;
        if (cleanupRequested) {
          safeUnsubscribe(authSubscription);
        }
      },
      error => {
        console.error('[wallet] Failed to register auth listener:', error);
      }
    );

    return () => {
      cleanupRequested = true;
      safeUnsubscribe(authSubscription);
    };
  }, []); // run once on mount; uses refreshFromApiRef to invoke the latest implementation

  // Track the signed-in user id, independently of the sign-out/sign-in data
  // clearing effect above, so the realtime balance subscription below can be
  // scoped correctly and rebuilt when the user changes.
  useEffect(() => {
    let cancelled = false;
    let cleanupRequested = false;
    let authSubscription: SupabaseAuthSubscription | undefined;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setUserId(session?.user?.id ?? null);
    });

    const ret = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUserId(null);
      } else if (session?.user?.id) {
        setUserId(session.user.id);
      }
    });

    resolveSupabaseAuthSubscription(
      ret,
      resolvedSubscription => {
        authSubscription = resolvedSubscription;
        if (cleanupRequested) {
          safeUnsubscribe(authSubscription);
        }
      },
      error => {
        console.error('[wallet] Failed to register user-id auth listener:', error);
      }
    );

    return () => {
      cancelled = true;
      cleanupRequested = true;
      safeUnsubscribe(authSubscription);
    };
  }, []);

  // Realtime subscription on profiles.balance so the displayed balance updates
  // immediately when the server processes a deposit, withdrawal, escrow, or
  // release for this user — without waiting for the next mount/auth event.
  // refreshFromApi's existing OPTIMISTIC_WINDOW_MS guard prevents this from
  // clobbering a just-made optimistic deposit with a stale server value.
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`wallet-balance:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        payload => {
          // This subscription fires on ANY column update to the user's profile
          // row (session tracking, verification, Stripe sync, onboarding flags,
          // …), not just balance. Refetching on every one was a primary cause of
          // the balance flashing/refetching constantly. Only react when the
          // balance field itself changed, and refresh silently so the UI doesn't
          // blank to a skeleton.
          const newBalance = (payload.new as { balance?: number } | null)?.balance;
          const oldBalance = (payload.old as { balance?: number } | null)?.balance;
          if (newBalance === oldBalance) {
            return; // unrelated profile write — balance unchanged; ignore
          }
          getAccessToken().then(token => {
            if (token) refreshFromApiRef.current?.(token, { silent: true });
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel).catch(() => {
        // best-effort cleanup
      });
    };
  }, [userId, getAccessToken]);

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
            const errData = await readWalletApiError(response);
            // 409 duplicate_transaction is *not* an error after the bounty
            // INSERT trigger landed (see migration 20260518): the trigger
            // reserves escrow atomically with the bounty row, so by the time
            // the client gets here the escrow already exists.  Treat it as a
            // successful idempotent reservation: pick up the server-provided
            // newBalance (or fall back to a derived value) and continue.  If
            // we threw here, the caller (useBountyForm) would mistakenly
            // delete a bounty whose funds are already correctly held.
            const errCode = walletApiCode(errData);
            if (response.status === 409 && errCode === 'duplicate_transaction') {
              const dupBalance =
                typeof errData.newBalance === 'number'
                  ? errData.newBalance
                  : Math.max(0, balance - amount);
              setBalance(dupBalance);
              await persist(dupBalance);
              const dupRecord = await logTransaction({
                type: 'escrow',
                amount: -amount,
                details: { title, bounty_id: bountyIdStr, status: 'pending' },
                escrowStatus: 'funded',
              });
              return dupRecord;
            }
            logWalletApiFailure('wallet_escrow_create', response, errData, {
              bountyId: bountyIdStr,
            });
            throw new Error(walletApiMessage(errData, 'Failed to create escrow on server'));
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

        // Phase 2 and v3 funds are held by Stripe, not the legacy wallet
        // ledger. Their authoritative release is the bounty-payments edge
        // function, which creates the Connect transfer with a Stripe
        // idempotency key. The server branches on the bounty's own
        // payment_architecture_version.
        if (isPhase2Bounty(bountyData) || isV3Bounty(bountyData)) {
          const result = await bountyPaymentsService.releaseBountyPayment(bountyIdStr, hunterId);
          // v3 settles asynchronously: /release returns 'release_pending' and
          // only the transfer.created webhook makes it 'released'. Treating
          // that as failure would tell the poster the payout broke when it is
          // simply not confirmed yet.
          const acceptedRelease =
            result.status === 'released' ||
            (result.status === 'release_pending' && !!result.transferId);
          if (!acceptedRelease) return false;
          try {
            const refreshToken = await getAccessToken();
            if (refreshToken) await refreshFromApi(refreshToken, { silent: true });
          } catch {
            // The settlement result came from the authoritative server; refresh can retry later.
          }
          return true;
        }

        if (!escrowTx) {
          // If there's a Stripe PaymentIntent, the Stripe capture path doesn't require a
          // local wallet escrow record and we can continue. This handles bounties accepted
          // before the wallet-escrow-at-posting feature was deployed.
          if (!bountyData?.payment_intent_id) {
            // No local escrow record and no Stripe PaymentIntent. This can occur when
            // the app's local wallet state is lost (reinstall / cache clear) for a paid
            // bounty that was escrowed via the internal wallet path.
            // Fall through to the server-side /wallet/release endpoint — it tracks
            // escrow state authoritatively in the database.
            if (!bountyData?.amount) {
              // Genuinely no amount on record — nothing to release.
              console.error(
                '[wallet] No funded escrow, no payment_intent_id, and no amount for bounty:',
                bountyId
              );
              return false;
            }
            console.warn(
              '[wallet] No local escrow record found; attempting server-side release for bounty:',
              bountyId
            );
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
            const releaseErrorCode = releaseResult.error?.code;
            // Treat "already captured/released" as an idempotent success — the funds have
            // already been settled via Stripe, so the approval flow can continue.
            if (releaseErrorCode === 'escrow_already_settled') {
              console.warn(
                '[wallet] Stripe escrow already captured for bounty (idempotent):',
                bountyIdStr
              );
              platformFee = grossAmount * PLATFORM_FEE_PERCENTAGE;
              netAmount = grossAmount - platformFee;
            } else if (releaseErrorCode === 'connect_not_onboarded') {
              // Hunter has not set up their Stripe Connect account.
              throw new Error(
                'The hunter has not set up their payout account. Funds remain in escrow — please contact support.'
              );
            } else {
              logger.warning('Failed to release legacy Stripe escrow', {
                operation: 'legacy_stripe_escrow_release',
                bountyId: bountyIdStr,
                paymentIntentId: bountyData.payment_intent_id,
                code: releaseErrorCode,
                retryable: releaseResult.error?.retryable,
              });
              return false;
            }
          } else {
            platformFee = releaseResult.platformFee || grossAmount * PLATFORM_FEE_PERCENTAGE;
            netAmount = releaseResult.hunterAmount || grossAmount - platformFee;
          }
        } else {
          // Internal wallet path: bounty was escrowed at posting time via /wallet/escrow.
          // Use the server-side /wallet/release endpoint to credit the hunter's balance.
          const token = await getAccessToken();
          if (!token) {
            // Token is missing — likely the session expired. Throw so the UI surfaces a
            // useful message rather than showing a generic "contact support" prompt.
            throw new Error(
              'Your session has expired. Please sign out and sign back in, then try again.'
            );
          }

          // Allow one retry on network/timeout errors only (not on server errors).
          // The server's ConflictError 409 idempotency protection makes this safe: if the
          // first request reached the server and succeeded, the retry gets a 409 "already
          // released" response which the handler below treats as success.
          const response = await fetchWithTimeout(`${FINANCIAL_API_BASE_URL}/wallet/release`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
            },
            body: JSON.stringify({ bountyId: bountyIdStr, hunterId }),
            timeout: API_TIMEOUTS.DEFAULT,
            retries: 1,
            // Only retry on genuine network/timeout errors where no server response was
            // received. Do NOT retry on 4xx/5xx to avoid double-processing ambiguity.
            retryOn: (res, err) => {
              if (
                err &&
                (err.name === 'AbortError' || /timeout|network|fetch/i.test(err.message))
              ) {
                return true;
              }
              return false;
            },
          });

          if (!response.ok) {
            const errData = await readWalletApiError(response);
            const errCode = walletApiCode(errData);
            const settlementType =
              typeof errData.settlementType === 'string' ? errData.settlementType : undefined;

            // 409 duplicate release — the release is already settled or in progress (idempotent success).
            if (
              response.status === 409 &&
              errCode === 'duplicate_transaction' && settlementType === 'release'
            ) {
              console.warn(
                '[wallet] Escrow already released for bounty (idempotent):',
                bountyIdStr
              );
              platformFee = grossAmount * PLATFORM_FEE_PERCENTAGE;
              netAmount = grossAmount - platformFee;
            } else if (response.status === 400 && errCode === 'connect_not_onboarded') {
              // Hunter has not set up a payout account — user-actionable failure.
              throw new Error(
                'The hunter has not set up their payout account. Funds remain in escrow — please contact support.'
              );
            } else if (response.status === 401 || response.status === 403) {
              // Auth failure — guide the poster to re-authenticate.
              throw new Error(
                'Authorization error releasing funds. Please sign out and sign back in, then try again.'
              );
            } else {
              logWalletApiFailure('wallet_release', response, errData, {
                bountyId: bountyIdStr,
                hunterId,
                settlementType,
                settlementStatus: errData.settlementStatus,
              });
              return false;
            }
          } else {
            const releaseData = await response.json();
            // Server returns the net amount after platform fee deduction.
            platformFee = releaseData.platformFee ?? grossAmount * PLATFORM_FEE_PERCENTAGE;
            netAmount = releaseData.releaseAmount ?? grossAmount - platformFee;
            if (typeof releaseData.posterBalance === 'number') {
              balanceRef.current = releaseData.posterBalance;
              setBalance(releaseData.posterBalance);
              await persist(releaseData.posterBalance);
            }
          }
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
            // Derived from the fee that was ACTUALLY applied to this release,
            // not from the client's estimate — the server's rate is
            // env-configurable, so a hardcoded constant here would print a
            // percentage on the user's receipt that does not match the money
            // that moved.
            fee_percentage: effectiveFeePercent(grossAmount, platformFee),
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

        // Sync balance and transactions from API to reconcile after the release.
        // The poster's server-side balance was already deducted at escrow creation
        // (via the bounty INSERT trigger / apply_escrow), so no balance change is
        // expected here in the normal flow.  Refreshing nonetheless guarantees the
        // local state matches the server's authoritative view — covering edge
        // cases (e.g. concurrent wallet activity, dispute holds released, or stale
        // local state after app resume) where the displayed balance could
        // otherwise drift after a payout release.  Mirrors the refundEscrow flow
        // below for consistency.  Non-fatal: a failure here does not invalidate
        // the successful server release.
        try {
          const refreshToken = await getAccessToken();
          if (refreshToken) {
            // Silent: local balance already updated optimistically above; this
            // is a background reconcile and must not flash the balance UI.
            await refreshFromApi(refreshToken, { silent: true });
          }
        } catch {
          // Non-critical: server release already succeeded; local state will
          // catch up on the next refresh (wallet screen mount, app resume, etc.).
        }

        return true;
      } catch (error) {
        console.error('Error releasing funds:', error);
        return false;
      }
    },
    [transactions, logTransaction, persistTransactions, getAccessToken, persist, refreshFromApi]
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

      // A missing local escrow is NOT a failure: the refund is also triggered by
      // the party ACCEPTING a cancellation, and when the poster is the requester
      // that party is the hunter, whose wallet never held the escrow. The server
      // locates the escrow row itself and credits whoever funded it, so the only
      // thing a missing local row changes is that there is no local ledger of
      // this user's to update afterwards.
      const escrowAmount = escrowTx ? Math.abs(escrowTx.amount) : 0;
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
          const errData = await readWalletApiError(response);
          const errCode = walletApiCode(errData);
          const settlementType =
            typeof errData.settlementType === 'string' ? errData.settlementType : undefined;
          if (
            response.status === 409 &&
            errCode === 'duplicate_transaction' && settlementType === 'refund'
          ) {
            logger.warning('Wallet refund already settled on server', {
              operation: 'wallet_refund',
              bountyId: bountyIdStr,
              requestId: walletApiRequestId(response, errData),
              settlementType,
              settlementStatus: errData.settlementStatus,
            });
          } else {
            logWalletApiFailure('wallet_refund', response, errData, {
              bountyId: bountyIdStr,
              settlementType,
              settlementStatus: errData.settlementStatus,
            });
            return false;
          }
        }
      } catch (error) {
        console.error('[wallet] Error calling refund API:', error);
        return false;
      }

      // Local ledger/balance updates apply only to the wallet that actually
      // funded the escrow. When the refund was triggered by the responding
      // hunter, the money moved in the POSTER's wallet server-side and this
      // device must not credit itself — the refreshFromApi below is all it needs.
      if (escrowTx) {
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
      }

      // Sync balance from API to reconcile after the refund
      try {
        const token = await getAccessToken();
        if (token) {
          // Silent: local state already updated above; background reconcile.
          await refreshFromApi(token, { silent: true });
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

  const setBalanceAndPersist = useCallback(
    (amt: number) => {
      setBalance(amt);
      persist(amt);
    },
    [persist]
  );

  const value: WalletContextValue = useMemo(
    () => ({
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
      setBalance: setBalanceAndPersist,
      refresh,
      refreshFromApi,
      transactions,
      logTransaction,
      clearAllTransactions,
      updateDisputeStatus,
      createEscrow,
      releaseFunds,
      refundEscrow,
    }),
    [
      balance,
      isLoading,
      secureStoreAvailable,
      payoutFailed,
      payoutFailureCode,
      clearPayoutFailure,
      deposit,
      withdraw,
      setBalanceAndPersist,
      refresh,
      refreshFromApi,
      transactions,
      logTransaction,
      clearAllTransactions,
      updateDisputeStatus,
      createEscrow,
      releaseFunds,
      refundEscrow,
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = (): WalletContextValue => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
};
