/**
 * Unit tests for Notification Service
 * Tests permission status retrieval and caching functionality
 */

// Mock modules before importing notification service
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
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
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => ({
            range: jest.fn().mockResolvedValue({ data: [], error: null }),
          })),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      upsert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      insert: jest.fn().mockResolvedValue({ error: null }),
      update: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      })),
    })),
  },
}));

jest.mock('../../../lib/config/api', () => ({
  API_BASE_URL: 'http://test-api.com',
}));

import { notificationService } from '../../../lib/services/notification-service';

const Notifications = require('expo-notifications');
const AsyncStorage = require('@react-native-async-storage/async-storage');

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console.error for expected errors in tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console.error after each test
    (console.error as jest.Mock).mockRestore();
  });

  describe('getPermissionStatus', () => {
    it('should return "granted" when permission is granted', async () => {
      Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
      AsyncStorage.setItem.mockResolvedValue(undefined);

      const result = await notificationService.getPermissionStatus();

      expect(result).toBe('granted');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'notifications:permission_status',
        'granted'
      );
    });

    it('should return "denied" when permission is denied', async () => {
      Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
      AsyncStorage.setItem.mockResolvedValue(undefined);

      const result = await notificationService.getPermissionStatus();

      expect(result).toBe('denied');
    });

    it('should return "undetermined" when permission is undetermined', async () => {
      Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
      AsyncStorage.setItem.mockResolvedValue(undefined);

      const result = await notificationService.getPermissionStatus();

      expect(result).toBe('undetermined');
    });

    it('should normalize unexpected status values to "undetermined"', async () => {
      // iOS can return 'restricted' which is not in our expected values
      Notifications.getPermissionsAsync.mockResolvedValue({ status: 'restricted' });
      AsyncStorage.setItem.mockResolvedValue(undefined);

      const result = await notificationService.getPermissionStatus();

      expect(result).toBe('undetermined');
    });

    it('should fallback to cached status when getPermissionsAsync fails', async () => {
      Notifications.getPermissionsAsync.mockRejectedValue(new Error('Permission error'));
      AsyncStorage.getItem.mockResolvedValue('granted');

      const result = await notificationService.getPermissionStatus();

      expect(result).toBe('granted');
    });

    it('should return "undetermined" when both API and cache fail', async () => {
      Notifications.getPermissionsAsync.mockRejectedValue(new Error('Permission error'));
      AsyncStorage.getItem.mockRejectedValue(new Error('Storage error'));

      const result = await notificationService.getPermissionStatus();

      expect(result).toBe('undetermined');
    });

    it('should normalize cached status values', async () => {
      Notifications.getPermissionsAsync.mockRejectedValue(new Error('Permission error'));
      // Cached value is an unexpected value
      AsyncStorage.getItem.mockResolvedValue('unknown');

      const result = await notificationService.getPermissionStatus();

      expect(result).toBe('undetermined');
    });
  });

  describe('getStoredPermissionStatus', () => {
    it('should return cached "granted" status', async () => {
      AsyncStorage.getItem.mockResolvedValue('granted');

      const result = await notificationService.getStoredPermissionStatus();

      expect(result).toBe('granted');
      expect(AsyncStorage.getItem).toHaveBeenCalledWith('notifications:permission_status');
    });

    it('should return cached "denied" status', async () => {
      AsyncStorage.getItem.mockResolvedValue('denied');

      const result = await notificationService.getStoredPermissionStatus();

      expect(result).toBe('denied');
    });

    it('should return cached "undetermined" status', async () => {
      AsyncStorage.getItem.mockResolvedValue('undetermined');

      const result = await notificationService.getStoredPermissionStatus();

      expect(result).toBe('undetermined');
    });

    it('should return null when no cached status exists', async () => {
      AsyncStorage.getItem.mockResolvedValue(null);

      const result = await notificationService.getStoredPermissionStatus();

      expect(result).toBeNull();
    });

    it('should return null when AsyncStorage fails', async () => {
      AsyncStorage.getItem.mockRejectedValue(new Error('Storage error'));

      const result = await notificationService.getStoredPermissionStatus();

      expect(result).toBeNull();
    });

    it('should normalize unexpected cached values to "undetermined"', async () => {
      AsyncStorage.getItem.mockResolvedValue('restricted');

      const result = await notificationService.getStoredPermissionStatus();

      expect(result).toBe('undetermined');
    });
  });
});
