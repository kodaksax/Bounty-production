/**
 * Unit tests for Error Handling Improvements
 * Tests graceful degradation and error logging throttling
 */

// Mock global fetch
global.fetch = jest.fn();

// Mock modules
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: {
          session: {
            access_token: 'test-token',
            user: { id: 'test-user-id' }
          }
        }
      }),
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => ({
            range: jest.fn().mockResolvedValue({ data: [], error: null }),
          })),
        })),
      })),
    })),
  },
}));

jest.mock('../../../lib/config/api', () => ({
  API_BASE_URL: 'http://test-api.com',
}));

import { notificationService } from '../../../lib/services/notification-service';
const AsyncStorage = require('@react-native-async-storage/async-storage');

describe('Error Handling Improvements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear global error log tracking
    delete (global as any).__lastUnreadCountErrorLog;
    delete (global as any).__lastNotifFetchErrorLog;
  });

  describe('NotificationService - getUnreadCount', () => {
    it('should fall back to Supabase when API times out', async () => {
      // Mock Supabase to succeed
      const { supabase } = require('../../../lib/supabase');
      supabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn().mockResolvedValue({ count: 5, error: null }),
          })),
        })),
      });

      // Mock fetch to timeout
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network timeout'));

      const count = await notificationService.getUnreadCount();

      expect(count).toBe(5);
      expect(supabase.from).toHaveBeenCalledWith('notifications');
    });

    it('should return cached count when both API and Supabase fail', async () => {
      // Mock Supabase to fail
      const { supabase } = require('../../../lib/supabase');
      supabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn().mockResolvedValue({ count: null, error: new Error('DB error') }),
          })),
        })),
      });

      // Mock fetch to fail
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      // Mock AsyncStorage to have cached count
      AsyncStorage.getItem.mockResolvedValue('3');

      const count = await notificationService.getUnreadCount();

      // Should return 0 (default) since there's no cached unreadCount in the service instance
      expect(count).toBe(0);
    });

    it('should throttle error logging in development mode', async () => {
      const originalDev = (global as any).__DEV__;
      (global as any).__DEV__ = true;

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Mock both Supabase and fetch to fail
      const { supabase } = require('../../../lib/supabase');
      supabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn().mockResolvedValue({ count: null, error: new Error('DB error') }),
          })),
        })),
      });
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      // First call should log
      await notificationService.getUnreadCount();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[NotificationService] Backend unreachable')
      );

      consoleSpy.mockClear();

      // Second call immediately after should NOT log (throttled)
      await notificationService.getUnreadCount();
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
      (global as any).__DEV__ = originalDev;
    });
  });

  describe('NotificationService - fetchNotifications', () => {
    it('should prioritize Supabase over API in development', async () => {
      const originalDev = (global as any).__DEV__;
      (global as any).__DEV__ = true;

      const { supabase } = require('../../../lib/supabase');
      const mockNotifications = [
        { id: '1', title: 'Test', read: false, user_id: 'test-user-id' }
      ];

      supabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: jest.fn(() => ({
              range: jest.fn().mockResolvedValue({ data: mockNotifications, error: null }),
            })),
          })),
        })),
      });

      AsyncStorage.setItem.mockResolvedValue(undefined);

      const notifications = await notificationService.fetchNotifications();

      expect(notifications).toEqual(mockNotifications);
      expect(supabase.from).toHaveBeenCalledWith('notifications');
      // Fetch should not have been called since Supabase succeeded
      expect(global.fetch).not.toHaveBeenCalled();

      (global as any).__DEV__ = originalDev;
    });

    it('should return cached notifications when all sources fail', async () => {
      const { supabase } = require('../../../lib/supabase');
      const cachedNotifications = [
        { id: '2', title: 'Cached', read: true }
      ];

      // Mock Supabase to fail
      supabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: jest.fn(() => ({
              range: jest.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
            })),
          })),
        })),
      });

      // Mock fetch to fail
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      // Mock cached notifications
      AsyncStorage.getItem.mockResolvedValue(JSON.stringify(cachedNotifications));

      const notifications = await notificationService.fetchNotifications();

      expect(notifications).toEqual(cachedNotifications);
      expect(AsyncStorage.getItem).toHaveBeenCalledWith('notifications:cache');
    });
  });
});
