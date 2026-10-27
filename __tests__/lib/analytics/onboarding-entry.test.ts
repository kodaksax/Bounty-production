// __tests__/lib/analytics/onboarding-entry.test.ts
//
// Contract for lib/analytics/onboarding-entry.ts. Each scenario states the
// expected events and which PostHog identity they belong to:
//   - one onboarding_started per journey, on whichever step it first reaches
//   - a later visit in a new app process emits onboarding_resumed instead
//   - the same visit continuing (remount, Strict Mode, sign-up) emits nothing
//   - a journey is the anonymous id + user id, so a pre-auth start belongs to
//     the account it signs up as, and a second account on the device starts anew
//   - a broken guard never suppresses the event

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const mockGetAnonymousId = jest.fn();
jest.mock('lib/posthog', () => ({
  getAnonymousId: () => mockGetAnonymousId(),
}));

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetOnboardingEntryForTests,
  onboardingStepFromPath,
  trackOnboardingEntry,
} from 'lib/analytics/onboarding-entry';
import { analyticsService } from 'lib/services/analytics-service';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockTrack = analyticsService.trackEvent as jest.Mock;

// A tiny in-memory AsyncStorage so state carries across "launches".
let store: Record<string, string> = {};

/** A fresh JS runtime: in-memory dedupe gone, AsyncStorage kept. */
const relaunch = () => __resetOnboardingEntryForTests();

const eventNames = () => mockTrack.mock.calls.map(call => call[0]);

beforeEach(() => {
  jest.clearAllMocks();
  store = {};
  relaunch();
  mockGetAnonymousId.mockReturnValue('anon-1');
  mockGetItem.mockImplementation(async (key: string) => store[key] ?? null);
  mockSetItem.mockImplementation(async (key: string, value: string) => {
    store[key] = value;
  });
});

