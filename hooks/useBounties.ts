import { useCallback, useEffect, useState } from 'react';
import { bountyService } from '../lib/services/bounty-service';
import type { Bounty } from '../lib/services/database.types';
import { logger } from '../lib/utils/error-logger';
import { useWebSocketEvent } from './useWebSocket';

export interface BountiesState {
  bounties: Bounty[];
  loading: boolean;
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
 * Hook to manage bounties with WebSocket real-time updates
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

  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Store for optimistic updates rollback
  const [optimisticUpdates_map] = useState<Map<string | number, Bounty>>(new Map());

  /**
   * Fetch bounties from the service
   */
  const fetchBounties = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const fetchedBounties = await bountyService.getAll({
        status,
        userId,
      });

      setBounties(fetchedBounties);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch bounties';
      setError(errorMessage);
      logger.error('Error fetching bounties in useBounties', { error: err });
    } finally {
      setLoading(false);
    }
  }, [status, userId]);

  /**
   * Refresh bounties (public API)
   */
  const refreshBounties = useCallback(async () => {
    await fetchBounties();
  }, [fetchBounties]);

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
    setBounties((prev) => prev.filter((b) => b.id !== id));
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

      let previousBounty: Bounty | undefined;

      if (optimisticUpdates) {
        // Store previous state for rollback
        previousBounty = bounties.find((b) => b.id === id);
        if (previousBounty) {
          optimisticUpdates_map.set(id, previousBounty);
        }

        // Optimistically update UI
        setBounties((prev) =>
          prev.map((b) => (b.id === id ? { ...b, status: newStatus } : b))
        );
      }

      try {
        // Make the actual API call
        const updated = await bountyService.updateStatus(
          typeof id === 'string' ? parseInt(id, 10) : id,
          newStatus
        );

        if (!updated) {
          throw new Error('Failed to update bounty status');
        }

        // Clear optimistic update cache on success
        optimisticUpdates_map.delete(id);

        // Update with the actual response data
        setBounties((prev) =>
          prev.map((b) => (b.id === id ? updated : b))
        );
      } catch (err) {
        logger.error('Error updating bounty status', { id, newStatus, error: err });

        // Rollback optimistic update on failure
        if (optimisticUpdates && previousBounty) {
          setBounties((prev) =>
            prev.map((b) => (b.id === id ? previousBounty : b))
          );
        }

        // Clear from cache
        optimisticUpdates_map.delete(id);

        throw err;
      }
    },
    [bounties, optimisticUpdates, optimisticUpdates_map]
  );

  /**
   * Handle real-time bounty status updates from WebSocket
   */
  const handleBountyStatusUpdate = useCallback(
    (data: any) => {
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

        // If filtering by userId, we can't add without knowing the bounty details
        // In this case, trigger a refresh to be safe
        if (userId && autoRefresh) {
          fetchBounties().catch((err) => {
            logger.error('Error refreshing bounties after WebSocket update', { error: err });
          });
          return prev;
        }

        return prev;
      });

      logger.info('Bounty status updated via WebSocket', { id, status: newStatus });
    },
    [status, userId, autoRefresh, fetchBounties]
  );

  // Subscribe to WebSocket events for real-time updates
  useWebSocketEvent('bounty.status', handleBountyStatusUpdate);

  // Initial fetch on mount or when dependencies change
  useEffect(() => {
    fetchBounties();
  }, [fetchBounties]);

  return {
    bounties,
    loading,
    error,
    refreshBounties,
    updateBountyStatus,
    addBounty,
    removeBounty,
  };
}
