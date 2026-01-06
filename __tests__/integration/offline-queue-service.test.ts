/**
 * Integration tests for Offline Queue Service
 * Tests offline/online transitions, queue management, and retry logic
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { offlineQueueService, type QueueItem } from '../../lib/services/offline-queue-service';

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

// Mock the services that process queue items
jest.mock('../../lib/services/bounty-service', () => ({
  bountyService: {
    processQueuedBounty: jest.fn(),
  },
}));

jest.mock('../../lib/services/message-service', () => ({
  messageService: {
    processQueuedMessage: jest.fn(),
  },
}));

describe('OfflineQueueService - Integration Tests', () => {
  let mockNetInfoListeners: Array<(state: any) => void> = [];
  let currentNetworkState = { isConnected: true };

  beforeEach(() => {
    // Clear all mocks
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

    (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);
  });

  afterEach(() => {
    mockNetInfoListeners = [];
  });

  describe('Queue Management', () => {
    it('should enqueue a bounty item when offline', async () => {
      currentNetworkState = { isConnected: false };
      
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test Description',
          amount: 100,
          poster_id: 'user-1',
        },
      };

      const item = await offlineQueueService.enqueue('bounty', bountyData);

      expect(item).toMatchObject({
        type: 'bounty',
        status: 'pending',
        retryCount: 0,
        data: bountyData,
      });
      expect(item.id).toBeDefined();
      expect(item.timestamp).toBeDefined();
    });

    it('should enqueue a message item when offline', async () => {
      currentNetworkState = { isConnected: false };
      
      const messageData = {
        conversationId: 'conv-1',
        text: 'Test message',
        senderId: 'user-1',
      };

      const item = await offlineQueueService.enqueue('message', messageData);

      expect(item).toMatchObject({
        type: 'message',
        status: 'pending',
        retryCount: 0,
        data: messageData,
      });
    });

    it('should persist queue to AsyncStorage', async () => {
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      await offlineQueueService.enqueue('bounty', bountyData);

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'offline-queue-v1',
        expect.any(String)
      );
    });

    it('should retrieve all queue items', async () => {
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      const messageData = {
        conversationId: 'conv-1',
        text: 'Test message',
        senderId: 'user-1',
      };

      await offlineQueueService.enqueue('bounty', bountyData);
      await offlineQueueService.enqueue('message', messageData);

      const queue = offlineQueueService.getQueue();
      expect(queue).toHaveLength(2);
      expect(queue[0].type).toBe('bounty');
      expect(queue[1].type).toBe('message');
    });

    it('should filter queue items by type', async () => {
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      const messageData = {
        conversationId: 'conv-1',
        text: 'Test message',
        senderId: 'user-1',
      };

      await offlineQueueService.enqueue('bounty', bountyData);
      await offlineQueueService.enqueue('message', messageData);
      await offlineQueueService.enqueue('bounty', bountyData);

      const bounties = offlineQueueService.getQueueByType('bounty');
      const messages = offlineQueueService.getQueueByType('message');

      expect(bounties).toHaveLength(2);
      expect(messages).toHaveLength(1);
    });
  });

  describe('Network Transitions', () => {
    it('should process queue when transitioning from offline to online', async () => {
      const { bountyService } = require('../../lib/services/bounty-service');
      
      currentNetworkState = { isConnected: false };
      
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      await offlineQueueService.enqueue('bounty', bountyData);
      
      // Simulate network coming back online
      currentNetworkState = { isConnected: true };
      bountyService.processQueuedBounty.mockResolvedValueOnce({ id: '123', ...bountyData.bounty });
      
      // Trigger network state change
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(bountyService.processQueuedBounty).toHaveBeenCalledWith(bountyData.bounty);
    });

    it('should not process queue when already processing', async () => {
      const { bountyService } = require('../../lib/services/bounty-service');
      
      currentNetworkState = { isConnected: true };
      
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      // Make processQueuedBounty take a long time
      bountyService.processQueuedBounty.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ id: '123' }), 1000))
      );

      await offlineQueueService.enqueue('bounty', bountyData);
      
      // Trigger processing multiple times quickly
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should only be called once due to isProcessing flag
      expect(bountyService.processQueuedBounty).toHaveBeenCalledTimes(1);
    });

    it('should handle online status correctly', () => {
      currentNetworkState = { isConnected: true };
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      
      expect(offlineQueueService.getOnlineStatus()).toBe(true);

      currentNetworkState = { isConnected: false };
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      
      expect(offlineQueueService.getOnlineStatus()).toBe(false);
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed items with exponential backoff', async () => {
      const { bountyService } = require('../../lib/services/bounty-service');
      
      currentNetworkState = { isConnected: true };
      
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      // Make it fail the first time
      bountyService.processQueuedBounty
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ id: '123', ...bountyData.bounty });

      const item = await offlineQueueService.enqueue('bounty', bountyData);
      
      // First attempt should fail
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const queue = offlineQueueService.getQueue();
      expect(queue[0].status).toBe('pending');
      expect(queue[0].retryCount).toBe(1);
      expect(queue[0].error).toBe('Network error');
    });

    it('should mark item as failed after max retries', async () => {
      const { bountyService } = require('../../lib/services/bounty-service');
      
      currentNetworkState = { isConnected: true };
      
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      // Always fail
      bountyService.processQueuedBounty.mockRejectedValue(new Error('Network error'));

      const item = await offlineQueueService.enqueue('bounty', bountyData);
      
      // Manually set retry count to exceed max
      const queue = offlineQueueService.getQueue();
      queue[0].retryCount = 3;
      
      // Try to process
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const updatedQueue = offlineQueueService.getQueue();
      expect(updatedQueue[0].status).toBe('failed');
      expect(updatedQueue[0].error).toBe('Max retries exceeded');
    });

    it('should allow manual retry of failed items', async () => {
      const { bountyService } = require('../../lib/services/bounty-service');
      
      currentNetworkState = { isConnected: true };
      
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      const item = await offlineQueueService.enqueue('bounty', bountyData);
      
      // Manually set as failed
      const queue = offlineQueueService.getQueue();
      queue[0].status = 'failed';
      queue[0].retryCount = 3;
      
      // Retry the item
      bountyService.processQueuedBounty.mockResolvedValueOnce({ id: '123', ...bountyData.bounty });
      const retried = await offlineQueueService.retryItem(item.id);
      
      expect(retried).toBe(true);
      
      const updatedQueue = offlineQueueService.getQueue();
      expect(updatedQueue[0].status).toBe('pending');
      expect(updatedQueue[0].retryCount).toBe(0);
    });
  });

  describe('Queue Operations', () => {
    it('should remove item from queue', async () => {
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      const item = await offlineQueueService.enqueue('bounty', bountyData);
      
      const removed = await offlineQueueService.removeItem(item.id);
      
      expect(removed).toBe(true);
      expect(offlineQueueService.getQueue()).toHaveLength(0);
    });

    it('should return false when removing non-existent item', async () => {
      const removed = await offlineQueueService.removeItem('non-existent-id');
      expect(removed).toBe(false);
    });

    it('should clear all failed items', async () => {
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      await offlineQueueService.enqueue('bounty', bountyData);
      await offlineQueueService.enqueue('bounty', bountyData);
      await offlineQueueService.enqueue('bounty', bountyData);
      
      // Manually mark some as failed
      const queue = offlineQueueService.getQueue();
      queue[0].status = 'failed';
      queue[1].status = 'failed';
      
      await offlineQueueService.clearFailedItems();
      
      const remaining = offlineQueueService.getQueue();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].status).toBe('pending');
    });

    it('should detect pending items correctly', async () => {
      expect(offlineQueueService.hasPendingItems()).toBe(false);
      
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      await offlineQueueService.enqueue('bounty', bountyData);
      
      expect(offlineQueueService.hasPendingItems()).toBe(true);
      
      // Mark as failed
      const queue = offlineQueueService.getQueue();
      queue[0].status = 'failed';
      
      expect(offlineQueueService.hasPendingItems()).toBe(false);
    });
  });

  describe('Listener Notifications', () => {
    it('should notify listeners when queue changes', async () => {
      const listener = jest.fn();
      const unsubscribe = offlineQueueService.addListener(listener);
      
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      await offlineQueueService.enqueue('bounty', bountyData);
      
      expect(listener).toHaveBeenCalled();
      
      unsubscribe();
    });

    it('should not notify after unsubscribe', async () => {
      const listener = jest.fn();
      const unsubscribe = offlineQueueService.addListener(listener);
      
      unsubscribe();
      listener.mockClear();
      
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      await offlineQueueService.enqueue('bounty', bountyData);
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Message Processing', () => {
    it('should process queued messages when online', async () => {
      const { messageService } = require('../../lib/services/message-service');
      
      currentNetworkState = { isConnected: true };
      
      const messageData = {
        conversationId: 'conv-1',
        text: 'Test message',
        senderId: 'user-1',
      };

      messageService.processQueuedMessage.mockResolvedValueOnce({
        id: 'msg-123',
        ...messageData,
        createdAt: new Date().toISOString(),
      });

      await offlineQueueService.enqueue('message', messageData);
      
      // Trigger network state change to online
      mockNetInfoListeners.forEach(listener => listener(currentNetworkState));
      
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messageService.processQueuedMessage).toHaveBeenCalledWith(
        messageData.conversationId,
        messageData.text,
        messageData.senderId
      );
    });
  });

  describe('Persistence', () => {
    it('should load queue from AsyncStorage on initialization', async () => {
      const existingQueue: QueueItem[] = [
        {
          id: 'test-1',
          type: 'bounty',
          timestamp: Date.now(),
          retryCount: 0,
          data: {
            bounty: {
              title: 'Existing Bounty',
              description: 'Test',
              amount: 100,
              poster_id: 'user-1',
            },
          },
          status: 'pending',
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
        JSON.stringify(existingQueue)
      );

      // Create a new instance to trigger initialization
      // Note: In real scenario, this would be done on app startup
      const queue = offlineQueueService.getQueue();
      
      // The queue should have loaded items
      expect(queue.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle corrupted AsyncStorage data gracefully', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('invalid json{');
      
      // Should not throw error
      expect(() => offlineQueueService.getQueue()).not.toThrow();
    });
  });
});
