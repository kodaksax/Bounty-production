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
  setBadgeCountAsync: jest.fn().mockResolvedValue(true),
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
          eq: jest.fn().mockResolvedValue({ count: 0, error: null }),
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
        eq: jest.fn(() => ({
          eq: jest.fn().mockResolvedValue({ error: null }),
        })),
      })),
      delete: jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn().mockResolvedValue({ error: null }),
        })),
      })),
    })),
  },
}));

jest.mock('../../../lib/config/api', () => ({
  API_BASE_URL: 'http://test-api.com',
}));

import { notificationService } from '../../../lib/services/notification-service';
import { supabase } from '../../../lib/supabase';

const Notifications = require('expo-notifications');
const AsyncStorage = require('@react-native-async-storage/async-storage');

// ─── shared helpers ───────────────────────────────────────────────────────────

const MOCK_SESSION = {
  access_token: 'test-token',
  user: { id: 'user-123' },
};

const makeSuccessResponse = (body?: any) => ({
  ok: true,
  status: 200,
  clone: () => ({ text: async () => JSON.stringify(body ?? {}) }),
  text: async () => JSON.stringify(body ?? {}),
  json: async () => body ?? {},
});

const makeErrorResponse = (status: number, body = 'error') => ({
  ok: false,
  status,
  clone: () => ({ text: async () => body }),
  text: async () => body,
  json: async () => ({ error: body }),
});

/** Build a fresh supabase.from chain mock with optional overrides per method. */
const makeFromMock = (overrides: Record<string, any> = {}) => ({
  select: jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnValue({
        range: jest.fn().mockResolvedValue({ data: [], error: null }),
      }),
      eq: jest.fn().mockResolvedValue({ count: 0, error: null }),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }),
  insert: jest.fn().mockResolvedValue({ error: null }),
  upsert: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }),
  update: jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    }),
  }),
  delete: jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    }),
  }),
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────

