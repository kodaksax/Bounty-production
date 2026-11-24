// __tests__/lib/analytics/screen-tracking.test.ts
// Tests for lib/analytics/screen-tracking.ts

jest.mock('../../../lib/posthog', () => ({
  capture: jest.fn(),
  screen: jest.fn(),
}));

import { capture as posthogCapture, screen as posthogScreen } from '../../../lib/posthog';
import {
  SCREEN_SETTLE_MS,
  __resetScreenTrackingStateForTests,
  clearShellTab,
  markPendingNavigationSource,
  trackScreenView,
  trackShellRouteView,
  trackShellTabView,
} from '../../../lib/analytics/screen-tracking';

const mockCapture = posthogCapture as jest.MockedFunction<typeof posthogCapture>;
const mockScreen = posthogScreen as jest.MockedFunction<typeof posthogScreen>;

const T0 = new Date('2026-11-24T12:00:00.000Z').getTime();

/** Puts `name` on top and lets it settle. */
const settle = (name: string, opts?: Parameters<typeof trackScreenView>[1]) => {
  trackScreenView(name, opts);
  jest.advanceTimersByTime(SCREEN_SETTLE_MS);
};

const reportedNames = () => mockScreen.mock.calls.map(call => call[0]);

// The module keeps mutable state at module scope (current screen, last-viewed
// timestamp, a small back-stack, the pending view), so every test starts from
// a fresh instance.
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
  jest.clearAllMocks();
  __resetScreenTrackingStateForTests();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('trackScreenView', () => {
  test('first view has no previous_screen or seconds_on_previous_screen', () => {
    settle('home_feed');
    expect(mockScreen).toHaveBeenCalledWith(
      'home_feed',
      { screen_name: 'home_feed', navigation_source: 'push', settle_ms: SCREEN_SETTLE_MS },
      { timestamp: new Date(T0) }
    );
  });

  test('screen_viewed is retired: navigation emits only the native $screen event', () => {
    settle('home_feed');
    settle('bounty_detail', { source: 'push' });
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockScreen).toHaveBeenCalledTimes(2);
  });

  test('a real navigation includes previous_screen and seconds on the previous screen', () => {
    settle('home_feed');
    jest.advanceTimersByTime(4_250);
    settle('bounty_detail', { source: 'push' });
    expect(mockScreen).toHaveBeenLastCalledWith(
      'bounty_detail',
      {
        screen_name: 'bounty_detail',
        previous_screen: 'home_feed',
        navigation_source: 'push',
        // From home_feed appearing to bounty_detail appearing: 0.75 s + 4.25 s.
        seconds_on_previous_screen: 5,
        settle_ms: SCREEN_SETTLE_MS,
      },
      { timestamp: new Date(T0 + SCREEN_SETTLE_MS + 4_250) }
    );
  });

  test('repeated calls for the same screen are a no-op (dedupes re-renders)', () => {
    trackScreenView('home_feed');
    trackScreenView('home_feed');
    jest.advanceTimersByTime(SCREEN_SETTLE_MS);
    trackScreenView('home_feed');
    jest.advanceTimersByTime(SCREEN_SETTLE_MS);
    expect(mockScreen).toHaveBeenCalledTimes(1);
  });

  test('a repeat call while pending does not restart the settle window', () => {
    trackScreenView('home_feed');
    jest.advanceTimersByTime(SCREEN_SETTLE_MS - 100);
    trackScreenView('home_feed');
    jest.advanceTimersByTime(100);
    expect(reportedNames()).toEqual(['home_feed']);
  });

  test('navigating back to the prior screen is inferred as source "back"', () => {
    settle('home_feed');
    settle('bounty_detail', { source: 'push' });
    settle('home_feed');
    expect(mockScreen).toHaveBeenLastCalledWith(
      'home_feed',
      expect.objectContaining({
        previous_screen: 'bounty_detail',
        navigation_source: 'back',
      }),
      expect.anything()
    );
  });

  test('extra properties are merged into the event', () => {
    settle('bounty_detail', { properties: { bounty_id: 'abc-123' } });
    expect(mockScreen).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ bounty_id: 'abc-123' }),
      expect.anything()
    );
  });
});

