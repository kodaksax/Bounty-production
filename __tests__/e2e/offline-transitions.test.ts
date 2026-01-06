/**
 * End-to-end tests for offline support transitions
 * Tests the complete flow of going offline, queueing items, and syncing when back online
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage');
jest.mock('@react-native-community/netinfo');
jest.mock('../../lib/utils/error-logger', () => ({
  logger: {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  },
}));

// Import services after mocks
import { offlineQueueService } from '../../lib/services/offline-queue-service';
import { bountyService } from '../../lib/services/bounty-service';
import { messageService } from '../../lib/services/message-service';

// Mock bounty and message services
jest.mock('../../lib/services/bounty-service', () => ({
  bountyService: {
    create: jest.fn(),
    processQueuedBounty: jest.fn(),
  },
}));

jest.mock('../../lib/services/message-service', () => ({
  messageService: {
    sendMessage: jest.fn(),
    processQueuedMessage: jest.fn(),
  },
}));

// Mock Supabase
jest.mock('../../lib/supabase', () => ({
  supabase: {},
  isSupabaseConfigured: false,
}));

describe('Offline Support - E2E Transitions', () => {
  let mockNetInfoListeners: Array<(state: any) => void> = [];
  let currentNetworkState = { isConnected: true };

  beforeEach(() => {
    jest.clearAllMocks();
    mockNetInfoListeners = [];
    currentNetworkState = { isConnected: true };

    // Mock AsyncStorage
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);

    // Mock NetInfo
    (NetInfo.addEventListener as jest.Mock).mockImplementation((listener) => {
      mockNetInfoListeners.push(listener);
      return jest.fn(); // unsubscribe function
    });

    (NetInfo.fetch as jest.Mock).mockImplementation(() => 
      Promise.resolve(currentNetworkState)
    );
  });

  describe('Complete Offline → Online Transition', () => {
    it('should queue bounty when offline and sync when back online', async () => {
      // Start offline
      currentNetworkState = { isConnected: false };
      (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);

      const bountyData = {
        bounty: {
          title: 'Test Offline Bounty',
          description: 'Created while offline',
          amount: 100,
          poster_id: 'user-123',
        },
      };

      // Queue the bounty
      const queueItem = await offlineQueueService.enqueue('bounty', bountyData);
      
      expect(queueItem.status).toBe('pending');
      expect(offlineQueueService.getQueue()).toHaveLength(1);

      // Go back online
      currentNetworkState = { isConnected: true };
      (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);
      
      // Mock successful bounty creation
      (bountyService.processQueuedBounty as jest.Mock).mockResolvedValueOnce({
        id: 'bounty-123',
        ...bountyData.bounty,
        created_at: new Date().toISOString(),
      });

      // Trigger network state change
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify bounty was processed
      expect(bountyService.processQueuedBounty).toHaveBeenCalledWith(bountyData.bounty);
      
      // Queue should be empty after successful processing
      expect(offlineQueueService.getQueue()).toHaveLength(0);
    });

    it('should queue message when offline and sync when back online', async () => {
      // Start offline
      currentNetworkState = { isConnected: false };
      (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);

      const messageData = {
        conversationId: 'conv-456',
        text: 'Test offline message',
        senderId: 'user-123',
      };

      // Queue the message
      const queueItem = await offlineQueueService.enqueue('message', messageData);
      
      expect(queueItem.status).toBe('pending');
      expect(offlineQueueService.getQueue()).toHaveLength(1);

      // Go back online
      currentNetworkState = { isConnected: true };
      (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);
      
      // Mock successful message send
      (messageService.processQueuedMessage as jest.Mock).mockResolvedValueOnce({
        id: 'message-789',
        ...messageData,
        createdAt: new Date().toISOString(),
        status: 'sent',
      });

      // Trigger network state change
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify message was processed
      expect(messageService.processQueuedMessage).toHaveBeenCalledWith(
        messageData.conversationId,
        messageData.text,
        messageData.senderId
      );
      
      // Queue should be empty after successful processing
      expect(offlineQueueService.getQueue()).toHaveLength(0);
    });

    it('should handle multiple queued items when coming online', async () => {
      // Start offline
      currentNetworkState = { isConnected: false };
      (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);

      // Queue multiple items
      await offlineQueueService.enqueue('bounty', {
        bounty: {
          title: 'Bounty 1',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      });

      await offlineQueueService.enqueue('message', {
        conversationId: 'conv-1',
        text: 'Message 1',
        senderId: 'user-1',
      });

      await offlineQueueService.enqueue('bounty', {
        bounty: {
          title: 'Bounty 2',
          description: 'Test',
          amount: 75,
          poster_id: 'user-1',
        },
      });

      expect(offlineQueueService.getQueue()).toHaveLength(3);

      // Go back online
      currentNetworkState = { isConnected: true };
      (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);
      
      // Mock successful processing for all items
      (bountyService.processQueuedBounty as jest.Mock)
        .mockResolvedValueOnce({ id: 'bounty-1' })
        .mockResolvedValueOnce({ id: 'bounty-2' });
      
      (messageService.processQueuedMessage as jest.Mock)
        .mockResolvedValueOnce({ id: 'message-1' });

      // Trigger network state change
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 300));

      // All items should be processed
      expect(bountyService.processQueuedBounty).toHaveBeenCalledTimes(2);
      expect(messageService.processQueuedMessage).toHaveBeenCalledTimes(1);
      
      // Queue should be empty
      expect(offlineQueueService.getQueue()).toHaveLength(0);
    });
  });

  describe('Retry Logic During Transitions', () => {
    it('should retry failed items when coming back online', async () => {
      // Start online
      currentNetworkState = { isConnected: true };
      (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);

      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      // First attempt fails
      (bountyService.processQueuedBounty as jest.Mock).mockRejectedValueOnce(
        new Error('Temporary network error')
      );

      await offlineQueueService.enqueue('bounty', bountyData);

      // Trigger processing (will fail)
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      await new Promise(resolve => setTimeout(resolve, 100));

      const queue = offlineQueueService.getQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].retryCount).toBe(1);

      // Second attempt succeeds
      (bountyService.processQueuedBounty as jest.Mock).mockResolvedValueOnce({
        id: 'bounty-123',
        ...bountyData.bounty,
      });

      // Wait for retry with backoff
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Trigger processing again
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should eventually succeed and clear queue
      expect(bountyService.processQueuedBounty).toHaveBeenCalledTimes(2);
    });

    it('should mark item as failed after max retries during transitions', async () => {
      // Start online
      currentNetworkState = { isConnected: true };
      (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);

      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      // Always fail
      (bountyService.processQueuedBounty as jest.Mock).mockRejectedValue(
        new Error('Persistent network error')
      );

      const item = await offlineQueueService.enqueue('bounty', bountyData);

      // Manually set retry count to exceed max
      const queue = offlineQueueService.getQueue();
      queue[0].retryCount = 3;

      // Trigger processing
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      await new Promise(resolve => setTimeout(resolve, 100));

      const updatedQueue = offlineQueueService.getQueue();
      expect(updatedQueue).toHaveLength(1);
      expect(updatedQueue[0].status).toBe('failed');
      expect(updatedQueue[0].error).toBe('Max retries exceeded');
    });
  });

  describe('Persistence Across App Restart During Transitions', () => {
    it('should persist queue through offline period and app restart', async () => {
      // Queue items while offline
      currentNetworkState = { isConnected: false };
      (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);

      const bountyData = {
        bounty: {
          title: 'Persistent Bounty',
          description: 'Test',
          amount: 100,
          poster_id: 'user-1',
        },
      };

      await offlineQueueService.enqueue('bounty', bountyData);

      // Verify saved to AsyncStorage
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'offline-queue-v1',
        expect.any(String)
      );

      const savedData = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
      const parsedQueue = JSON.parse(savedData);
      
      expect(parsedQueue).toHaveLength(1);
      expect(parsedQueue[0].type).toBe('bounty');
      expect(parsedQueue[0].data.bounty.title).toBe('Persistent Bounty');
    });
  });

  describe('Rapid Network State Changes', () => {
    it('should handle rapid offline/online transitions gracefully', async () => {
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      // Start offline and queue item
      currentNetworkState = { isConnected: false };
      await offlineQueueService.enqueue('bounty', bountyData);

      // Rapid transitions
      currentNetworkState = { isConnected: true };
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));

      currentNetworkState = { isConnected: false };
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));

      currentNetworkState = { isConnected: true };
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should not crash and queue should still exist
      const queue = offlineQueueService.getQueue();
      expect(queue).toHaveLength(1);
    });

    it('should not process queue multiple times during rapid transitions', async () => {
      currentNetworkState = { isConnected: true };
      
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      // Make processing take time
      (bountyService.processQueuedBounty as jest.Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ id: '123' }), 500))
      );

      await offlineQueueService.enqueue('bounty', bountyData);

      // Trigger multiple network changes rapidly
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));

      await new Promise(resolve => setTimeout(resolve, 600));

      // Should only process once due to isProcessing flag
      expect(bountyService.processQueuedBounty).toHaveBeenCalledTimes(1);
    });
  });

  describe('Mixed Success and Failure During Transitions', () => {
    it('should handle partial success when processing queue', async () => {
      currentNetworkState = { isConnected: false };

      // Queue multiple items
      await offlineQueueService.enqueue('bounty', {
        bounty: { title: 'Bounty 1', description: 'Test', amount: 50, poster_id: 'user-1' },
      });

      await offlineQueueService.enqueue('message', {
        conversationId: 'conv-1',
        text: 'Message 1',
        senderId: 'user-1',
      });

      await offlineQueueService.enqueue('bounty', {
        bounty: { title: 'Bounty 2', description: 'Test', amount: 75, poster_id: 'user-1' },
      });

      // Go online
      currentNetworkState = { isConnected: true };

      // First bounty succeeds
      (bountyService.processQueuedBounty as jest.Mock)
        .mockResolvedValueOnce({ id: 'bounty-1' });

      // Message fails
      (messageService.processQueuedMessage as jest.Mock)
        .mockRejectedValueOnce(new Error('Message send failed'));

      // Second bounty succeeds
      (bountyService.processQueuedBounty as jest.Mock)
        .mockResolvedValueOnce({ id: 'bounty-2' });

      // Trigger processing
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      await new Promise(resolve => setTimeout(resolve, 200));

      const queue = offlineQueueService.getQueue();
      
      // Only the failed message should remain
      expect(queue.length).toBeGreaterThan(0);
      const failedItem = queue.find(item => item.type === 'message');
      expect(failedItem).toBeDefined();
      expect(failedItem?.retryCount).toBe(1);
    });
  });

  describe('Status Indicator During Transitions', () => {
    it('should correctly report online status during transitions', () => {
      currentNetworkState = { isConnected: true };
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      expect(offlineQueueService.getOnlineStatus()).toBe(true);

      currentNetworkState = { isConnected: false };
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      expect(offlineQueueService.getOnlineStatus()).toBe(false);

      currentNetworkState = { isConnected: true };
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      expect(offlineQueueService.getOnlineStatus()).toBe(true);
    });

    it('should correctly report pending items during transitions', async () => {
      expect(offlineQueueService.hasPendingItems()).toBe(false);

      currentNetworkState = { isConnected: false };
      await offlineQueueService.enqueue('bounty', {
        bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' },
      });

      expect(offlineQueueService.hasPendingItems()).toBe(true);

      // Mark as failed
      const queue = offlineQueueService.getQueue();
      queue[0].status = 'failed';

      expect(offlineQueueService.hasPendingItems()).toBe(false);
    });
  });
});
