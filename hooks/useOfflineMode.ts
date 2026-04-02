/**
 * useOfflineMode Hook
 * Detects offline/online status and provides utilities for offline mode
 * Integrates with the existing offline queue service
 *
 * When wrapped in a NetworkProvider (recommended), this hook reads from the
 * centralized context, eliminating redundant NetInfo subscriptions. Falls
 * back to its own NetInfo subscription when used outside a provider.
 */

import { useEffect, useState, useCallback } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { offlineQueueService } from '../lib/services/offline-queue-service';
import { useOptionalNetworkContext } from '../providers/network-provider';

export interface OfflineMode {
  /**
   * Current online/offline status
   */
  isOnline: boolean;
  
  /**
   * Whether we're currently checking connectivity
   */
  isChecking: boolean;
  
  /**
   * Number of items queued for when we come back online
   */
  queuedItemsCount: number;
  
  /**
   * Manually trigger a connectivity check
   */
  checkConnection: () => Promise<void>;
  
  /**
   * Force process the offline queue
   */
  processQueue: () => void;
}

/**
 * Hook to detect and manage offline mode
 * 
 * Features:
 * - Real-time online/offline detection
 * - Queue status monitoring
 * - Manual connectivity checks
 * 
 * @example
 * ```tsx
 * const { isOnline, queuedItemsCount } = useOfflineMode();
 * 
 * if (!isOnline) {
 *   return <OfflineBanner queuedItems={queuedItemsCount} />;
 * }
 * ```
 */
export function useOfflineMode(): OfflineMode {
  const networkCtx = useOptionalNetworkContext();
  const [localIsOnline, setLocalIsOnline] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [queuedItemsCount, setQueuedItemsCount] = useState(0);

  // Derive online status from provider when available, otherwise use local state.
  // When using the provider, treat `isInternetReachable === false` as offline,
  // and `null`/`undefined` as unknown (optimistically online) to match
  // connectivity semantics used elsewhere in the app.
  const isOnline = networkCtx
    ? networkCtx.isConnected && networkCtx.isInternetReachable !== false
    : localIsOnline;

  // Update queued items count
  const updateQueueCount = useCallback(() => {
    const queue = offlineQueueService.getQueue();
    const pendingCount = queue.filter(
      item => item.status === 'pending' || item.status === 'processing'
    ).length;
    setQueuedItemsCount(pendingCount);
  }, []);

  // Listen for network state changes — only subscribe when no provider is present
  useEffect(() => {
    if (networkCtx) return; // Provider handles subscriptions centrally

    // Initial state check
    NetInfo.fetch().then((state: NetInfoState) => {
      setLocalIsOnline(!!state.isConnected);
    });

    // Subscribe to network state changes
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setLocalIsOnline(!!state.isConnected);
    });

    return () => {
      unsubscribe();
    };
  }, [networkCtx]);

  // Listen for queue changes
  useEffect(() => {
    // Initial count
    updateQueueCount();

    // Subscribe to queue changes
    const unsubscribe = offlineQueueService.addListener(() => {
      updateQueueCount();
    });

    return () => {
      try {
        unsubscribe();
      } catch (error) {
        // Ignore unsubscribe errors
      }
    };
  }, [updateQueueCount]);

  // Manual connectivity check — delegate to provider when available
  const checkConnection = useCallback(async () => {
    if (networkCtx) {
      await networkCtx.checkConnection();
      // If online after check, try to process the queue
      // (networkCtx.isConnected will update via context on next render)
      offlineQueueService.processQueue();
      return;
    }

    setIsChecking(true);
    try {
      const state = await NetInfo.fetch();
      setLocalIsOnline(!!state.isConnected);
      
      // If online, try to process the queue
      if (state.isConnected) {
        offlineQueueService.processQueue();
      }
    } catch (error) {
      console.error('[useOfflineMode] Failed to check connection:', error);
    } finally {
      setIsChecking(false);
    }
  }, [networkCtx]);

  // Force process queue
  const processQueue = useCallback(() => {
    if (isOnline) {
      offlineQueueService.processQueue();
    }
  }, [isOnline]);

  return {
    isOnline,
    isChecking: networkCtx ? networkCtx.isChecking : isChecking,
    queuedItemsCount,
    checkConnection,
    processQueue,
  };
}

/**
 * Simple hook that just returns online status
 * For cases where you only need to know if we're online.
 * Uses the centralized NetworkProvider when available.
 */
export function useIsOnline(): boolean {
  const networkCtx = useOptionalNetworkContext();
  const [localIsOnline, setLocalIsOnline] = useState(true);

  useEffect(() => {
    if (networkCtx) return; // Provider handles subscriptions centrally

    // Initial state
    NetInfo.fetch().then((state: NetInfoState) => {
      setLocalIsOnline(!!state.isConnected);
    });

    // Subscribe to changes
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setLocalIsOnline(!!state.isConnected);
    });

    return () => {
      unsubscribe();
    };
  }, [networkCtx]);

  return networkCtx
    ? networkCtx.isConnected && networkCtx.isInternetReachable !== false
    : localIsOnline;
}
