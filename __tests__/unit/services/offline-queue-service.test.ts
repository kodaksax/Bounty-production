// Mock AsyncStorage and NetInfo before importing the service to control initialization
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  getAllKeys: jest.fn(),
} as any));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((cb: any) => {
    // Immediately call listener with connected true
    cb({ isConnected: true });
    return () => {};
  }),
}));

import { offlineQueueService } from '../../../lib/services/offline-queue-service';

describe('offlineQueueService basic operations', () => {
  beforeEach(async () => {
    jest.resetModules();
    (AsyncStorage as any).getItem = jest.fn().mockResolvedValue(null);
    (AsyncStorage as any).setItem = jest.fn().mockResolvedValue(undefined);
  });

  it('enqueue returns an item and getQueueByType reflects it', async () => {
    const item = await offlineQueueService.enqueue('message', { conversationId: 'c1', text: 'hi', senderId: 'u1' });
    expect(item).toBeDefined();
    const messages = offlineQueueService.getQueueByType('message');
    expect(messages.some(m => m.id === item.id)).toBe(true);
  });

  it('removeItem removes an item and returns true/false appropriately', async () => {
    const item = await offlineQueueService.enqueue('bounty', { bounty: { title: 't' } as any });
    const removed = await offlineQueueService.removeItem(item.id);
    expect(removed).toBe(true);
    const removedAgain = await offlineQueueService.removeItem('nope');
    expect(removedAgain).toBe(false);
  });

  it('retryItem resets and returns false for missing, true for existing', async () => {
    const item = await offlineQueueService.enqueue('operation', { opType: 'noop', payload: {} });
    const ok = await offlineQueueService.retryItem(item.id);
    expect(ok).toBe(true);
    const missing = await offlineQueueService.retryItem('non-existent');
    expect(missing).toBe(false);
  });

  it('hasPendingItems and getOnlineStatus reflect state', async () => {
    // After enqueuing, should have pending items
    await offlineQueueService.enqueue('message', { conversationId: 'c2', text: 'yo', senderId: 'u2' });
    expect(offlineQueueService.hasPendingItems()).toBe(true);
    expect(typeof offlineQueueService.getOnlineStatus()).toBe('boolean');
  });
});
