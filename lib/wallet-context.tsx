import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from './config/api';
import { API_TIMEOUTS } from './config/network';
import { bountyService } from './services/bounty-service';
import { paymentService } from './services/payment-service';
import { supabase } from './supabase';
import { fetchWithTimeout } from './utils/fetch-with-timeout';
import { getNetworkErrorMessage } from './utils/network-connectivity';
import { getSecureJSON, SecureKeys, setSecureJSON } from './utils/secure-storage';

// Platform fee configuration
// Service fees are deducted during bounty completion (when funds are released to hunter)
// NOT at withdrawal - this ensures transparency and consistency
export const PLATFORM_FEE_PERCENTAGE = 0.10; // 10% platform fee on bounty completion
export const CANCELLATION_FEE_EARLY = 0.05; // 5% fee for early cancellation
export const CANCELLATION_FEE_AFTER_WORK = 0.15; // 15% fee for cancellation after work started

// Local transaction shape (subset aligning with transaction history component)
export type WalletTransactionType = 'deposit' | 'withdrawal' | 'bounty_posted' | 'bounty_completed' | 'bounty_received' | 'escrow' | 'release' | 'refund' | 'platform_fee';
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
  disputeStatus?: "none" | "pending" | "resolved";
  escrowStatus?: "funded" | "pending" | "released";
}

