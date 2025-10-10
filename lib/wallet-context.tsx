import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// Local transaction shape (subset aligning with transaction history component)
export type WalletTransactionType = 'deposit' | 'withdrawal' | 'bounty_posted' | 'bounty_completed' | 'bounty_received';
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
    bounty_id?: number;
  };
  disputeStatus?: "none" | "pending" | "resolved";
}

interface WalletContextValue {
  balance: number;
  isLoading: boolean;
  deposit: (amount: number, meta?: Partial<WalletTransactionRecord['details']>) => Promise<void>;
  withdraw: (amount: number, meta?: Partial<WalletTransactionRecord['details']>) => Promise<boolean>; // false if insufficient
  setBalance: (amount: number) => void;
  refresh: () => Promise<void>;
  transactions: WalletTransactionRecord[];
  logTransaction: (tx: Omit<WalletTransactionRecord, 'id' | 'date'> & { date?: Date }) => Promise<WalletTransactionRecord>;
  clearAllTransactions: () => Promise<void>;
  updateDisputeStatus: (transactionId: string, status: "none" | "pending" | "resolved") => Promise<void>;
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

  const value: WalletContextValue = {
    balance,
    isLoading,
    deposit,
    withdraw,
    setBalance: (amt: number) => { setBalance(amt); persist(amt); },
    refresh,
    transactions,
    logTransaction,
    clearAllTransactions,
    updateDisputeStatus,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = (): WalletContextValue => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
};