describe('settle window (2026-11-23 audit duplicates)', () => {
  test('nothing is reported before the screen has settled', () => {
    trackScreenView('home_feed');
    jest.advanceTimersByTime(SCREEN_SETTLE_MS - 1);
    expect(mockScreen).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(mockScreen).toHaveBeenCalledTimes(1);
  });

  test('a redirect gate replaced before it settles is never reported', () => {
    // app/index.tsx ("home") -> router.replace to the feed 23 ms later.
    trackScreenView('home');
    jest.advanceTimersByTime(23);
    settle('onboarding_welcome');
    expect(reportedNames()).toEqual(['onboarding_welcome']);
    expect(mockScreen.mock.calls[0][1]).not.toHaveProperty('previous_screen');
  });

  test('a chain of gates collapses to the screen the person lands on', () => {
    // home -> onboarding index -> onboarding_style, as seen in production.
    trackScreenView('home');
    jest.advanceTimersByTime(265);
    trackScreenView('onboarding');
    jest.advanceTimersByTime(29);
    settle('onboarding_style');
    expect(reportedNames()).toEqual(['onboarding_style']);
  });

  test('a transient route state (A -> B -> A) reports nothing new', () => {
    // onboarding_style -> onboarding -> onboarding_style within 250 ms.
    settle('onboarding_style');
    trackScreenView('onboarding');
    jest.advanceTimersByTime(40);
    trackScreenView('onboarding_style');
    jest.advanceTimersByTime(SCREEN_SETTLE_MS * 2);
    expect(reportedNames()).toEqual(['onboarding_style']);
  });

  test('a tab swiped through is dropped; seconds_on_previous_screen spans it', () => {
    settle('home_feed', { source: 'push' });
    jest.advanceTimersByTime(2_250); // 3 s on home_feed so far
    trackScreenView('wallet', { source: 'tab' });
    jest.advanceTimersByTime(400);
    settle('messages', { source: 'tab' });
    expect(reportedNames()).toEqual(['home_feed', 'messages']);
    expect(mockScreen).toHaveBeenLastCalledWith(
      'messages',
      expect.objectContaining({
        previous_screen: 'home_feed',
        seconds_on_previous_screen: 3,
      }),
      { timestamp: new Date(T0 + SCREEN_SETTLE_MS + 2_250 + 400) }
    );
  });

  test('a screen that settles is reported even if the next one follows later', () => {
    settle('wallet', { source: 'tab' });
    jest.advanceTimersByTime(10);
    settle('messages', { source: 'tab' });
    expect(reportedNames()).toEqual(['wallet', 'messages']);
  });

  test('back inference ignores screens that never settled', () => {
    settle('search');
    settle('profile_other');
    // search flashes under the open profile, then the profile again.
    trackScreenView('search');
    jest.advanceTimersByTime(120);
    trackScreenView('profile_other');
    jest.advanceTimersByTime(SCREEN_SETTLE_MS);
    settle('search');
    expect(reportedNames()).toEqual(['search', 'profile_other', 'search']);
    expect(mockScreen.mock.calls[2][1]).toMatchObject({ navigation_source: 'back' });
  });
});

describe('pending deep-link source', () => {
  test('applies to the next reported view, then clears', () => {
    markPendingNavigationSource('deep_link');
    settle('bounty_detail');
    expect(mockScreen).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ navigation_source: 'deep_link' }),
      expect.anything()
    );

    settle('profile');
    expect(mockScreen).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ navigation_source: 'push' }),
      expect.anything()
    );
  });

  test('survives a redirect gate passed through on the way', () => {
    markPendingNavigationSource('deep_link');
    trackScreenView('home');
    jest.advanceTimersByTime(50);
    settle('bounty_detail_public');
    expect(reportedNames()).toEqual(['bounty_detail_public']);
    expect(mockScreen.mock.calls[0][1]).toMatchObject({ navigation_source: 'deep_link' });
  });
});

describe('tab shell hand-off', () => {
  test('returning to the shell route reports the shell tab as a back navigation', () => {
    trackShellTabView('home_feed', { source: 'push' });
    jest.advanceTimersByTime(SCREEN_SETTLE_MS);
    settle('bounty_detail');
    trackShellRouteView();
    jest.advanceTimersByTime(SCREEN_SETTLE_MS);
    expect(reportedNames()).toEqual(['home_feed', 'bounty_detail', 'home_feed']);
    expect(mockScreen.mock.calls[2][1]).toMatchObject({
      previous_screen: 'bounty_detail',
      navigation_source: 'back',
    });
  });

  test('a route that flashes over the shell is dropped, not reported late', () => {
    // home_feed -> onboarding -> home_feed (0/0 ms in production).
    trackShellTabView('home_feed', { source: 'push' });
    jest.advanceTimersByTime(SCREEN_SETTLE_MS);
    trackScreenView('onboarding');
    jest.advanceTimersByTime(30);
    trackShellRouteView();
    jest.advanceTimersByTime(SCREEN_SETTLE_MS * 2);
    expect(reportedNames()).toEqual(['home_feed']);
  });

  test('the shell route reported before the shell names its tab drops the gate only', () => {
    trackScreenView('home');
    jest.advanceTimersByTime(20);
    trackShellRouteView();
    jest.advanceTimersByTime(SCREEN_SETTLE_MS);
    expect(mockScreen).not.toHaveBeenCalled();
    trackShellTabView('home_feed', { source: 'push' });
    jest.advanceTimersByTime(SCREEN_SETTLE_MS);
    expect(reportedNames()).toEqual(['home_feed']);
  });

  test('the shell and the route tracker naming the same tab report it once', () => {
    trackShellTabView('home_feed', { source: 'notification' });
    trackShellRouteView({ source: 'notification' });
    jest.advanceTimersByTime(SCREEN_SETTLE_MS);
    expect(mockScreen).toHaveBeenCalledTimes(1);
    expect(mockScreen.mock.calls[0][1]).toMatchObject({ navigation_source: 'notification' });
  });

  test('after the shell unmounts its last tab is forgotten', () => {
    trackShellTabView('wallet', { source: 'tab' });
    jest.advanceTimersByTime(SCREEN_SETTLE_MS);
    clearShellTab();
    settle('auth_sign_in_form');
    trackShellRouteView();
    jest.advanceTimersByTime(SCREEN_SETTLE_MS);
    expect(reportedNames()).toEqual(['wallet', 'auth_sign_in_form']);
  });
});
