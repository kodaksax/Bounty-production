// hooks/useAdminUsers.ts - Hook for managing admin user data
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminDataClient } from '../lib/admin/adminDataClient';
import type { AdminUserFilters, AdminUserSummary } from '../lib/types-admin';

interface UseAdminUsersResult {
  users: AdminUserSummary[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAdminUsers(filters?: AdminUserFilters): UseAdminUsersResult {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminDataClient.fetchAdminUsers(filtersRef.current);
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
      console.error('Error fetching admin users:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return {
    users,
    isLoading,
    error,
    refetch: fetchUsers,
  };
}