describe('NotificationService', () => {
  let originalFetch: any;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton internal state between tests
    (notificationService as any).cachedNotifications = [];
    (notificationService as any).unreadCount = 0;
    // Save and default-stub global fetch
    originalFetch = (global as any).fetch;
    (global as any).fetch = jest.fn().mockResolvedValue(makeSuccessResponse());
    // Default Supabase state: no active session
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null } });
    (supabase.from as jest.Mock).mockImplementation(() => makeFromMock());
    // Suppress console output for expected errors in tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
    (console.error as jest.Mock).mockRestore?.();
    (console.warn as jest.Mock).mockRestore?.();
    (console.log as jest.Mock).mockRestore?.();
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

  describe('syncBadgeCount', () => {
    it('should call setBadgeCountAsync with unread count', async () => {
      // Mock getUnreadCount to return a known value (no session → returns 0)
      const result = await notificationService.syncBadgeCount();

      // Should call setBadgeCountAsync (available from the mock)
      expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(0);
    });

    it('should not throw when setBadgeCountAsync is unavailable', async () => {
      const original = Notifications.setBadgeCountAsync;
      Notifications.setBadgeCountAsync = undefined;

      await notificationService.syncBadgeCount();

      // Restore
      Notifications.setBadgeCountAsync = original;
    });
  });

  // ─── requestPermissionsAndRegisterToken ────────────────────────────────────

  describe('requestPermissionsAndRegisterToken', () => {
    it('should return token when permission is already granted', async () => {
      Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
      Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      AsyncStorage.setItem.mockResolvedValue(undefined);
      AsyncStorage.getItem.mockResolvedValue(null); // flushPendingPushTokens → no pending

      const result = await notificationService.requestPermissionsAndRegisterToken();

      expect(result).toBe('ExponentPushToken[abc]');
      expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });

    it('should request permission when status is undetermined and return null when denied', async () => {
      Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
      Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
      AsyncStorage.setItem.mockResolvedValue(undefined);

      const result = await notificationService.requestPermissionsAndRegisterToken();

      expect(result).toBeNull();
      expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    });

    it('should request permission, get token and register when permission is granted after request', async () => {
      Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
      Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
      Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[xyz]' });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      AsyncStorage.setItem.mockResolvedValue(undefined);
      AsyncStorage.getItem.mockResolvedValue(null);

      const result = await notificationService.requestPermissionsAndRegisterToken();

      expect(result).toBe('ExponentPushToken[xyz]');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'notifications:permission_status',
        'granted'
      );
    });

    it('should return null on unexpected error', async () => {
      Notifications.getPermissionsAsync.mockRejectedValue(new Error('native crash'));

      const result = await notificationService.requestPermissionsAndRegisterToken();

      expect(result).toBeNull();
    });

    it('should flush pending tokens after a successful registration', async () => {
      Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
      Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[new]' });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      AsyncStorage.setItem.mockResolvedValue(undefined);
      AsyncStorage.removeItem.mockResolvedValue(undefined);
      // First getItem call returns pending tokens; subsequent calls return null
      AsyncStorage.getItem.mockImplementation((key: string) => {
        if (key === 'notifications:pending_tokens') {
          return Promise.resolve(JSON.stringify([{ token: 'old-pending-tok' }]));
        }
        return Promise.resolve(null);
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeSuccessResponse());

      await notificationService.requestPermissionsAndRegisterToken();

      // flushPendingPushTokens should have cleared the pending list
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('notifications:pending_tokens');
    });

    it('should not crash when AsyncStorage throws inside flushPendingPushTokens', async () => {
      // flushPendingPushTokens wraps its entire body in try-catch so that transient
      // storage errors never bubble up to the caller.
      Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
      Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[new]' });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      AsyncStorage.setItem.mockResolvedValue(undefined);
      AsyncStorage.getItem.mockImplementation((key: string) => {
        if (key === 'notifications:pending_tokens') {
          return Promise.reject(new Error('storage unavailable'));
        }
        return Promise.resolve(null);
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeSuccessResponse());

      await expect(notificationService.requestPermissionsAndRegisterToken()).resolves.not.toThrow();
    });
  });

  // ─── registerPushToken ─────────────────────────────────────────────────────

  describe('registerPushToken', () => {
    it('should queue token and set deferred registration when there is no active session', async () => {
      AsyncStorage.getItem.mockResolvedValue(null);
      AsyncStorage.setItem.mockResolvedValue(undefined);

      await notificationService.registerPushToken('ExponentPushToken[tok]');

      expect((global as any).fetch).not.toHaveBeenCalled();
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'notifications:pending_tokens',
        expect.stringContaining('ExponentPushToken[tok]')
      );
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'notifications:register_on_signin',
        'true'
      );
    });

    it('should POST the token with correct body and auth header', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeSuccessResponse());

      await notificationService.registerPushToken('ExponentPushToken[tok]', 'device-abc');

      const [url, init] = (global as any).fetch.mock.calls[0];
      expect(url).toContain('/notifications/register-token');
      expect(init.method).toBe('POST');
      expect(init.headers['Authorization']).toBe('Bearer test-token');
      const body = JSON.parse(init.body);
      expect(body.token).toBe('ExponentPushToken[tok]');
      expect(body.deviceId).toBe('device-abc');
    });

    it('should return without throwing on 409 (token already registered)', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeErrorResponse(409));

      await expect(
        notificationService.registerPushToken('ExponentPushToken[tok]')
      ).resolves.not.toThrow();
    });

    it('should log on 500 response and attempt Supabase fallback', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeErrorResponse(500));
      (supabase.from as jest.Mock).mockImplementation(() =>
        makeFromMock({
          upsert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'tok-id' }, error: null }),
            }),
          }),
        })
      );

      await notificationService.registerPushToken('ExponentPushToken[tok]', 'device-1');

      // Supabase fallback should have been attempted
      expect(supabase.from).toHaveBeenCalledWith('push_tokens');
    });

    it('should persist via Supabase using profile_id and onConflict token when the REST route is missing (production)', async () => {
      // In production the app talks to Supabase Edge Functions where no
      // `/notifications/register-token` route exists, so the REST call 404s and
      // the Supabase fallback is the only path that persists the token.
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeErrorResponse(404));
      const upsert = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockImplementation(() => makeFromMock({ upsert }));

      await notificationService.registerPushToken('ExponentPushToken[tok]', 'device-1');

      expect(supabase.from).toHaveBeenCalledWith('push_tokens');
      expect(upsert).toHaveBeenCalledTimes(1);
      const [row, options] = upsert.mock.calls[0];
      expect(row).toMatchObject({
        profile_id: 'user-123',
        token: 'ExponentPushToken[tok]',
        device_id: 'device-1',
        enabled: true,
      });
      expect(row).not.toHaveProperty('user_id');
      expect(options).toEqual({ onConflict: 'token' });
    });

    it('should fall back to the legacy user_id column when profile_id is missing', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeErrorResponse(404));
      const upsert = jest
        .fn()
        .mockResolvedValueOnce({ error: { code: '42703', message: "column \"profile_id\" does not exist" } })
        .mockResolvedValueOnce({ error: null });
      (supabase.from as jest.Mock).mockImplementation(() => makeFromMock({ upsert }));

      await notificationService.registerPushToken('ExponentPushToken[tok]', 'device-2');

      expect(upsert).toHaveBeenCalledTimes(2);
      expect(upsert.mock.calls[0][0]).toMatchObject({ profile_id: 'user-123' });
      expect(upsert.mock.calls[1][0]).toMatchObject({ user_id: 'user-123', enabled: true });
    });

    it('should cache the token when both API and Supabase fail', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('network error'));
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('supabase down');
      });
      AsyncStorage.getItem.mockResolvedValue(null);
      AsyncStorage.setItem.mockResolvedValue(undefined);

      await notificationService.registerPushToken('ExponentPushToken[tok]');

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'notifications:pending_tokens',
        expect.stringContaining('ExponentPushToken[tok]')
      );
    });

    it('should use /api prefix as fallback when API returns 404 HTML', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          clone: () => ({ text: async () => '<html>Cannot POST /notifications/register-token' }),
          text: async () => '<html>Cannot POST /notifications/register-token',
        })
        .mockResolvedValueOnce(makeSuccessResponse());

      await notificationService.registerPushToken('ExponentPushToken[tok]');

      expect((global as any).fetch).toHaveBeenCalledTimes(2);
      expect((global as any).fetch.mock.calls[1][0]).toContain('/api/notifications/register-token');
    });

    it('should not throw when the /api fallback fetch itself throws (preserves original error path)', async () => {
      // Both the primary endpoint (404 HTML) AND the /api fallback fail.
      // fetchWithApiFallback returns the original 404 response so callers handle it.
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          clone: () => ({ text: async () => '<html>Cannot POST /notifications/register-token' }),
          text: async () => '<html>Cannot POST /notifications/register-token',
        })
        .mockRejectedValueOnce(new Error('fallback server unreachable'));
      AsyncStorage.getItem.mockResolvedValue(null);
      AsyncStorage.setItem.mockResolvedValue(undefined);

      // Must not throw — graceful degradation is the expected contract
      await expect(
        notificationService.registerPushToken('ExponentPushToken[tok]')
      ).resolves.not.toThrow();

      // Both the primary and the /api fallback were attempted
      expect((global as any).fetch).toHaveBeenCalledTimes(2);
    });

    it('should not crash when response.clone().text() throws a non-serialisable error (safeReadResponseText resilience)', async () => {
      // Simulates a consumed/unreadable response body. The error thrown by clone().text()
      // itself has a circular reference, which forces the inner JSON.stringify fallback
      // to also fail — exercising the String(e) last-resort path in safeReadResponseText.
      // The key contract: the caller must never see an exception from this helper.
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      AsyncStorage.getItem.mockResolvedValue(null);

      const circularErr: any = new Error('body stream already consumed');
      circularErr.self = circularErr; // creates circular reference so JSON.stringify throws

      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        clone: () => ({
          text: () => Promise.reject(circularErr),
        }),
      });

      await expect(
        notificationService.registerPushToken('ExponentPushToken[tok]')
      ).resolves.not.toThrow();
    });

    it('should log warning for non-404/409/5xx error responses', async () => {
      // A 4xx status that is not 404 or 409 should trigger console.warn
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeErrorResponse(403));
      AsyncStorage.getItem.mockResolvedValue(null);
      AsyncStorage.setItem.mockResolvedValue(undefined);

      await notificationService.registerPushToken('ExponentPushToken[tok]');

      expect(console.warn).toHaveBeenCalled();
    });

    it('should handle 404 non-HTML response from API (user profile missing path)', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        clone: () => ({ text: async () => '{"error":"not found"}' }), // not HTML → no /api retry
        text: async () => '{"error":"not found"}',
      });
      AsyncStorage.getItem.mockResolvedValue(null);
      AsyncStorage.setItem.mockResolvedValue(undefined);

      await notificationService.registerPushToken('ExponentPushToken[tok]');

      // Only one fetch call since the 404 body is not HTML
      expect((global as any).fetch).toHaveBeenCalledTimes(1);
    });

    it('should recognise errors with a .statusCode property as expected and skip error log', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      const err = Object.assign(new Error('Failed to register push token (409)'), {
        statusCode: 409,
      });
      (global as any).fetch = jest.fn().mockRejectedValue(err);
      AsyncStorage.getItem.mockResolvedValue(null);

      await notificationService.registerPushToken('ExponentPushToken[tok]');

      // Should NOT have logged an error for the expected 409
      expect(console.error).not.toHaveBeenCalledWith(
        'Error registering push token:',
        expect.anything()
      );
    });

    it('should recognise errors with a .status property as expected and skip error log', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      const err = Object.assign(new Error('conflict'), { status: 409 });
      (global as any).fetch = jest.fn().mockRejectedValue(err);
      AsyncStorage.getItem.mockResolvedValue(null);

      await notificationService.registerPushToken('ExponentPushToken[tok]');

      expect(console.error).not.toHaveBeenCalledWith(
        'Error registering push token:',
        expect.anything()
      );
    });

    it('should treat axios-style errors (.response.status) as expected and skip error log', async () => {
      // Axios and similar HTTP clients attach status to err.response.status rather
      // than directly to err.status or err.statusCode. The service normalises all
      // three shapes so that expected 4xx codes don't flood the error log.
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      const axiosStyleErr = Object.assign(new Error('Request failed with status 409'), {
        response: { status: 409 },
      });
      (global as any).fetch = jest.fn().mockRejectedValue(axiosStyleErr);
      AsyncStorage.getItem.mockResolvedValue(null);

      await notificationService.registerPushToken('ExponentPushToken[tok]');

      expect(console.error).not.toHaveBeenCalledWith(
        'Error registering push token:',
        expect.anything()
      );
    });
  });

  // ─── fetchNotifications ────────────────────────────────────────────────────

  describe('fetchNotifications', () => {
    it('should return empty array when there is no session', async () => {
      const result = await notificationService.fetchNotifications();

      expect(result).toEqual([]);
    });

    it('should return notifications from Supabase', async () => {
      const mockNotifs = [{ id: 'n1', user_id: 'user-123', read: false }];
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (supabase.from as jest.Mock).mockImplementation(() =>
        makeFromMock({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                range: jest.fn().mockResolvedValue({ data: mockNotifs, error: null }),
              }),
            }),
          }),
        })
      );
      AsyncStorage.setItem.mockResolvedValue(undefined);

      const result = await notificationService.fetchNotifications();

      expect(result).toEqual(mockNotifs);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'notifications:cache',
        JSON.stringify(mockNotifs)
      );
    });

    it('should fall back to API when Supabase throws', async () => {
      const mockNotif = { id: 'n2', user_id: 'user-123', read: false };
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('Supabase unavailable');
      });
      (global as any).fetch = jest
        .fn()
        .mockResolvedValue(makeSuccessResponse({ notifications: [mockNotif] }));
      AsyncStorage.setItem.mockResolvedValue(undefined);

      const result = await notificationService.fetchNotifications();

      expect(result).toEqual([mockNotif]);
    });

    it('should return cached notifications when API returns non-ok response', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('Supabase unavailable');
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeErrorResponse(503));
      AsyncStorage.getItem.mockResolvedValue(null); // empty cache

      const result = await notificationService.fetchNotifications();

      expect(result).toEqual([]);
    });

    it('should return cached notifications when fetch throws', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('Supabase unavailable');
      });
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('network down'));
      AsyncStorage.getItem.mockResolvedValue(JSON.stringify([{ id: 'cached' }]));

      const result = await notificationService.fetchNotifications();

      expect(result).toEqual([{ id: 'cached' }]);
    });

    it('should default to empty array when API response has no notifications key', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('Supabase unavailable');
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeSuccessResponse({})); // no notifications key
      AsyncStorage.setItem.mockResolvedValue(undefined);

      const result = await notificationService.fetchNotifications();

      expect(result).toEqual([]);
    });
  });

  // ─── getCachedNotifications ────────────────────────────────────────────────

  describe('getCachedNotifications', () => {
    it('should return parsed notifications from cache', async () => {
      const cached = [{ id: 'n1' }, { id: 'n2' }];
      AsyncStorage.getItem.mockResolvedValue(JSON.stringify(cached));

      const result = await notificationService.getCachedNotifications();

      expect(result).toEqual(cached);
    });

    it('should return empty array when cache is empty', async () => {
      AsyncStorage.getItem.mockResolvedValue(null);

      const result = await notificationService.getCachedNotifications();

      expect(result).toEqual([]);
    });

    it('should return empty array when AsyncStorage throws', async () => {
      AsyncStorage.getItem.mockRejectedValue(new Error('storage error'));

      const result = await notificationService.getCachedNotifications();

      expect(result).toEqual([]);
    });
  });

  // ─── getUnreadCount ────────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('should return 0 when there is no session', async () => {
      const result = await notificationService.getUnreadCount();

      expect(result).toBe(0);
    });

    it('should return count from Supabase', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (supabase.from as jest.Mock).mockImplementation(() =>
        makeFromMock({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ count: 7, error: null }),
            }),
          }),
        })
      );

      const result = await notificationService.getUnreadCount();

      expect(result).toBe(7);
    });

    it('should fall back to API when Supabase throws', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('Supabase unavailable');
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeSuccessResponse({ count: 4 }));

      const result = await notificationService.getUnreadCount();

      expect(result).toBe(4);
    });

    it('should return 0 when session has no user id (no Supabase query attempted)', async () => {
      // Session exists but has no user.id
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: { access_token: 'tok', user: null } },
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeSuccessResponse({ count: 0 }));

      const result = await notificationService.getUnreadCount();

      expect(result).toBe(0);
    });

    it('should return cached unread count when API returns non-ok response', async () => {
      (notificationService as any).unreadCount = 2;
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('Supabase unavailable');
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeErrorResponse(503));

      const result = await notificationService.getUnreadCount();

      expect(result).toBe(2);
    });

    it('should return cached count when fetch throws', async () => {
      (notificationService as any).unreadCount = 3;
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('Supabase unavailable');
      });
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('network down'));

      const result = await notificationService.getUnreadCount();

      expect(result).toBe(3);
    });
  });

  // ─── markAsRead ────────────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('should return early when there is no session', async () => {
      await notificationService.markAsRead(['n1']);

      expect((global as any).fetch).not.toHaveBeenCalled();
    });

    it('should mark notifications as read and update cache', async () => {
      (notificationService as any).cachedNotifications = [
        { id: 'n1', read: false },
        { id: 'n2', read: false },
      ];
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeSuccessResponse());
      AsyncStorage.setItem.mockResolvedValue(undefined);

      await notificationService.markAsRead(['n1']);

      expect((notificationService as any).cachedNotifications[0].read).toBe(true);
      expect((notificationService as any).cachedNotifications[1].read).toBe(false);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('notifications:cache', expect.any(String));
    });

    it('should log error when API returns non-ok response', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeErrorResponse(400));

      await notificationService.markAsRead(['n1']);

      expect(console.error).toHaveBeenCalled();
    });
  });

  // ─── markAllAsRead ─────────────────────────────────────────────────────────

  describe('markAllAsRead', () => {
    it('should return early when there is no session', async () => {
      await notificationService.markAllAsRead();

      expect((global as any).fetch).not.toHaveBeenCalled();
    });

    it('should mark all notifications as read and update cache', async () => {
      (notificationService as any).cachedNotifications = [
        { id: 'n1', read: false },
        { id: 'n2', read: false },
      ];
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeSuccessResponse());
      AsyncStorage.setItem.mockResolvedValue(undefined);

      await notificationService.markAllAsRead();

      expect((notificationService as any).cachedNotifications.every((n: any) => n.read)).toBe(true);
      expect((notificationService as any).unreadCount).toBe(0);
    });

    it('should update cached notifications in Supabase fallback and reset unread count', async () => {
      (notificationService as any).cachedNotifications = [
        { id: 'n1', read: false },
        { id: 'n2', read: false },
      ];
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeErrorResponse(503));
      (supabase.from as jest.Mock).mockImplementation(() =>
        makeFromMock({
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          }),
        })
      );
      AsyncStorage.setItem.mockResolvedValue(undefined);

      await notificationService.markAllAsRead();

      expect((notificationService as any).cachedNotifications.every((n: any) => n.read)).toBe(true);
      expect((notificationService as any).unreadCount).toBe(0);
    });
  });

  // ─── setupNotificationListeners ────────────────────────────────────────────

  describe('setupNotificationListeners', () => {
    it('should register both listeners and return remove function', () => {
      const removeReceived = jest.fn();
      const removeResponse = jest.fn();
      Notifications.addNotificationReceivedListener.mockReturnValue({ remove: removeReceived });
      Notifications.addNotificationResponseReceivedListener.mockReturnValue({
        remove: removeResponse,
      });

      const result = notificationService.setupNotificationListeners();

      expect(result.receivedSubscription).toBeDefined();
      expect(result.responseSubscription).toBeDefined();
      expect(typeof result.remove).toBe('function');
    });

    it('should call remove on both subscriptions when remove() is called', () => {
      const removeReceived = jest.fn();
      const removeResponse = jest.fn();
      Notifications.addNotificationReceivedListener.mockReturnValue({ remove: removeReceived });
      Notifications.addNotificationResponseReceivedListener.mockReturnValue({
        remove: removeResponse,
      });

      const result = notificationService.setupNotificationListeners();
      result.remove();

      expect(removeReceived).toHaveBeenCalled();
      expect(removeResponse).toHaveBeenCalled();
    });

    it('should fire onNotificationReceived callback when a notification arrives', () => {
      let capturedCallback: ((n: any) => void) | null = null;
      Notifications.addNotificationReceivedListener.mockImplementation((cb: (n: any) => void) => {
        capturedCallback = cb;
        return { remove: jest.fn() };
      });
      Notifications.addNotificationResponseReceivedListener.mockReturnValue({ remove: jest.fn() });

      const onReceived = jest.fn();
      notificationService.setupNotificationListeners(onReceived);

      capturedCallback!({ request: { content: { title: 'Hello' } } });

      expect(onReceived).toHaveBeenCalledWith({ request: { content: { title: 'Hello' } } });
    });

    it('should fire onNotificationTapped callback when user taps a notification', () => {
      Notifications.addNotificationReceivedListener.mockReturnValue({ remove: jest.fn() });
      let capturedCallback: ((r: any) => void) | null = null;
      Notifications.addNotificationResponseReceivedListener.mockImplementation(
        (cb: (r: any) => void) => {
          capturedCallback = cb;
          return { remove: jest.fn() };
        }
      );

      const onTapped = jest.fn();
      notificationService.setupNotificationListeners(undefined, onTapped);

      capturedCallback!({ notification: { request: { content: { title: 'Tapped' } } } });

      expect(onTapped).toHaveBeenCalled();
    });

    it('should return a no-op subscription when addNotificationReceivedListener is unavailable (web/simulator)', () => {
      // Simulate an environment where expo-notifications has no listener API
      const origAddReceived = Notifications.addNotificationReceivedListener;
      Notifications.addNotificationReceivedListener = undefined;

      let result: any;
      try {
        result = notificationService.setupNotificationListeners();
      } finally {
        Notifications.addNotificationReceivedListener = origAddReceived;
      }

      // The service should return usable (no-op) subscriptions rather than throwing
      expect(result).toBeDefined();
      expect(typeof result.remove).toBe('function');
      // Calling remove() on a no-op subscription must not throw
      expect(() => result.remove()).not.toThrow();
    });
  });

  // ─── clearCache ────────────────────────────────────────────────────────────

  describe('clearCache', () => {
    it('should remove cache keys from AsyncStorage and reset internal state', async () => {
      (notificationService as any).cachedNotifications = [{ id: 'x' }];
      (notificationService as any).unreadCount = 5;
      AsyncStorage.removeItem.mockResolvedValue(undefined);

      await notificationService.clearCache();

      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('notifications:cache');
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('notifications:last_fetch');
      expect((notificationService as any).cachedNotifications).toEqual([]);
      expect((notificationService as any).unreadCount).toBe(0);
    });

    it('should log error and not throw when AsyncStorage.removeItem throws', async () => {
      AsyncStorage.removeItem.mockRejectedValue(new Error('storage error'));

      await expect(notificationService.clearCache()).resolves.not.toThrow();
      expect(console.error).toHaveBeenCalled();
    });
  });

  // ─── deregisterPushToken ───────────────────────────────────────────────────

  describe('deregisterPushToken', () => {
    it('should return early when permission is not granted', async () => {
      AsyncStorage.getItem.mockResolvedValue('denied');

      await notificationService.deregisterPushToken();

      expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
      expect((global as any).fetch).not.toHaveBeenCalled();
    });

    it('should return early when stored permission status is null', async () => {
      AsyncStorage.getItem.mockResolvedValue(null);

      await notificationService.deregisterPushToken();

      expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    });

    it('should return early when there is no active session', async () => {
      AsyncStorage.getItem.mockResolvedValue('granted');
      Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[tok]' });
      // session remains null (default)

      await notificationService.deregisterPushToken();

      expect((global as any).fetch).not.toHaveBeenCalled();
    });

    it('should DELETE the token with correct body, auth header, and clear pending tokens on success', async () => {
      AsyncStorage.getItem.mockResolvedValue('granted');
      Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[tok]' });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockResolvedValue(makeSuccessResponse());
      AsyncStorage.removeItem.mockResolvedValue(undefined);

      await notificationService.deregisterPushToken();

      const [url, init] = (global as any).fetch.mock.calls[0];
      expect(url).toContain('/notifications/token');
      expect(init.method).toBe('DELETE');
      expect(init.headers['Authorization']).toBe('Bearer test-token');
      const body = JSON.parse(init.body);
      expect(body.token).toBe('ExponentPushToken[tok]');
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('notifications:pending_tokens');
    });

    it('should attempt Supabase fallback when API DELETE throws', async () => {
      AsyncStorage.getItem.mockResolvedValue('granted');
      Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[tok]' });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: MOCK_SESSION },
      });
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('network error'));
      (supabase.from as jest.Mock).mockImplementation(() =>
        makeFromMock({
          delete: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          }),
        })
      );
      AsyncStorage.removeItem.mockResolvedValue(undefined);

      await notificationService.deregisterPushToken();

      expect(supabase.from).toHaveBeenCalledWith('push_tokens');
    });

    it('should return early when getExpoPushTokenAsync throws', async () => {
      AsyncStorage.getItem.mockResolvedValue('granted');
      Notifications.getExpoPushTokenAsync.mockRejectedValue(new Error('no token'));

      await notificationService.deregisterPushToken();

      expect((global as any).fetch).not.toHaveBeenCalled();
    });

    it('should return early when getExpoPushTokenAsync resolves with no token data', async () => {
      // Devices can return a null/empty token (e.g. when push notifications
      // are not provisioned on a simulator build). Sending an empty token to
      // the API would create garbage records — the service must skip the call.
      AsyncStorage.getItem.mockResolvedValue('granted');
      Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: null });

      await notificationService.deregisterPushToken();

      expect((global as any).fetch).not.toHaveBeenCalled();
    });

    it('should log a non-fatal warning and not throw when an unexpected error occurs after token retrieval', async () => {
      // supabase.auth.getSession() throws AFTER the token is successfully retrieved.
      // This hits the outer try-catch in deregisterPushToken, confirming the method
      // surfaces a clear warning rather than silently swallowing or propagating the error.
      AsyncStorage.getItem.mockResolvedValue('granted');
      Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[tok]' });
      (supabase.auth.getSession as jest.Mock).mockRejectedValue(
        new Error('supabase session error')
      );

      await expect(notificationService.deregisterPushToken()).resolves.not.toThrow();

      expect(console.warn).toHaveBeenCalledWith(
        '[NotificationService] deregisterPushToken failed (non-fatal):',
        expect.any(Error)
      );
    });
  });

  // ─── sendCancellationRequestNotification ──────────────────────────────────

  describe('sendCancellationRequestNotification', () => {
    it('should insert a well-formed notification record when the poster requests cancellation', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockImplementation(() => makeFromMock({ insert: insertMock }));

      const result = await notificationService.sendCancellationRequestNotification(
        'recipient-1',
        'bounty-1',
        'Fix the bug',
        'poster'
      );

      expect(result).toBe(true);
      const inserted = insertMock.mock.calls[0][0];
      expect(inserted.user_id).toBe('recipient-1');
      expect(inserted.type).toBe('cancellation_request');
      expect(inserted.body).toContain('poster');
      expect(inserted.body).toContain('Fix the bug');
      expect(inserted.read).toBe(false);
      expect(inserted.data.bountyId).toBe('bounty-1');
    });

    it('should mention "hunter" in the notification body when the hunter requests cancellation', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockImplementation(() => makeFromMock({ insert: insertMock }));

      await notificationService.sendCancellationRequestNotification(
        'recipient-1',
        'bounty-1',
        'Fix the bug',
        'hunter'
      );

      const inserted = insertMock.mock.calls[0][0];
      expect(inserted.body).toContain('hunter');
      expect(inserted.body).not.toContain('poster');
    });

    it('should return false when Supabase insert returns an error', async () => {
      (supabase.from as jest.Mock).mockImplementation(() =>
        makeFromMock({
          insert: jest.fn().mockResolvedValue({ error: { message: 'constraint violation' } }),
        })
      );

      const result = await notificationService.sendCancellationRequestNotification(
        'recipient-1',
        'bounty-1',
        'Fix the bug',
        'hunter'
      );

      expect(result).toBe(false);
    });

    it('should return false and not throw when Supabase is unavailable', async () => {
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('Supabase down');
      });

      const result = await notificationService.sendCancellationRequestNotification(
        'recipient-1',
        'bounty-1',
        'Fix the bug',
        'poster'
      );

      expect(result).toBe(false);
    });
  });

  // ─── sendCancellationAcceptedNotification ─────────────────────────────────

  describe('sendCancellationAcceptedNotification', () => {
    it('should insert a notification with the refund amount correctly formatted', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockImplementation(() => makeFromMock({ insert: insertMock }));

      const result = await notificationService.sendCancellationAcceptedNotification(
        'recipient-1',
        'bounty-1',
        'Fix the bug',
        50.5
      );

      expect(result).toBe(true);
      const inserted = insertMock.mock.calls[0][0];
      expect(inserted.user_id).toBe('recipient-1');
      expect(inserted.type).toBe('cancellation_accepted');
      // toFixed(2) formatting is business logic — verify explicitly
      expect(inserted.body).toContain('50.50');
      expect(inserted.body).toContain('Fix the bug');
      expect(inserted.data.bountyId).toBe('bounty-1');
      expect(inserted.data.amount).toBe(50.5);
      expect(inserted.read).toBe(false);
    });

    it('should return false when insert returns an error', async () => {
      (supabase.from as jest.Mock).mockImplementation(() =>
        makeFromMock({
          insert: jest.fn().mockResolvedValue({ error: { message: 'db error' } }),
        })
      );

      const result = await notificationService.sendCancellationAcceptedNotification(
        'recipient-1',
        'bounty-1',
        'Fix the bug',
        50
      );

      expect(result).toBe(false);
    });

    it('should return false and not throw when Supabase is unavailable', async () => {
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('Supabase down');
      });

      const result = await notificationService.sendCancellationAcceptedNotification(
        'recipient-1',
        'bounty-1',
        'Fix the bug',
        25
      );

      expect(result).toBe(false);
    });
  });

  // ─── sendCancellationRejectedNotification ─────────────────────────────────

  describe('sendCancellationRejectedNotification', () => {
    it('should insert a notification that includes the rejection reason in the body', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockImplementation(() => makeFromMock({ insert: insertMock }));

      const result = await notificationService.sendCancellationRejectedNotification(
        'recipient-1',
        'bounty-1',
        'Fix the bug',
        'Work was already completed'
      );

      expect(result).toBe(true);
      const inserted = insertMock.mock.calls[0][0];
      expect(inserted.user_id).toBe('recipient-1');
      expect(inserted.type).toBe('cancellation_rejected');
      expect(inserted.body).toContain('Work was already completed');
      expect(inserted.body).toContain('Fix the bug');
      expect(inserted.data.bountyId).toBe('bounty-1');
      expect(inserted.read).toBe(false);
    });

    it('should return false when insert returns an error', async () => {
      (supabase.from as jest.Mock).mockImplementation(() =>
        makeFromMock({
          insert: jest.fn().mockResolvedValue({ error: { message: 'db error' } }),
        })
      );

      const result = await notificationService.sendCancellationRejectedNotification(
        'recipient-1',
        'bounty-1',
        'Fix the bug',
        'Policy violation'
      );

      expect(result).toBe(false);
    });

    it('should return false and not throw when Supabase is unavailable', async () => {
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('Supabase down');
      });

      const result = await notificationService.sendCancellationRejectedNotification(
        'recipient-1',
        'bounty-1',
        'Fix the bug',
        'Reason'
      );

      expect(result).toBe(false);
    });
  });
});
