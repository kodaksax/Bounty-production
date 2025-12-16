/**
 * useOfflineMode Hook
 * Detects offline/online status and provides utilities for offline mode
 * Integrates with the existing offline queue service
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { offlineQueueService } from '../lib/services/offline-queue-service';

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
  const [isOnline, setIsOnline] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [queuedItemsCount, setQueuedItemsCount] = useState(0);
  const prevOnlineStatus = useRef(true);

  // Update queued items count
  const updateQueueCount = useCallback(() => {
    const queue = offlineQueueService.getQueue();
    const pendingCount = queue.filter(
      item => item.status === 'pending' || item.status === 'processing'
    ).length;
    setQueuedItemsCount(pendingCount);
  }, []);

  // Listen for network state changes
  useEffect(() => {
    // Initial state check
    NetInfo.fetch().then((state: NetInfoState) => {
      setIsOnline(!!state.isConnected);
      prevOnlineStatus.current = !!state.isConnected;
    });

    // Subscribe to network state changes
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const wasOffline = !prevOnlineStatus.current;
      const isNowOnline = !!state.isConnected;
      
      prevOnlineStatus.current = isNowOnline;
      setIsOnline(isNowOnline);

      // Log connectivity change
      if (wasOffline && isNowOnline) {
      } else if (!wasOffline && !isNowOnline) {
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

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

  // Manual connectivity check
  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    try {
      const state = await NetInfo.fetch();
      setIsOnline(!!state.isConnected);
      
      // If online, try to process the queue
      if (state.isConnected) {
        offlineQueueService.processQueue();
      }
    } catch (error) {
      console.error('[useOfflineMode] Failed to check connection:', error);
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Force process queue
  const processQueue = useCallback(() => {
    if (isOnline) {
      offlineQueueService.processQueue();
    }
  }, [isOnline]);

  return {
    isOnline,
    isChecking,
    queuedItemsCount,
    checkConnection,
    processQueue,
  };
}

/**
 * Simple hook that just returns online status
 * For cases where you only need to know if we're online
 */
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Initial state
    NetInfo.fetch().then((state: NetInfoState) => {
      setIsOnline(!!state.isConnected);
    });

    // Subscribe to changes
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setIsOnline(!!state.isConnected);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return isOnline;
}