interface WalletContextValue {
  balance: number;
  isLoading: boolean;
  secureStoreAvailable: boolean;
  deposit: (amount: number, meta?: Partial<WalletTransactionRecord['details']>) => Promise<void>;
  withdraw: (amount: number, meta?: Partial<WalletTransactionRecord['details']>) => Promise<boolean>; // false if insufficient
  setBalance: (amount: number) => void;
  refresh: () => Promise<void>;
  refreshFromApi: (accessToken?: string) => Promise<void>; // Refresh from API with auth token
  transactions: WalletTransactionRecord[];
  logTransaction: (tx: Omit<WalletTransactionRecord, 'id' | 'date'> & { date?: Date }) => Promise<WalletTransactionRecord>;
  clearAllTransactions: () => Promise<void>;
  updateDisputeStatus: (transactionId: string, status: "none" | "pending" | "resolved") => Promise<void>;
  createEscrow: (bountyId: string | number, amount: number, title: string, posterId: string) => Promise<WalletTransactionRecord>;
  releaseFunds: (bountyId: string | number, hunterId: string, title: string) => Promise<boolean>;
  refundEscrow: (bountyId: string | number, title: string, refundPercentage: number) => Promise<boolean>;
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
  const lastOptimisticDepositRef = useRef<number | null>(null);

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
  const refreshFromApi = useCallback(async (accessToken?: string) => {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    try {
      // Fetch balance from API with timeout and retry
      const balanceResponse = await fetchWithTimeout(`${API_BASE_URL}/wallet/balance`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: API_TIMEOUTS.DEFAULT,
        retries: 2,
      });

      if (balanceResponse.ok) {
        const balanceData = await balanceResponse.json();
        const apiBalance = typeof balanceData.balance === 'number' ? balanceData.balance : 0;

        // Compute resolvedBalance synchronously from the closure-captured balance.
        // Mutating a local variable as a side effect inside the setBalance updater
        // is unsafe: the updater is called asynchronously (or even twice in Strict
        // Mode), so persist(resolvedBalance) could run before the updater executes
        // and end up persisting the wrong value.
        const now = Date.now();
        const hasRecentOptimisticDeposit =
          lastOptimisticDepositRef.current !== null &&
          now - lastOptimisticDepositRef.current < 60_000;

        const currentBalance = balanceRef.current;

        const resolvedBalance = hasRecentOptimisticDeposit && currentBalance > apiBalance
          ? currentBalance
          : apiBalance;

        if (!hasRecentOptimisticDeposit || currentBalance <= apiBalance) {
          lastOptimisticDepositRef.current = null;
        }

        setBalance(resolvedBalance);

        try {
          await persist(resolvedBalance);
        } catch (persistError) {
          console.error('[wallet] Failed to persist balance', persistError);
        }
      }

      // Fetch transactions from API with timeout and retry
      const txResponse = await fetchWithTimeout(`${API_BASE_URL}/wallet/transactions?limit=100`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: API_TIMEOUTS.DEFAULT,
        retries: 2,
      });

      // Transaction types that represent outflow (money leaving the user's wallet)
      const OUTFLOW_TYPES = ['escrow', 'withdrawal', 'bounty_posted'];

      if (txResponse.ok) {
        const txData = await txResponse.json();
        if (txData.transactions && Array.isArray(txData.transactions)) {
          // Map API transactions to local format
          const mappedTransactions: WalletTransactionRecord[] = txData.transactions.map((tx: any) => ({
            id: tx.id,
            type: tx.type as WalletTransactionType,
            // Use centralized config for transaction sign
            amount: OUTFLOW_TYPES.includes(tx.type) 
              ? -Math.abs(tx.amount) 
              : Math.abs(tx.amount),
            date: new Date(tx.date),
            details: {
              title: tx.details?.title,
              method: tx.details?.method,
              status: tx.details?.status,
              bounty_id: tx.details?.bounty_id,
            },
          }));

          // Merge inside the setTransactions updater so the merge always runs
          // against the latest state, not a potentially stale closed-over snapshot.
          // This also makes refreshFromApi safe to call from the mount effect
          // whose dependency array is [] (initial closure has transactions = []).
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
    } catch (error) {
      const errorMessage = getNetworkErrorMessage(error);
      console.error('[wallet] Error refreshing from API:', errorMessage, error);
      // Fall back to local data
    } finally {
      setIsLoading(false);
    }
  }, [persist, persistTransactions]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      // Load balance from SecureStore
      const storedBalance = await getSecureJSON<number>(SecureKeys.WALLET_BALANCE);
      if (storedBalance !== null) {
        setBalance(storedBalance);
      } else {
        await persist(INITIAL_BALANCE);
      }

      // Load transactions from SecureStore
      const storedTx = await getSecureJSON<any[]>(SecureKeys.WALLET_TRANSACTIONS);
      if (storedTx && Array.isArray(storedTx)) {
        setTransactions(storedTx.map(t => ({ ...t, date: new Date(t.date) })));
      }
    } catch (error) {
      console.error('[wallet] Error refreshing from storage:', error);
    }
    setIsLoading(false);
  }, [persist]);

  useEffect(() => { 
    const init = async () => {
      await refresh();
      // After loading the SecureStore cache, sync from the API so the server
      // is the authoritative source of truth for balance and transactions.
      try {
        const token = await getAccessToken();
        if (token) {
          await refreshFromApi(token);
        }
      } catch (err) {
        console.error('[wallet] Error syncing from API on mount:', err);
      }
    };
    init();
  }, []); // Only run once on mount, not on every refresh change

  // Clear wallet data when the user signs out to prevent data leaks between users
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        // Persist the cleared state first so that if a new user signs in before
        // the component re-initialises, SecureStore reflects the blank slate.
        try {
          await Promise.all([
            setSecureJSON(SecureKeys.WALLET_BALANCE, INITIAL_BALANCE),
            setSecureJSON(SecureKeys.WALLET_TRANSACTIONS, []),
          ]);
        } catch (err) {
          console.error('[wallet] Error clearing data on sign-out:', err);
        }
        setBalance(INITIAL_BALANCE);
        setTransactions([]);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const logTransaction = useCallback(async (tx: Omit<WalletTransactionRecord, 'id' | 'date'> & { date?: Date }) => {
    const record: WalletTransactionRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      date: tx.date || new Date(),
      ...tx,
    } as WalletTransactionRecord;
    setTransactions(prev => {
      const next = [record, ...prev];
      persistTransactions(next);
      return next;
    });
    return record;
  }, [persistTransactions]);

  const deposit = useCallback(async (amount: number, meta?: Partial<WalletTransactionRecord['details']>) => {
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
    await logTransaction({
      type: 'deposit',
      amount: amount, // inflow positive
      details: { method: meta?.method, ...meta },
    });
  }, [persist, logTransaction]);

  const withdraw = useCallback(async (amount: number, meta?: Partial<WalletTransactionRecord['details']>) => {
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
  }, [persist, logTransaction]);

  const clearAllTransactions = useCallback(async () => {
    setTransactions([]);
    try { 
      await setSecureJSON(SecureKeys.WALLET_TRANSACTIONS, []); 
    } catch (error) {
      console.error('[wallet] Error clearing transactions:', error);
    }
  }, []);

  const updateDisputeStatus = useCallback(async (transactionId: string, status: "none" | "pending" | "resolved") => {
    setTransactions(prev => {
      const next = prev.map(tx => 
        tx.id === transactionId ? { ...tx, disputeStatus: status } : tx
      );
      persistTransactions(next);
      return next;
    });
  }, [persistTransactions]);

  // Create escrow transaction when poster accepts a request
  const createEscrow = useCallback(async (bountyId: string | number, amount: number, title: string, posterId: string) => {
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
        const response = await fetchWithTimeout(`${API_BASE_URL}/wallet/escrow`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
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
        const newBalance = typeof apiData.newBalance === 'number' ? apiData.newBalance : balance - amount;
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
        status: 'pending'
      },
      escrowStatus: 'funded',
    });

    return record;
  }, [balance, persist, logTransaction, getAccessToken]);

  // Release escrowed funds to hunter when bounty is completed
  // Calls the backend API to capture PaymentIntent and transfer to hunter's Connect account
  const releaseFunds = useCallback(async (bountyId: string | number, hunterId: string, title: string) => {
    try {
      // Find the local escrow transaction for this bounty
      const bountyIdStr = String(bountyId);
      const escrowTx = transactions.find(
        tx => tx.type === 'escrow' && String(tx.details.bounty_id) === bountyIdStr && tx.escrowStatus === 'funded'
      );

      if (!escrowTx) {
        console.error('No funded escrow found for bounty:', bountyId);
        return false;
      }

      // Get the bounty to retrieve the payment_intent_id (escrowId)
      const bountyData = await bountyService.getById(bountyId);
      
      if (!bountyData || !bountyData.payment_intent_id) {
        console.error('No payment_intent_id found for bounty:', bountyId);
        return false;
      }
      
      // Call the backend API to release escrow
      // This will capture the PaymentIntent and transfer to hunter's Connect account
      const releaseResult = await paymentService.releaseEscrow(bountyData.payment_intent_id);
      
      if (!releaseResult.success) {
        console.error('Failed to release escrow:', releaseResult.error);
        return false;
      }

      const grossAmount = Math.abs(escrowTx.amount);
      const platformFee = releaseResult.platformFee || (grossAmount * PLATFORM_FEE_PERCENTAGE);
      const netAmount = releaseResult.hunterAmount || (grossAmount - platformFee);

      // Update local escrow transaction status
      setTransactions(prev => {
        const next = prev.map(tx => 
          tx.id === escrowTx.id ? ({ ...tx, escrowStatus: 'released', details: { ...tx.details, status: 'completed' } } as WalletTransactionRecord) : tx
        ) as WalletTransactionRecord[];
        persistTransactions(next);
        return next;
      });

      // Log platform fee transaction (for local record keeping)
      await logTransaction({
        type: 'platform_fee',
        amount: -platformFee, // negative as it's a deduction
        details: { 
          title: 'Platform Service Fee',
          bounty_id: bountyIdStr,
          fee_percentage: PLATFORM_FEE_PERCENTAGE * 100,
          status: 'completed'
        },
          // Prepare idempotency key for release
          const idempotencyKey = `release_${bountyId}_${hunterId}`;

          // If offline, enqueue the release operation instead of calling network
          if (!offlineQueueService.getOnlineStatus()) {
            // Optimistic local update: mark escrow as processing so UI shows pending
            setTransactions(prev => {
              const next = prev.map(tx => 
                tx.id === escrowTx.id ? ({ ...tx, escrowStatus: 'processing', details: { ...tx.details, status: 'processing' } } as WalletTransactionRecord) : tx
              ) as WalletTransactionRecord[];
              persistTransactions(next);
              return next;
            });

            await offlineQueueService.enqueue('operation', {
              opType: 'release_escrow',
              payload: {
                escrowId: bountyData.payment_intent_id,
                bountyId: bountyIdStr,
                hunterId,
                title,
              },
              idempotencyKey,
            });

            // Log optimistic local transactions (platform fee + release) as pending entries
            await logTransaction({
              type: 'platform_fee',
              amount: -Math.abs(escrowTx.amount) * PLATFORM_FEE_PERCENTAGE,
              details: { title: 'Platform Service Fee', bounty_id: bountyIdStr, status: 'pending' },
            });

            await logTransaction({
              type: 'release',
              amount: Math.abs(escrowTx.amount) * (1 - PLATFORM_FEE_PERCENTAGE),
              details: { title, bounty_id: bountyIdStr, counterparty: hunterId, status: 'pending' },
            });

            return true;
          }

          // Call the backend API to release escrow (online path)
          // This will capture the PaymentIntent and transfer to hunter's Connect account
          const releaseResult = await paymentService.releaseEscrow(bountyData.payment_intent_id);

          if (!releaseResult.success) {
            console.error('Failed to release escrow:', releaseResult.error);
            return false;
          }
          bounty_id: bountyIdStr,
          counterparty: hunterId,
          gross_amount: grossAmount,
          platform_fee: platformFee,
          status: 'completed'
        },
      });

      return true;
    } catch (error) {
      console.error('Error releasing funds:', error);
      return false;
    }
  }, [transactions, logTransaction, persistTransactions]);

  // Refund escrowed funds back to poster when bounty is cancelled
  const refundEscrow = useCallback(async (bountyId: string | number, title: string, refundPercentage: number = 100) => {
    try {
      // Find the local escrow transaction for this bounty
      const bountyIdStr = String(bountyId);
      const escrowTx = transactions.find(
        tx => tx.type === 'escrow' && String(tx.details.bounty_id) === bountyIdStr && tx.escrowStatus === 'funded'
      );

      if (!escrowTx) {
        console.error('No funded escrow found for bounty:', bountyId);
        return false;
      }

      // Get the bounty to retrieve the payment_intent_id (escrowId)
      const bountyData = await bountyService.getById(bountyId);

      if (!bountyData || !bountyData.payment_intent_id) {
        console.error('No payment_intent_id found for bounty:', bountyId);
        return false;
      }

      // Prepare idempotency key for release
      const idempotencyKey = `release_${bountyId}_${hunterId}`;

      // If offline, enqueue the release operation instead of calling network
      if (!offlineQueueService.getOnlineStatus()) {
        // Optimistic local update: mark escrow as processing so UI shows pending
        setTransactions(prev => {
          const next = prev.map(tx => 
            tx.id === escrowTx.id ? ({ ...tx, escrowStatus: 'processing', details: { ...tx.details, status: 'processing' } } as WalletTransactionRecord) : tx
          ) as WalletTransactionRecord[];
          persistTransactions(next);
          return next;
        });

        await offlineQueueService.enqueue('operation', {
          opType: 'release_escrow',
          payload: {
            escrowId: bountyData.payment_intent_id,
            bountyId: bountyIdStr,
            hunterId,
            title,
          },
          idempotencyKey,
        });

        // Log optimistic local transactions (platform fee + release) as pending entries
        await logTransaction({
          type: 'platform_fee',
          amount: -Math.abs(escrowTx.amount) * PLATFORM_FEE_PERCENTAGE,
          details: { title: 'Platform Service Fee', bounty_id: bountyIdStr, status: 'pending' },
        });

        await logTransaction({
          type: 'release',
          amount: Math.abs(escrowTx.amount) * (1 - PLATFORM_FEE_PERCENTAGE),
          details: { title, bounty_id: bountyIdStr, counterparty: hunterId, status: 'pending' },
        });

        return true;
      }

      // Online path: call the backend API to release escrow
      const releaseResult = await paymentService.releaseEscrow(bountyData.payment_intent_id);

      if (!releaseResult.success) {
        console.error('Failed to release escrow:', releaseResult.error);
        return false;
      }

      const grossAmount = Math.abs(escrowTx.amount);
      const platformFee = releaseResult.platformFee || (grossAmount * PLATFORM_FEE_PERCENTAGE);
      const netAmount = releaseResult.hunterAmount || (grossAmount - platformFee);

      // Update local escrow transaction status
      setTransactions(prev => {
        const next = prev.map(tx => 
          tx.id === escrowTx.id ? ({ ...tx, escrowStatus: 'released', details: { ...tx.details, status: 'completed' } } as WalletTransactionRecord) : tx
        ) as WalletTransactionRecord[];
        persistTransactions(next);
        return next;
      });

      // Log platform fee transaction (for local record keeping)
      await logTransaction({
        type: 'platform_fee',
        amount: -platformFee, // negative as it's a deduction
        details: { 
          title: 'Platform Service Fee',
          bounty_id: bountyIdStr,
          fee_percentage: PLATFORM_FEE_PERCENTAGE * 100,
          status: 'completed'
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
          status: 'completed'
        },
      });

      return true;
    } catch (error) {
      console.error('Error releasing funds:', error);
      return false;
    }
