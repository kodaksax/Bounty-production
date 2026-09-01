// hooks/useAdminTransactions.ts - Hook for managing admin transaction data
import { adminDataClient } from '../lib/admin/adminDataClient';
import type { AdminTransaction, AdminTransactionFilters } from '../lib/types-admin';
import { useAdminList, type UseAdminListResult } from './useAdminList';

export interface UseAdminTransactionsResult extends UseAdminListResult<AdminTransaction> {
  transactions: AdminTransaction[];
}

const getTransactionId = (t: AdminTransaction) => t.id;

export function useAdminTransactions(
  filters?: AdminTransactionFilters
): UseAdminTransactionsResult {
  const list = useAdminList<AdminTransaction, AdminTransactionFilters>({
    filters: filters ?? {},
    fetcher: adminDataClient.fetchAdminTransactions.bind(adminDataClient),
    getId: getTransactionId,
    debounceMs: 250,
  });

  return { ...list, transactions: list.items };
}
