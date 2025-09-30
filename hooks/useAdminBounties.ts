// hooks/useAdminBounties.ts - Hook for managing admin bounty data
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminDataClient } from '../lib/admin/adminDataClient';
import type { AdminBounty, AdminBountyFilters } from '../lib/types-admin';

interface UseAdminBountiesResult {
  bounties: AdminBounty[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateStatus: (id: string, status: AdminBounty['status']) => Promise<void>;
}

export function useAdminBounties(filters?: AdminBountyFilters): UseAdminBountiesResult {
  const [bounties, setBounties] = useState<AdminBounty[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetchBounties = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminDataClient.fetchAdminBounties(filtersRef.current);
      setBounties(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch bounties');
      console.error('Error fetching admin bounties:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBounties();
  }, [fetchBounties]);

  const updateStatus = useCallback(
    async (id: string, status: AdminBounty['status']) => {
      try {
        // Optimistic update
        setBounties((prev) =>
          prev.map((b) => (b.id === id ? { ...b, status, lastModified: new Date().toISOString() } : b))
        );

        // Actual update
        await adminDataClient.updateBountyStatus(id, status);

        // Refetch to ensure consistency
        await fetchBounties();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update bounty status');
        console.error('Error updating bounty status:', err);
        // Revert optimistic update on error
        await fetchBounties();
      }
    },
    [fetchBounties]
  );

  return {
    bounties,
    isLoading,
    error,
    refetch: fetchBounties,
    updateStatus,
  };
}
