import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { API_BASE_URL } from './config/api';
import { getSecureJSON, setSecureJSON, SecureKeys } from './utils/secure-storage';

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
  const [isLoading, setIsLoading] = useState(true);
  const [transactions, setTransactions] = useState<WalletTransactionRecord[]>([]);

  const persist = useCallback(async (value: number) => {
    try { 
      await setSecureJSON(SecureKeys.WALLET_BALANCE, value); 
    } catch (error) {
      console.error('[wallet] Error persisting balance:', error);
    }
  }, []);

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

  useEffect(() => { refresh(); }, [refresh]);

  const persistTransactions = useCallback(async (list: WalletTransactionRecord[]) => {
    try { 
      await setSecureJSON(SecureKeys.WALLET_TRANSACTIONS, list); 
    } catch (error) {
      console.error('[wallet] Error persisting transactions:', error);
    }
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
    setBalance(prev => {
      const next = prev + amount;
      persist(next);
      return next;
    });
    await logTransaction({
      type: 'deposit',
      amount: amount, // inflow positive
      details: { method: meta?.method, ...meta },
    });
  }, [persist, logTransaction]);

  const withdraw = useCallback(async (amount: number, meta?: Partial<WalletTransactionRecord['details']>) => {
    if (amount <= 0 || Number.isNaN(amount)) return false;
    let success = false;
    setBalance(prev => {
      if (prev >= amount) {
        const next = prev - amount;
        persist(next);
        success = true;
        return next;
      }
      success = false;
      return prev;
    });
    if (success) {
      await logTransaction({
        type: 'withdrawal',
        amount: -amount, // outflow negative
        details: { method: meta?.method, ...meta },
      });
    }
    return success;
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

    // Deduct from balance
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
        bounty_id: String(bountyId),
        status: 'pending'
      },
      escrowStatus: 'funded',
    });

    return record;
  }, [balance, persist, logTransaction]);

  // Release escrowed funds to hunter when bounty is completed
  // Service fee is deducted here (NOT at withdrawal) for transparency
  const releaseFunds = useCallback(async (bountyId: string | number, hunterId: string, title: string) => {
    // Find the escrow transaction for this bounty (compare as strings to handle UUIDs)
    const bountyIdStr = String(bountyId);
    const escrowTx = transactions.find(
      tx => tx.type === 'escrow' && String(tx.details.bounty_id) === bountyIdStr && tx.escrowStatus === 'funded'
    );

    if (!escrowTx) {
      console.error('No funded escrow found for bounty:', bountyId);
      return false;
    }

    const grossAmount = Math.abs(escrowTx.amount);
    
    // Calculate platform fee (deducted at bounty completion, not withdrawal)
    const platformFee = grossAmount * PLATFORM_FEE_PERCENTAGE;
    const netAmount = grossAmount - platformFee;

    // Update escrow transaction status
    setTransactions(prev => {
      const next = prev.map(tx => 
        tx.id === escrowTx.id ? ({ ...tx, escrowStatus: 'released', details: { ...tx.details, status: 'completed' } } as WalletTransactionRecord) : tx
      ) as WalletTransactionRecord[];
      persistTransactions(next);
      return next;
    });

    // Log platform fee transaction (for record keeping)
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
    // In a real system, this would go to hunter's wallet
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
  }, [transactions, logTransaction, persistTransactions]);

  // Refund escrowed funds back to poster when bounty is cancelled
  const refundEscrow = useCallback(async (bountyId: string | number, title: string, refundPercentage: number = 100) => {
    // Find the escrow transaction for this bounty
    const bountyIdStr = String(bountyId);
    const escrowTx = transactions.find(
      tx => tx.type === 'escrow' && String(tx.details.bounty_id) === bountyIdStr && tx.escrowStatus === 'funded'
    );

    if (!escrowTx) {
      console.error('No funded escrow found for bounty:', bountyId);
      return false;
    }

    const escrowAmount = Math.abs(escrowTx.amount);
    const refundAmount = (escrowAmount * refundPercentage) / 100;

    // Update escrow transaction status
    setTransactions(prev => {
      const next = prev.map(tx => 
        tx.id === escrowTx.id ? ({ ...tx, escrowStatus: 'released', details: { ...tx.details, status: 'refunded' } } as WalletTransactionRecord) : tx
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

    return true;
  }, [transactions, persistTransactions, logTransaction, persist]);

  // Refresh wallet data from the API (fetches real transaction history and balance)
  const refreshFromApi = useCallback(async (accessToken?: string) => {
    if (!accessToken) {
      console.log('[wallet] No access token provided, skipping API refresh');
      return;
    }

    setIsLoading(true);
    try {
      // Fetch balance from API
      const balanceResponse = await fetch(`${API_BASE_URL}/wallet/balance`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (balanceResponse.ok) {
        const balanceData = await balanceResponse.json();
        setBalance(balanceData.balance);
        await persist(balanceData.balance);
      }

      // Fetch transactions from API
      const txResponse = await fetch(`${API_BASE_URL}/wallet/transactions?limit=100`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
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

          // Merge with local transactions (API transactions take precedence)
          const apiTxIds = new Set(mappedTransactions.map(tx => tx.id));
          const localOnlyTx = transactions.filter(tx => !apiTxIds.has(tx.id));
          const mergedTransactions = [...mappedTransactions, ...localOnlyTx];
          
          // Sort by date descending
          mergedTransactions.sort((a, b) => b.date.getTime() - a.date.getTime());

          setTransactions(mergedTransactions);
          await persistTransactions(mergedTransactions);
        }
      }
    } catch (error) {
      console.error('[wallet] Error refreshing from API:', error);
      // Fall back to local data
    } finally {
      setIsLoading(false);
    }
  }, [persist, persistTransactions, transactions]);

  const value: WalletContextValue = {
    balance,
    isLoading,
    deposit,
    withdraw,
    setBalance: (amt: number) => { setBalance(amt); persist(amt); },
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
