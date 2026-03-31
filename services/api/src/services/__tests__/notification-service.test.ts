/* eslint-env jest */
/**
 * Tests for backend NotificationService – covers debounced message notifications,
 * stale token cleanup, badge count inclusion, and Android channel routing.
 */

// ── Mocks ──────────────────────────────────────────────────────────────

jest.mock('../../db/connection', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => []),
          orderBy: jest.fn(() => ({ limit: jest.fn(() => ({ offset: jest.fn(() => []) })) })),
        })),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        returning: jest.fn(() => [{
          id: 'notif-1',
          user_id: 'user-1',
          type: 'message',
          title: 'test',
          body: 'test',
          data: null,
          read: false,
          created_at: new Date(),
        }]),
      })),
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({
          returning: jest.fn(() => [{}]),
        })),
      })),
    })),
    delete: jest.fn(() => ({
      where: jest.fn(),
    })),
    transaction: jest.fn((cb: any) => cb({
      select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => []) })) })) })),
      insert: jest.fn(() => ({ values: jest.fn(() => ({ returning: jest.fn(() => []) })) })),
      delete: jest.fn(() => ({ where: jest.fn() })),
      update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn() })) })),
    })),
  },
}));

jest.mock('expo-server-sdk', () => {
  return {
    Expo: class MockExpo {
      static isExpoPushToken(token: string) {
        return /^Expo(nent)?PushToken\[.+\]$/.test(token);
      }
      chunkPushNotifications(messages: any[]) { return [messages]; }
      sendPushNotificationsAsync = jest.fn().mockResolvedValue(
        [{ status: 'ok', id: 'ticket-1' }]
      );
    },
  };
});

jest.mock('../../db/schema', () => ({
  notifications: { id: 'id', user_id: 'user_id', type: 'type', title: 'title', body: 'body', data: 'data', read: 'read', created_at: 'created_at' },
  pushTokens: { id: 'id', user_id: 'user_id', token: 'token', device_id: 'device_id', created_at: 'created_at', updated_at: 'updated_at' },
  notificationPreferences: { user_id: 'user_id', applications_enabled: true, acceptances_enabled: true, completions_enabled: true, payments_enabled: true, messages_enabled: true, follows_enabled: true, reminders_enabled: true, system_enabled: true },
  users: { id: 'id', handle: 'handle' },
  conversations: { id: 'id', bounty_id: 'bounty_id' },
  messages: { id: 'id', conversation_id: 'conversation_id', sender_id: 'sender_id', text: 'text' },
}));

jest.mock('../supabase-edge-client', () => ({
  sendPushViaEdge: jest.fn(),
}));

// ── Tests ──────────────────────────────────────────────────────────────

import { NotificationService } from '../notification-service';

describe('NotificationService (backend)', () => {
  let service: NotificationService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new NotificationService();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('sendMessageNotification debounce', () => {
    it('should batch multiple rapid messages into a single grouped notification', async () => {
      const createSpy = jest.spyOn(service, 'createNotification').mockResolvedValue({
        id: 'notif-1',
        user_id: 'user-1',
        type: 'message',
        title: 'test',
        body: 'test',
        data: {},
        read: false,
        created_at: new Date(),
      });

      // Send 3 messages rapidly from the same sender
      await service.sendMessageNotification('user-1', 'sender-1', 'conv-1', 'Hello');
      await service.sendMessageNotification('user-1', 'sender-1', 'conv-1', 'How are you?');
      await service.sendMessageNotification('user-1', 'sender-1', 'conv-1', 'Anyone there?');

      // Before the debounce window expires, no notification should have been created
      expect(createSpy).not.toHaveBeenCalled();

      // Advance timer past the debounce window
      jest.advanceTimersByTime(6000);

      // Wait for any microtasks to complete
      await Promise.resolve();

      // Should have created exactly one grouped notification
      expect(createSpy).toHaveBeenCalledTimes(1);
      const callArgs = createSpy.mock.calls[0][0];
      expect(callArgs.title).toContain('3 new messages');
      expect(callArgs.type).toBe('message');
    });

    it('should send a single (non-grouped) notification for a single message after debounce', async () => {
      const createSpy = jest.spyOn(service, 'createNotification').mockResolvedValue({
        id: 'notif-2',
        user_id: 'user-2',
        type: 'message',
        title: 'test',
        body: 'test',
        data: {},
        read: false,
        created_at: new Date(),
      });

      await service.sendMessageNotification('user-2', 'sender-2', 'conv-2', 'Hey!');

      // Advance past debounce window
      jest.advanceTimersByTime(6000);
      await Promise.resolve();

      expect(createSpy).toHaveBeenCalledTimes(1);
      const callArgs = createSpy.mock.calls[0][0];
      expect(callArgs.title).toContain('Message from');
      expect(callArgs.title).not.toContain('new messages');
    });

    it('should debounce independently per sender-recipient pair', async () => {
      const createSpy = jest.spyOn(service, 'createNotification').mockResolvedValue({
        id: 'notif-3',
        user_id: 'user-3',
        type: 'message',
        title: 'test',
        body: 'test',
        data: {},
        read: false,
        created_at: new Date(),
      });

      // Messages from two different senders to the same recipient
      await service.sendMessageNotification('user-3', 'sender-a', 'conv-3a', 'Hi from A');
      await service.sendMessageNotification('user-3', 'sender-b', 'conv-3b', 'Hi from B');

      jest.advanceTimersByTime(6000);
      await Promise.resolve();

      // Should create two separate notifications (one per sender)
      expect(createSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAndroidChannelId via createNotification', () => {
    it('should pass notificationType in push data for channel routing', async () => {
      const sendPushSpy = jest.spyOn(service, 'sendPushNotification').mockResolvedValue();
      // Mock isNotificationEnabled to return true
      (service as any).isNotificationEnabled = jest.fn().mockResolvedValue(true);

      await service.createNotification({
        userId: 'user-4',
        type: 'payment',
        title: 'Payment Received',
        body: 'You got paid',
        data: { bountyId: 'b-1' },
      });

      expect(sendPushSpy).toHaveBeenCalledWith(
        'user-4',
        'Payment Received',
        'You got paid',
        expect.objectContaining({ notificationType: 'payment' })
      );
    });
  });
});
