// hooks/useAdminTransactions.ts - Hook for managing admin transaction data
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminDataClient } from '../lib/admin/adminDataClient';
import type { AdminTransaction, AdminTransactionFilters } from '../lib/types-admin';

interface UseAdminTransactionsResult {
  transactions: AdminTransaction[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAdminTransactions(filters?: AdminTransactionFilters): UseAdminTransactionsResult {
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminDataClient.fetchAdminTransactions(filtersRef.current);
      setTransactions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch transactions');
      console.error('Error fetching admin transactions:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  return {
    transactions,
    isLoading,
    error,
    refetch: fetchTransactions,
  };
}
