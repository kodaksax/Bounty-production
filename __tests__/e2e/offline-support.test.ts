/**
 * End-to-end tests for offline support
 * Tests realistic user scenarios for offline functionality
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

// Mock dependencies BEFORE importing services
jest.mock('@react-native-async-storage/async-storage');
jest.mock('@react-native-community/netinfo');
jest.mock('../../lib/utils/error-logger', () => ({
  logger: {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  },
}));

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

jest.mock('../../lib/supabase', () => ({
  supabase: {},
  isSupabaseConfigured: false,
}));

// Import after mocks
import { offlineQueueService } from '../../lib/services/offline-queue-service';

describe('Offline Support - E2E Scenarios', () => {
  let currentNetworkState = { isConnected: true };

  beforeAll(async () => {
    // Clear queue before all tests
    await offlineQueueService.clearFailedItems();
    const queue = offlineQueueService.getQueue();
    for (const item of queue) {
      await offlineQueueService.removeItem(item.id);
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    currentNetworkState = { isConnected: true };

    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (NetInfo.addEventListener as jest.Mock).mockReturnValue(jest.fn());
    (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);

    // Clear queue before each test
    await offlineQueueService.clearFailedItems();
    const queue = offlineQueueService.getQueue();
    for (const item of queue) {
      await offlineQueueService.removeItem(item.id);
    }
  });

  afterEach(async () => {
    // Clean up after each test
    await offlineQueueService.clearFailedItems();
    const queue = offlineQueueService.getQueue();
    for (const item of queue) {
      await offlineQueueService.removeItem(item.id);
    }
  });

  describe('User creates bounty while offline', () => {
    it('should queue bounty and show it in pending state', async () => {
      // User is offline
      currentNetworkState = { isConnected: false };
      (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);

      const bountyData = {
        bounty: {
          title: 'Fix my bike',
          description: 'Need help fixing a flat tire',
          amount: 50,
          poster_id: 'user-123',
        },
      };

      // User creates bounty
      const queueItem = await offlineQueueService.enqueue('bounty', bountyData);

      // Bounty should be queued
      expect(queueItem.status).toBe('pending');
      expect(queueItem.type).toBe('bounty');

      // Queue should contain the bounty
      const queue = offlineQueueService.getQueue();
      const foundItem = queue.find(i => i.id === queueItem.id);
      expect(foundItem).toBeDefined();
      expect(foundItem?.data).toEqual(bountyData);
    });
  });

  describe('User sends message while offline', () => {
    it('should queue message for later delivery', async () => {
      // User is offline
      currentNetworkState = { isConnected: false };
      (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);

      const messageData = {
        conversationId: 'conv-456',
        text: 'Hey, are you available tomorrow?',
        senderId: 'user-123',
      };

      // User sends message
      const queueItem = await offlineQueueService.enqueue('message', messageData);

      // Message should be queued
      expect(queueItem.status).toBe('pending');
      expect(queueItem.type).toBe('message');

      // Queue should contain the message
      const queue = offlineQueueService.getQueue();
      const foundItem = queue.find(i => i.id === queueItem.id);
      expect(foundItem).toBeDefined();
      expect(foundItem?.data).toEqual(messageData);
    });
  });

  describe('User creates multiple items while offline', () => {
    it('should queue all items and track them', async () => {
      currentNetworkState = { isConnected: false };
      (NetInfo.fetch as jest.Mock).mockResolvedValue(currentNetworkState);

      // User creates multiple bounties
      const item1 = await offlineQueueService.enqueue('bounty', {
        bounty: {
          title: 'Task 1',
          description: 'First task',
          amount: 50,
          poster_id: 'user-1',
        },
      });

      const item2 = await offlineQueueService.enqueue('message', {
        conversationId: 'conv-1',
        text: 'Message 1',
        senderId: 'user-1',
      });

      const item3 = await offlineQueueService.enqueue('bounty', {
        bounty: {
          title: 'Task 2',
          description: 'Second task',
          amount: 75,
          poster_id: 'user-1',
        },
      });

      // All items should be in queue
      const queue = offlineQueueService.getQueue();
      expect(queue.find(i => i.id === item1.id)).toBeDefined();
      expect(queue.find(i => i.id === item2.id)).toBeDefined();
      expect(queue.find(i => i.id === item3.id)).toBeDefined();

      // Check types
      expect(offlineQueueService.getQueueByType('bounty').length).toBeGreaterThanOrEqual(2);
      expect(offlineQueueService.getQueueByType('message').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('User retries failed item', () => {
    it('should reset retry count and mark as pending', async () => {
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      const item = await offlineQueueService.enqueue('bounty', bountyData);

      // Simulate failure
      const queue = offlineQueueService.getQueue();
      const queuedItem = queue.find(i => i.id === item.id);
      if (queuedItem) {
        queuedItem.status = 'failed';
        queuedItem.retryCount = 3;
        queuedItem.error = 'Network error';
      }

      // User retries
      const retried = await offlineQueueService.retryItem(item.id);

      expect(retried).toBe(true);

      const updatedQueue = offlineQueueService.getQueue();
      const retriedItem = updatedQueue.find(i => i.id === item.id);
      expect(retriedItem?.status).toBe('pending');
      expect(retriedItem?.retryCount).toBe(0);
      expect(retriedItem?.error).toBeUndefined();
    });
  });

  describe('User clears failed items', () => {
    it('should remove all failed items from queue', async () => {
      // Create some items
      const item1 = await offlineQueueService.enqueue('bounty', {
        bounty: { title: 'Task 1', description: 'Test', amount: 50, poster_id: 'user-1' },
      });

      const item2 = await offlineQueueService.enqueue('bounty', {
        bounty: { title: 'Task 2', description: 'Test', amount: 75, poster_id: 'user-1' },
      });

      const item3 = await offlineQueueService.enqueue('bounty', {
        bounty: { title: 'Task 3', description: 'Test', amount: 100, poster_id: 'user-1' },
      });

      // Mark some as failed
      const queue = offlineQueueService.getQueue();
      const qItem1 = queue.find(i => i.id === item1.id);
      const qItem2 = queue.find(i => i.id === item2.id);
      
      if (qItem1) qItem1.status = 'failed';
      if (qItem2) qItem2.status = 'failed';

      // User clears failed items
      await offlineQueueService.clearFailedItems();

      const updatedQueue = offlineQueueService.getQueue();
      expect(updatedQueue.find(i => i.id === item1.id)).toBeUndefined();
      expect(updatedQueue.find(i => i.id === item2.id)).toBeUndefined();
      expect(updatedQueue.find(i => i.id === item3.id)).toBeDefined();
    });
  });

  describe('User manually removes queued item', () => {
    it('should remove the specific item from queue', async () => {
      const bountyData = {
        bounty: {
          title: 'Test Bounty',
          description: 'Test',
          amount: 50,
          poster_id: 'user-1',
        },
      };

      const item = await offlineQueueService.enqueue('bounty', bountyData);

      // Verify it's in queue
      let queue = offlineQueueService.getQueue();
      expect(queue.find(i => i.id === item.id)).toBeDefined();

      // User removes it
      const removed = await offlineQueueService.removeItem(item.id);

      expect(removed).toBe(true);

      // Verify it's gone
      queue = offlineQueueService.getQueue();
      expect(queue.find(i => i.id === item.id)).toBeUndefined();
    });
  });

  describe('Queue persists to storage', () => {
    it('should save queue to AsyncStorage when items are added', async () => {
      const bountyData = {
        bounty: {
          title: 'Persistent Bounty',
          description: 'Should be saved',
          amount: 100,
          poster_id: 'user-1',
        },
      };

      await offlineQueueService.enqueue('bounty', bountyData);

      // Verify AsyncStorage was called
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'offline-queue-v1',
        expect.any(String)
      );

      // Verify the data structure
      const calls = (AsyncStorage.setItem as jest.Mock).mock.calls;
      const savedCall = calls.find(call => call[0] === 'offline-queue-v1');
      expect(savedCall).toBeDefined();

      const savedData = JSON.parse(savedCall[1]);
      expect(Array.isArray(savedData)).toBe(true);
      expect(savedData.some(item => 
        item.type === 'bounty' && 
        item.data.bounty.title === 'Persistent Bounty'
      )).toBe(true);
    });
  });

  describe('Queue status tracking', () => {
    it('should correctly identify when there are pending items', async () => {
      // Start with clean state
      await offlineQueueService.clearFailedItems();
      const initialQueue = offlineQueueService.getQueue();
      for (const item of initialQueue) {
        await offlineQueueService.removeItem(item.id);
      }

      // Add a pending item
      const item = await offlineQueueService.enqueue('bounty', {
        bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' },
      });

      expect(offlineQueueService.hasPendingItems()).toBe(true);

      // Remove it
      await offlineQueueService.removeItem(item.id);

      expect(offlineQueueService.hasPendingItems()).toBe(false);
    });

    it('should not consider failed items as pending', async () => {
      const item = await offlineQueueService.enqueue('bounty', {
        bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' },
      });

      // Mark as failed
      const queue = offlineQueueService.getQueue();
      const queuedItem = queue.find(i => i.id === item.id);
      if (queuedItem) {
        queuedItem.status = 'failed';
      }

      // Failed items are not pending
      const hasPending = offlineQueueService.hasPendingItems();
      
      // Clean up
      await offlineQueueService.removeItem(item.id);
      
      expect(hasPending).toBe(false);
    });
  });

  describe('Listener notifications', () => {
    it('should notify listeners when queue changes', async () => {
      const listener = jest.fn();
      const unsubscribe = offlineQueueService.addListener(listener);

      // Add item to queue
      await offlineQueueService.enqueue('bounty', {
        bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' },
      });

      expect(listener).toHaveBeenCalled();

      unsubscribe();
    });

    it('should stop notifying after unsubscribe', async () => {
      const listener = jest.fn();
      const unsubscribe = offlineQueueService.addListener(listener);

      unsubscribe();
      listener.mockClear();

      // Add item after unsubscribe
      const item = await offlineQueueService.enqueue('bounty', {
        bounty: { title: 'Test', description: 'Test', amount: 50, poster_id: 'user-1' },
      });

      // Clean up
      await offlineQueueService.removeItem(item.id);

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