describe('trackOnboardingEntry', () => {
  it('first-time visitor on Welcome: one onboarding_started, anonymous', async () => {
    await trackOnboardingEntry({ step: 'welcome', userId: null, intent: null });

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith('onboarding_started', {
      entry_point: 'welcome',
      authenticated: false,
      intent: 'none',
    });
  });

  it('signup continuing to the style step in the same launch emits nothing more', async () => {
    // Welcome (anonymous) -> sign-up -> /onboarding/style (signed in). The
    // anonymous id is merged into user-1 by identify(), so the one start
    // already belongs to user-1.
    await trackOnboardingEntry({ step: 'welcome', userId: null, intent: null });
    await trackOnboardingEntry({ step: 'style', userId: 'user-1', intent: null });

    expect(eventNames()).toEqual(['onboarding_started']);
  });

  it('a signed-up user reopening the app mid-onboarding emits onboarding_resumed, not a second start', async () => {
    await trackOnboardingEntry({ step: 'welcome', userId: null, intent: null });
    await trackOnboardingEntry({ step: 'style', userId: 'user-1', intent: null });

    relaunch();
    await trackOnboardingEntry({ step: 'poster-profile', userId: 'user-1', intent: 'poster' });

    expect(eventNames()).toEqual(['onboarding_started', 'onboarding_resumed']);
    expect(mockTrack).toHaveBeenLastCalledWith('onboarding_resumed', {
      entry_point: 'poster-profile',
      authenticated: true,
      intent: 'poster',
    });
  });

  it('hunter resume carries the hunter intent and entry point', async () => {
    await trackOnboardingEntry({ step: 'style', userId: 'user-1', intent: null });
    relaunch();
    await trackOnboardingEntry({ step: 'payouts', userId: 'user-1', intent: 'hunter' });

    expect(mockTrack).toHaveBeenLastCalledWith('onboarding_resumed', {
      entry_point: 'payouts',
      authenticated: true,
      intent: 'hunter',
    });
  });

  it('the resume is recognised by user id even after the anonymous id changed (reinstall-less logout/login)', async () => {
    await trackOnboardingEntry({ step: 'style', userId: 'user-1', intent: null });
    relaunch();
    mockGetAnonymousId.mockReturnValue('anon-2');
    await trackOnboardingEntry({ step: 'location', userId: 'user-1', intent: null });

    expect(eventNames()).toEqual(['onboarding_started', 'onboarding_resumed']);
  });

  it('returning-device sign-up that never saw Welcome starts at the style step, authenticated', async () => {
    // app/index.tsx shows the log-in form to a device that has signed in
    // before; "Create account" there lands on /onboarding/style directly.
    mockGetAnonymousId.mockReturnValue('anon-after-logout');
    await trackOnboardingEntry({ step: 'style', userId: 'user-2', intent: null });

    expect(mockTrack).toHaveBeenCalledWith('onboarding_started', {
      entry_point: 'style',
      authenticated: true,
      intent: 'none',
    });
  });

  it('a second account on the same device after logout gets its own start', async () => {
    await trackOnboardingEntry({ step: 'welcome', userId: null, intent: null });
    await trackOnboardingEntry({ step: 'style', userId: 'user-1', intent: null });

    // Logout: analyticsService.reset() -> PostHog issues a new anonymous id.
    relaunch();
    mockGetAnonymousId.mockReturnValue('anon-2');
    await trackOnboardingEntry({ step: 'style', userId: 'user-2', intent: null });

    expect(eventNames()).toEqual(['onboarding_started', 'onboarding_started']);
  });

  it('concurrent calls (Strict Mode double effect) emit once', async () => {
    await Promise.all([
      trackOnboardingEntry({ step: 'welcome', userId: null, intent: null }),
      trackOnboardingEntry({ step: 'welcome', userId: null, intent: null }),
    ]);

    expect(mockTrack).toHaveBeenCalledTimes(1);
  });

  it('an unreadable guard still emits onboarding_started rather than nothing', async () => {
    mockGetItem.mockRejectedValue(new Error('storage unavailable'));

    await trackOnboardingEntry({ step: 'welcome', userId: null, intent: null });

    expect(eventNames()).toEqual(['onboarding_started']);
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('a failed guard write still emits the event', async () => {
    mockSetItem.mockRejectedValue(new Error('disk full'));

    await trackOnboardingEntry({ step: 'welcome', userId: null, intent: null });

    expect(eventNames()).toEqual(['onboarding_started']);
  });

  it('a corrupt stored value is treated as "never started"', async () => {
    store['@bounty/onboarding/started_journeys'] = '{not json';

    await trackOnboardingEntry({ step: 'welcome', userId: null, intent: null });

    expect(eventNames()).toEqual(['onboarding_started']);
  });

  it('still emits (through the same analytics service) when PostHog is not configured', async () => {
    // With no PostHog client the capture inside trackEvent is a no-op — the
    // existing tracking-disabled contract — but this module adds no gate of its own.
    mockGetAnonymousId.mockReturnValue(null);

    await trackOnboardingEntry({ step: 'welcome', userId: null, intent: null });

    expect(eventNames()).toEqual(['onboarding_started']);
  });

  it('never throws when analytics fails', async () => {
    mockTrack.mockRejectedValueOnce(new Error('boom'));

    await expect(
      trackOnboardingEntry({ step: 'welcome', userId: null, intent: null })
    ).resolves.toBeUndefined();
  });
});

describe('onboardingStepFromPath', () => {
  it.each([
    ['/onboarding/welcome', 'welcome'],
    ['/onboarding/style', 'style'],
    ['/onboarding/role-select', 'role-select'],
    ['/onboarding/poster-profile/', 'poster-profile'],
  ])('%s -> %s', (pathname, step) => {
    expect(onboardingStepFromPath(pathname)).toBe(step);
  });

  it.each(['/onboarding', '/onboarding/', '/', '/tabs/bounty-app', '/onboarding/unknown', '', null, undefined])(
    'is null for %p (the gate, other routes, unknown steps)',
    pathname => {
      expect(onboardingStepFromPath(pathname as string | null | undefined)).toBeNull();
    }
  );
});
