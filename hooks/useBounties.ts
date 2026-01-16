import { useCallback, useEffect, useMemo, useState } from 'react';
import { bountyService } from '../lib/services/bounty-service';
import { CACHE_KEYS } from '../lib/services/cached-data-service';
import type { Bounty } from '../lib/services/database.types';
import { logger } from '../lib/utils/error-logger';
import { useCachedData } from './useCachedData';
import { useWebSocketEvent } from './useWebSocket';

/**
 * WebSocket bounty status update event
 */
interface BountyStatusEvent {
  id: string | number;
  status: Bounty['status'];
  timestamp?: string;
}

export interface BountiesState {
  bounties: Bounty[];
  loading: boolean;
  isValidating?: boolean;
  error: string | null;
}

export interface BountiesActions {
  refreshBounties: () => Promise<void>;
  updateBountyStatus: (id: string | number, status: Bounty['status']) => Promise<void>;
  addBounty: (bounty: Bounty) => void;
  removeBounty: (id: string | number) => void;
}

export interface UseBountiesOptions {
  status?: string;
  userId?: string;
  autoRefresh?: boolean;
  optimisticUpdates?: boolean;
}

/**
 * Hook to manage bounties with WebSocket real-time updates and SWR
 * 
 * Features:
 * - Real-time WebSocket updates for bounty status changes
 * - Optimistic UI updates with automatic rollback on failure
 * - Multi-client synchronization
 * - Automatic refresh on reconnection
 * 
 * @example
 * ```tsx
  * const { bounties, loading, error, updateBountyStatus, refreshBounties } = useBounties({
    *   status: 'open',
    *   optimisticUpdates: true
 * });
 * 
 * // Update bounty status with optimistic UI
 * await updateBountyStatus(bountyId, 'in_progress');
 * ```
 */
export function useBounties(options: UseBountiesOptions = {}): BountiesState & BountiesActions {
  const {
    status,
    userId,
    autoRefresh = true,
    optimisticUpdates = true
  } = options;

  // SWR-based data fetching
  const cacheKey = useMemo(() =>
    userId ? `bounties_user_${userId}_${status || 'all'} ` : CACHE_KEYS.BOUNTIES_LIST + (status ? `_${status} ` : ''),
    [userId, status]
  );

  const fetchFn = useCallback(() => bountyService.getAll({ status, userId }), [status, userId]);

  const {
    data: fetchedBounties,
    isLoading: loading,
    isValidating,
    error: fetchError,
    refetch
  } = useCachedData<Bounty[]>(cacheKey, fetchFn);

  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Sync local state with cached data
  useEffect(() => {
    if (fetchedBounties) {
      setBounties(fetchedBounties);
    }
  }, [fetchedBounties]);

  useEffect(() => {
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setError(null); // Clear error if fetch was successful
    }
  }, [fetchError]);

  // Store for optimistic updates rollback
  const [optimisticUpdatesMap] = useState<Map<number, Bounty>>(new Map());

  /**
   * Refresh bounties (public API)
   */
  const refreshBounties = useCallback(async () => {
    await refetch();
  }, [refetch]);

  /**
   * Add a new bounty to the local state (for optimistic updates)
   */
  const addBounty = useCallback((bounty: Bounty) => {
    setBounties((prev) => [bounty, ...prev]);
  }, []);

  /**
   * Remove a bounty from the local state
   */
  const removeBounty = useCallback((id: string | number) => {
    const numericId = typeof id === 'string' ? parseInt(id, 10) : id;
    setBounties((prev) => prev.filter((b) => String(b.id) !== String(numericId)));
  }, []);

  /**
   * Update a bounty's status with optimistic UI updates
   */
  const updateBountyStatus = useCallback(
    async (id: string | number, newStatus: Bounty['status']) => {
      if (!newStatus) {
        logger.error('updateBountyStatus called with invalid status', { id, newStatus });
        return;
      }

      // Normalize id to number for consistent comparisons
      const numericId = typeof id === 'string' ? parseInt(id, 10) : id;
      let previousBounty: Bounty | undefined;

      if (optimisticUpdates) {
        // Store previous state for rollback
        previousBounty = bounties.find((b) => String(b.id) === String(numericId));
        if (previousBounty) {
          optimisticUpdatesMap.set(Number(String(numericId)), previousBounty);
        }

        // Optimistically update UI
        setBounties((prev) =>
          prev.map((b) => (String(b.id) === String(numericId) ? { ...b, status: newStatus } : b))
        );
      }

      try {
        // Make the actual API call
        const updated = await bountyService.updateStatus(
          numericId,
          newStatus
        );

        if (!updated) {
          throw new Error('Failed to update bounty status');
        }

        // Clear optimistic update cache on success
        optimisticUpdatesMap.delete(Number(String(numericId)));

        // Update with the actual response data
        setBounties((prev) =>
          prev.map((b) => (String(b.id) === String(numericId) ? updated : b))
        );
      } catch (err) {
        logger.error('Error updating bounty status', { id, newStatus, error: err });

        // Rollback optimistic update on failure
        if (optimisticUpdates && previousBounty) {
          setBounties((prev) =>
            prev.map((b) => (String(b.id) === String(numericId) ? previousBounty : b))
          );
        }

        // Clear from cache
        optimisticUpdatesMap.delete(Number(String(numericId)));

        throw err;
      }
    },
    [bounties, optimisticUpdates, optimisticUpdatesMap]
  );

  /**
   * Handle real-time bounty status updates from WebSocket
   */
  const handleBountyStatusUpdate = useCallback(
    (data: BountyStatusEvent) => {
      if (!data || !data.id || !data.status) {
        logger.warning('Received invalid bounty status update', { data });
        return;
      }

      const { id, status: newStatus } = data;

      // Update the bounty in local state if it exists
      setBounties((prev) => {
        const bountyExists = prev.some((b) => String(b.id) === String(id));

        if (bountyExists) {
          // Update existing bounty
          return prev.map((b) =>
            String(b.id) === String(id) ? { ...b, status: newStatus } : b
          );
        }

        // If filtering by status and new status doesn't match, skip
        if (status && newStatus !== status) {
          return prev;
        }

        // If filtering by userId, trigger a refresh to get the full bounty details
        // Don't try to add it without complete data
        return prev;
      });

      // If we need to refresh for userId filter, do it outside of setState
      if (userId && autoRefresh) {
        refetch().catch((err) => {
          logger.error('Error refreshing bounties after WebSocket update', { error: err });
        });
      }

      logger.info('Bounty status updated via WebSocket', { id, status: newStatus });
    },
    [status, userId, autoRefresh, refetch]
  );

  // Subscribe to WebSocket events for real-time updates
  // Memoize the handler to prevent unnecessary subscription cycles
  useEffect(() => {
    useWebSocketEvent('bounty.status', handleBountyStatusUpdate);
  }, [handleBountyStatusUpdate]);

  return {
    bounties,
    loading,
    isValidating,
    error,
    refreshBounties,
    updateBountyStatus,
    addBounty,
    removeBounty,
  };
}
