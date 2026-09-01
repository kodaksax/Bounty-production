// hooks/useAdminBounties.ts - Hook for managing admin bounty data
import { useCallback } from 'react';
import { adminDataClient } from '../lib/admin/adminDataClient';
import type { AdminBounty, AdminBountyFilters } from '../lib/types-admin';
import { useAdminList, type UseAdminListResult } from './useAdminList';

export interface UseAdminBountiesResult extends UseAdminListResult<AdminBounty> {
  bounties: AdminBounty[];
  updateStatus: (id: string, status: AdminBounty['status']) => Promise<void>;
}

const getBountyId = (b: AdminBounty) => b.id;

export function useAdminBounties(filters?: AdminBountyFilters): UseAdminBountiesResult {
  const list = useAdminList<AdminBounty, AdminBountyFilters>({
    filters: filters ?? {},
    fetcher: adminDataClient.fetchAdminBounties.bind(adminDataClient),
    getId: getBountyId,
    // Debounced because the bounties screen feeds a search box into `filters`.
    debounceMs: 250,
  });

  const { patchItem, refetch } = list;

  const updateStatus = useCallback(
    async (id: string, status: AdminBounty['status']) => {
      // Optimistic: a status flip is a single scalar the server either accepts
      // or rejects outright, so a local patch is safe to show immediately.
      patchItem(id, { status, lastModified: new Date().toISOString() });
      try {
        await adminDataClient.updateBountyStatus(id, status);
      } finally {
        // Refetch either way: on success to pick up server-side side effects,
        // on failure to roll the optimistic patch back to the real value.
        // `refetch` also re-applies the active status filter, so a bounty that
        // no longer matches drops out of the list instead of lingering.
        await refetch();
      }
    },
    [patchItem, refetch]
  );

  return { ...list, bounties: list.items, updateStatus };
}
