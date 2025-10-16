import { useEffect, useState } from 'react';
import { offlineQueueService, type QueueItem } from '../lib/services/offline-queue-service';

export function useOfflineQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Initial load
    setQueue(offlineQueueService.getQueue());
    setIsOnline(offlineQueueService.getOnlineStatus());

    // Subscribe to queue changes
    const unsubscribe = offlineQueueService.addListener(() => {
      setQueue(offlineQueueService.getQueue());
      setIsOnline(offlineQueueService.getOnlineStatus());
    });

    // offlineQueueService.addListener returns a function that may return a boolean (Set.delete return).
    // Wrap it to ensure the cleanup callback returns void (useEffect expects void or a void-returning function).
    return () => {
      // Call unsubscribe and ignore its return value
      try { unsubscribe(); } catch {}
    };
  }, []);

  return {
    queue,
    isOnline,
    pendingCount: queue.filter(item => item.status === 'pending').length,
    failedCount: queue.filter(item => item.status === 'failed').length,
    hasPending: offlineQueueService.hasPendingItems(),
    retryItem: (itemId: string) => offlineQueueService.retryItem(itemId),
    removeItem: (itemId: string) => offlineQueueService.removeItem(itemId),
    clearFailed: () => offlineQueueService.clearFailedItems(),
  };
}
