// hooks/useAdminUsers.ts - Hook for managing admin user data
import { adminDataClient } from '../lib/admin/adminDataClient';
import type { AdminUserFilters, AdminUserSummary } from '../lib/types-admin';
import { useAdminList, type UseAdminListResult } from './useAdminList';

export interface UseAdminUsersResult extends UseAdminListResult<AdminUserSummary> {
  users: AdminUserSummary[];
}

const getUserId = (u: AdminUserSummary) => u.id;

export function useAdminUsers(filters?: AdminUserFilters): UseAdminUsersResult {
  const list = useAdminList<AdminUserSummary, AdminUserFilters>({
    filters: filters ?? {},
    fetcher: adminDataClient.fetchAdminUsers.bind(adminDataClient),
    getId: getUserId,
    debounceMs: 250,
  });

  return { ...list, users: list.items };
}
