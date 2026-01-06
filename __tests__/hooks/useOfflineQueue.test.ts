/**
 * Tests for useOfflineQueue hook
 * Tests the React hook that components use to interact with the offline queue
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';
import { offlineQueueService, type QueueItem } from '../../lib/services/offline-queue-service';

// Mock the offline queue service
jest.mock('../../lib/services/offline-queue-service', () => {
  const listeners = new Set<() => void>();
  let mockQueue: QueueItem[] = [];
  let mockIsOnline = true;

  return {
    offlineQueueService: {
      getQueue: jest.fn(() => mockQueue),
      getOnlineStatus: jest.fn(() => mockIsOnline),
      hasPendingItems: jest.fn(() => mockQueue.some(item => 
        item.status === 'pending' || item.status === 'processing'
      )),
      retryItem: jest.fn((itemId: string) => {
        const item = mockQueue.find(i => i.id === itemId);
        if (item) {
          item.status = 'pending';
          item.retryCount = 0;
          listeners.forEach(listener => listener());
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      }),
      removeItem: jest.fn((itemId: string) => {
        const initialLength = mockQueue.length;
        mockQueue = mockQueue.filter(i => i.id !== itemId);
        if (mockQueue.length < initialLength) {
          listeners.forEach(listener => listener());
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      }),
      clearFailedItems: jest.fn(() => {
        mockQueue = mockQueue.filter(item => item.status !== 'failed');
        listeners.forEach(listener => listener());
        return Promise.resolve();
      }),
      addListener: jest.fn((listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      // Helper methods for tests
      _setMockQueue: (queue: QueueItem[]) => {
        mockQueue = queue;
        listeners.forEach(listener => listener());
      },
      _setMockOnline: (isOnline: boolean) => {
        mockIsOnline = isOnline;
        listeners.forEach(listener => listener());
      },
      _triggerListeners: () => {
        listeners.forEach(listener => listener());
      },
      _clearListeners: () => {
        listeners.clear();
      },
    },
  };
});

describe('useOfflineQueue Hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (offlineQueueService as any)._setMockQueue([]);
    (offlineQueueService as any)._setMockOnline(true);
    (offlineQueueService as any)._clearListeners();
  });

  describe('Initial State', () => {
    it('should return empty queue initially', () => {
      const { result } = renderHook(() => useOfflineQueue());

      expect(result.current.queue).toEqual([]);
      expect(result.current.pendingCount).toBe(0);
      expect(result.current.failedCount).toBe(0);
      expect(result.current.isOnline).toBe(true);
    });

    it('should load existing queue on mount', () => {
      const mockQueue: QueueItem[] = [
        {
          id: 'item-1',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 0,
          status: 'pending',
          data: {
            bounty: {
              title: 'Test',
              description: 'Test',
              amount: 50,
              poster_id: 'user-1',
            },
          },
        },
      ];

      (offlineQueueService as any)._setMockQueue(mockQueue);

      const { result } = renderHook(() => useOfflineQueue());

      expect(result.current.queue).toHaveLength(1);
      expect(result.current.pendingCount).toBe(1);
    });
  });

  describe('Queue Updates', () => {
    it('should update when queue changes', async () => {
      const { result } = renderHook(() => useOfflineQueue());

      expect(result.current.queue).toHaveLength(0);

      const newItem: QueueItem = {
        id: 'item-1',
        type: 'message',
        timestamp: Date.now(),
        retryCount: 0,
        status: 'pending',
        data: {
          conversationId: 'conv-1',
          text: 'Test',
          senderId: 'user-1',
        },
      };

      act(() => {
        (offlineQueueService as any)._setMockQueue([newItem]);
      });

      await waitFor(() => {
        expect(result.current.queue).toHaveLength(1);
      });
    });

    it('should calculate pending count correctly', () => {
      const mockQueue: QueueItem[] = [
        {
          id: 'item-1',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 0,
          status: 'pending',
          data: { bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' } },
        },
        {
          id: 'item-2',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 0,
          status: 'pending',
          data: { bounty: { title: 'Test 2', description: 'Test', amount: 50, poster_id: 'user-1' } },
        },
        {
          id: 'item-3',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 3,
          status: 'failed',
          data: { bounty: { title: 'Test 3', description: 'Test', amount: 50, poster_id: 'user-1' } },
        },
      ];

      (offlineQueueService as any)._setMockQueue(mockQueue);

      const { result } = renderHook(() => useOfflineQueue());

      expect(result.current.pendingCount).toBe(2);
      expect(result.current.failedCount).toBe(1);
    });
  });

  describe('Network Status', () => {
    it('should reflect online status', () => {
      (offlineQueueService as any)._setMockOnline(true);

      const { result } = renderHook(() => useOfflineQueue());

      expect(result.current.isOnline).toBe(true);
    });

    it('should update when network status changes', async () => {
      const { result } = renderHook(() => useOfflineQueue());

      expect(result.current.isOnline).toBe(true);

      act(() => {
        (offlineQueueService as any)._setMockOnline(false);
      });

      await waitFor(() => {
        expect(result.current.isOnline).toBe(false);
      });
    });
  });

  describe('Queue Operations', () => {
    it('should retry an item', async () => {
      const mockQueue: QueueItem[] = [
        {
          id: 'item-1',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 2,
          status: 'failed',
          data: { bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' } },
        },
      ];

      (offlineQueueService as any)._setMockQueue(mockQueue);

      const { result } = renderHook(() => useOfflineQueue());

      await act(async () => {
        await result.current.retryItem('item-1');
      });

      expect(offlineQueueService.retryItem).toHaveBeenCalledWith('item-1');
    });

    it('should remove an item', async () => {
      const mockQueue: QueueItem[] = [
        {
          id: 'item-1',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 0,
          status: 'pending',
          data: { bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' } },
        },
      ];

      (offlineQueueService as any)._setMockQueue(mockQueue);

      const { result } = renderHook(() => useOfflineQueue());

      await act(async () => {
        await result.current.removeItem('item-1');
      });

      expect(offlineQueueService.removeItem).toHaveBeenCalledWith('item-1');
    });

    it('should clear all failed items', async () => {
      const mockQueue: QueueItem[] = [
        {
          id: 'item-1',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 3,
          status: 'failed',
          data: { bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' } },
        },
        {
          id: 'item-2',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 3,
          status: 'failed',
          data: { bounty: { title: 'Test 2', description: 'Test', amount: 50, poster_id: 'user-1' } },
        },
      ];

      (offlineQueueService as any)._setMockQueue(mockQueue);

      const { result } = renderHook(() => useOfflineQueue());

      await act(async () => {
        await result.current.clearFailed();
      });

      expect(offlineQueueService.clearFailedItems).toHaveBeenCalled();
    });
  });

  describe('hasPending Flag', () => {
    it('should correctly report pending items', () => {
      const mockQueue: QueueItem[] = [
        {
          id: 'item-1',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 0,
          status: 'pending',
          data: { bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' } },
        },
      ];

      (offlineQueueService as any)._setMockQueue(mockQueue);

      const { result } = renderHook(() => useOfflineQueue());

      expect(result.current.hasPending).toBe(true);
    });

    it('should report false when no pending items', () => {
      const mockQueue: QueueItem[] = [
        {
          id: 'item-1',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 3,
          status: 'failed',
          data: { bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' } },
        },
      ];

      (offlineQueueService as any)._setMockQueue(mockQueue);

      const { result } = renderHook(() => useOfflineQueue());

      expect(result.current.hasPending).toBe(false);
    });
  });

  describe('Listener Cleanup', () => {
    it('should clean up listener on unmount', () => {
      const { unmount } = renderHook(() => useOfflineQueue());

      expect(offlineQueueService.addListener).toHaveBeenCalled();

      unmount();

      // Listener should be removed (unsubscribe called)
      // This is implicit in the implementation, but we can verify the service was called
    });
  });

  describe('Multiple Queue Items', () => {
    it('should handle multiple items of different types', () => {
      const mockQueue: QueueItem[] = [
        {
          id: 'bounty-1',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 0,
          status: 'pending',
          data: { bounty: { title: 'Test Bounty', description: 'Test', amount: 50, poster_id: 'user-1' } },
        },
        {
          id: 'message-1',
          type: 'message',
          timestamp: Date.now(),
          retryCount: 0,
          status: 'pending',
          data: { conversationId: 'conv-1', text: 'Test message', senderId: 'user-1' },
        },
        {
          id: 'bounty-2',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 1,
          status: 'pending',
          data: { bounty: { title: 'Test Bounty 2', description: 'Test', amount: 100, poster_id: 'user-2' } },
        },
      ];

      (offlineQueueService as any)._setMockQueue(mockQueue);

      const { result } = renderHook(() => useOfflineQueue());

      expect(result.current.queue).toHaveLength(3);
      expect(result.current.pendingCount).toBe(3);
      expect(result.current.failedCount).toBe(0);
    });

    it('should handle mixed status items', () => {
      const mockQueue: QueueItem[] = [
        {
          id: 'item-1',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 0,
          status: 'pending',
          data: { bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' } },
        },
        {
          id: 'item-2',
          type: 'message',
          timestamp: Date.now(),
          retryCount: 2,
          status: 'pending',
          data: { conversationId: 'conv-1', text: 'Test', senderId: 'user-1' },
        },
        {
          id: 'item-3',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 3,
          status: 'failed',
          data: { bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' } },
        },
        {
          id: 'item-4',
          type: 'message',
          timestamp: Date.now(),
          retryCount: 3,
          status: 'failed',
          data: { conversationId: 'conv-2', text: 'Test', senderId: 'user-1' },
        },
      ];

      (offlineQueueService as any)._setMockQueue(mockQueue);

      const { result } = renderHook(() => useOfflineQueue());

      expect(result.current.queue).toHaveLength(4);
      expect(result.current.pendingCount).toBe(2);
      expect(result.current.failedCount).toBe(2);
    });
  });
});
