import { useEffect, useState, useCallback } from 'react';
import { offlineQueueService, type QueueItem, type QueueItemType } from 'lib/services/offline-queue-service';

export function useOfflineQueue() {
  const [queue, setQueue] = useState<QueueItem[]>(() => offlineQueueService.getQueue());
  const [isOnline, setIsOnline] = useState<boolean>(() => offlineQueueService.getOnlineStatus());

  useEffect(() => {
    const unsub = offlineQueueService.addListener(() => {
      setQueue(offlineQueueService.getQueue());
      setIsOnline(offlineQueueService.getOnlineStatus());
    });


    // Wrap unsubscribe so cleanup returns void (listener removal returns boolean)
    return () => {
      try { unsub(); } catch (e) { /* ignore */ }
    };
  }, []);

  const pendingCount = queue.filter(i => i.status === 'pending' || i.status === 'processing').length;
  const failedCount = queue.filter(i => i.status === 'failed').length;

  const retryItem = useCallback(async (id: string) => {
    return offlineQueueService.retryItem(id);
  }, []);

  const removeItem = useCallback(async (id: string) => {
    return offlineQueueService.removeItem(id);
  }, []);

  const clearFailedItems = useCallback(async () => {
    return offlineQueueService.clearFailedItems();
  }, []);

  const enqueue = useCallback(async (type: QueueItemType, data: any) => {
    return offlineQueueService.enqueue(type, data);
  }, []);

  return {
    queue,
    pendingCount,
    failedCount,
    isOnline,
    retryItem,
    removeItem,
    clearFailedItems,
    enqueue,
  } as const;
}

export default useOfflineQueue;

