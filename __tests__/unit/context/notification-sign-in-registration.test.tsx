/**
 * Sign-in never shows the OS notification dialog, and an account that already
 * granted permission still registers its push token (2026-11-17).
 *
 * NotificationProvider used to call requestPermissionsAndRegisterToken() with
 * its default prompt on mount and on every user change, which put the OS
 * dialog in front of a returning user before Home. It now passes
 * { prompt: false }: register if granted, never ask. The asks are onboarding,
 * the deferred sign-up registration and the enable_notifications moment.
 *
 * Two layers, for a poster and for a hunter (registration doesn't depend on
 * the role; both are pinned because both sign in):
 *  - the provider only ever calls with { prompt: false }, on mount and on
 *    sign-in;
 *  - the real service, called that way with permission granted, gets the
 *    Expo token and registers it, and never opens the dialog.
 */
import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';

// A stable router, as expo-router's is: a new object per render would re-run
// the provider's listener setup on every render.
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../../../lib/posthog', () => ({ capture: jest.fn() }));
jest.mock('../../../lib/services/notification-realtime', () => ({
  isNotificationsChannelConnected: jest.fn(() => false),
  subscribeToNotifications: jest.fn(() => () => {}),
}));

let mockAuthListener: ((event: string, session: any) => void) | null = null;
let mockSession: any = null;
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: mockSession } })),
      onAuthStateChange: jest.fn((cb: any) => {
        mockAuthListener = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
    },
    from: jest.fn(),
    channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() })),
    removeChannel: jest.fn(),
  },
}));

import { NotificationProvider } from '../../../lib/context/notification-context';
import { notificationService } from '../../../lib/services/notification-service';

const Notifications = require('expo-notifications');

const ACCOUNTS = [
  { role: 'poster', session: { access_token: 'tok-p', user: { id: 'poster-1' } } },
  { role: 'hunter', session: { access_token: 'tok-h', user: { id: 'hunter-1' } } },
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthListener = null;
  mockSession = null;
});

describe('NotificationProvider never prompts at sign-in', () => {
  let request: jest.SpyInstance;
  beforeEach(() => {
    request = jest.spyOn(notificationService, 'requestPermissionsAndRegisterToken').mockResolvedValue('ExponentPushToken[x]');
    jest.spyOn(notificationService, 'fetchNotifications').mockResolvedValue([]);
    jest.spyOn(notificationService, 'getUnreadCount').mockResolvedValue(0 as any);
    jest.spyOn(notificationService, 'setupNotificationListeners').mockReturnValue((() => {}) as any);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(ACCOUNTS)('a $role signing in: registers without the dialog', async ({ session }) => {
    render(
      <NotificationProvider>
        <></>
      </NotificationProvider>
    );
    await waitFor(() => expect(request).toHaveBeenCalled());

    // Signs in.
    mockSession = session;
    await act(async () => {
      mockAuthListener?.('SIGNED_IN', session);
    });
    await waitFor(() => expect(request.mock.calls.length).toBeGreaterThanOrEqual(2));

    for (const call of request.mock.calls) {
      expect(call[0]).toEqual({ prompt: false });
    }
  });
});

describe('requestPermissionsAndRegisterToken({ prompt: false })', () => {
  let register: jest.SpyInstance;
  beforeEach(() => {
    register = jest.spyOn(notificationService, 'registerPushToken').mockResolvedValue();
    jest.spyOn(notificationService as any, 'flushPendingPushTokens').mockResolvedValue(undefined);
    jest.spyOn(notificationService as any, 'ensureAndroidChannels').mockResolvedValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(ACCOUNTS)('a $role who already granted permission gets the token registered', async ({ role }) => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: `ExponentPushToken[${role}]` });

    const token = await notificationService.requestPermissionsAndRegisterToken({ prompt: false });

    expect(token).toBe(`ExponentPushToken[${role}]`);
    expect(register).toHaveBeenCalledWith(`ExponentPushToken[${role}]`);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('a user who was never asked is not asked here, and nothing is registered', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });

    const token = await notificationService.requestPermissionsAndRegisterToken({ prompt: false });

    expect(token).toBeNull();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});
