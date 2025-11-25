import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { API_BASE_URL } from './config/api';

// Local transaction shape (subset aligning with transaction history component)
export type WalletTransactionType = 'deposit' | 'withdrawal' | 'bounty_posted' | 'bounty_completed' | 'bounty_received' | 'escrow' | 'release' | 'refund';
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

const STORAGE_KEY = 'wallet:balance:v1';
const TX_STORAGE_KEY = 'wallet:transactions:v1';
const INITIAL_BALANCE = 40; // starting placeholder

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [balance, setBalance] = useState<number>(INITIAL_BALANCE);
  const [isLoading, setIsLoading] = useState(true);
  const [transactions, setTransactions] = useState<WalletTransactionRecord[]>([]);

  const persist = useCallback(async (value: number) => {
    try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {}
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rawBalance, rawTx] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(TX_STORAGE_KEY),
      ]);
      if (rawBalance) setBalance(JSON.parse(rawBalance));
      else await persist(INITIAL_BALANCE);

      if (rawTx) {
        try {
          const parsed: any[] = JSON.parse(rawTx);
            setTransactions(parsed.map(t => ({ ...t, date: new Date(t.date) })));
        } catch {}
      }
    } catch {}
    setIsLoading(false);
  }, [persist]);

  useEffect(() => { refresh(); }, [refresh]);

  const persistTransactions = useCallback(async (list: WalletTransactionRecord[]) => {
    try { await AsyncStorage.setItem(TX_STORAGE_KEY, JSON.stringify(list)); } catch {}
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
    try { await AsyncStorage.removeItem(TX_STORAGE_KEY); } catch {}
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

    const amount = Math.abs(escrowTx.amount);

    // Update escrow transaction status
    setTransactions(prev => {
      const next = prev.map(tx => 
        tx.id === escrowTx.id ? ({ ...tx, escrowStatus: 'released', details: { ...tx.details, status: 'completed' } } as WalletTransactionRecord) : tx
      ) as WalletTransactionRecord[];
      persistTransactions(next);
      return next;
    });

    // Log release transaction (this would go to hunter's wallet in real system)
    await logTransaction({
      type: 'release',
      amount: amount, // positive for the release record
      details: { 
        title,
        bounty_id: String(bountyId),
        counterparty: hunterId,
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
