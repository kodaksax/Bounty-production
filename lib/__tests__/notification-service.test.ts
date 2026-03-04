/* eslint-env jest */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as notifModule from '../services/notification-service';
import { supabase } from '../supabase';
// Mock the imported supabase instance used by the service
jest.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn(),
  },
}));

describe('lib notification service (unit)', () => {
  const notificationService = (notifModule as any).notificationService as any;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('fetchNotifications falls back to API /api prefix when Supabase not used', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        status: 404,
        ok: false,
        clone: () => ({ text: async () => '<html>Cannot GET /' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ notifications: [] }),
      });

    (global as any).fetch = fetchMock;

    // Make supabase.auth.getSession return a session so fetchNotifications proceeds
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { access_token: 'token', user: { id: 'user-1' } } } });

    // Force supabase.from to throw so code uses API fallback
    (supabase.from as jest.Mock).mockImplementation(() => { throw new Error('Supabase fail'); });

    const result = await (notifModule as any).notificationService.fetchNotifications(10, 0);

    expect(result).toBeDefined();
    expect(fetchMock).toHaveBeenCalled();
    // second call should use /api prefix
    expect(fetchMock.mock.calls[1][0]).toContain('/api/notifications');
  });

  test('getStoredPermissionStatus returns normalized value from AsyncStorage', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('granted');
    const status = await notificationService.getStoredPermissionStatus();
    expect(status).toBe('granted');
    expect(AsyncStorage.getItem).toHaveBeenCalled();
  });

  test('setupNotificationListeners returns noop when Notifications unavailable', () => {
    const result = notificationService.setupNotificationListeners();
    expect(result).toBeDefined();
    expect(typeof result.remove).toBe('function');
    // receivedSubscription and responseSubscription use NOOP shape
    expect(result.receivedSubscription).toHaveProperty('remove');
    expect(result.responseSubscription).toHaveProperty('remove');
    // calling remove should not throw
    expect(() => result.remove()).not.toThrow();
  });
});
