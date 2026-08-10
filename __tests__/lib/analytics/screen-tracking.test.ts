// __tests__/lib/analytics/screen-tracking.test.ts
// Tests for lib/analytics/screen-tracking.ts

jest.mock('../../../lib/posthog', () => ({
  capture: jest.fn(),
}));

import { capture as posthogCapture } from '../../../lib/posthog';
import {
  __resetScreenTrackingStateForTests,
  markPendingNavigationSource,
  trackScreenView,
} from '../../../lib/analytics/screen-tracking';

const mockCapture = posthogCapture as jest.MockedFunction<typeof posthogCapture>;

// The module keeps mutable state at module scope (current screen, last-viewed
// timestamp, a small back-stack), so every test starts from a fresh instance.
beforeEach(() => {
  jest.clearAllMocks();
  __resetScreenTrackingStateForTests();
});

describe('trackScreenView', () => {
  test('first call has no previous_screen or seconds_on_previous_screen', () => {
    trackScreenView('home_feed');
    expect(mockCapture).toHaveBeenCalledWith('screen_viewed', {
      screen_name: 'home_feed',
      navigation_source: 'push',
    });
  });

  test('repeated calls for the same screen are a no-op (dedupes re-renders)', () => {
    trackScreenView('home_feed');
    trackScreenView('home_feed');
    trackScreenView('home_feed');
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  test('a real navigation includes previous_screen and an explicit source', () => {
    trackScreenView('home_feed');
    trackScreenView('bounty_detail', { source: 'push' });
    expect(mockCapture).toHaveBeenLastCalledWith('screen_viewed', {
      screen_name: 'bounty_detail',
      previous_screen: 'home_feed',
      navigation_source: 'push',
      seconds_on_previous_screen: expect.any(Number),
    });
  });

  test('navigating back to the prior screen is inferred as source "back"', () => {
    trackScreenView('home_feed');
    trackScreenView('bounty_detail', { source: 'push' });
    trackScreenView('home_feed');
    expect(mockCapture).toHaveBeenLastCalledWith('screen_viewed', {
      screen_name: 'home_feed',
      previous_screen: 'bounty_detail',
      navigation_source: 'back',
      seconds_on_previous_screen: expect.any(Number),
    });
  });

  test('a pending deep-link source is applied once, then cleared', () => {
    markPendingNavigationSource('deep_link');
    trackScreenView('bounty_detail');
    expect(mockCapture).toHaveBeenLastCalledWith(
      'screen_viewed',
      expect.objectContaining({ navigation_source: 'deep_link' })
    );

    trackScreenView('profile');
    expect(mockCapture).toHaveBeenLastCalledWith(
      'screen_viewed',
      expect.objectContaining({ navigation_source: 'push' })
    );
  });

  test('extra properties are merged into the event', () => {
    trackScreenView('bounty_detail', { properties: { bounty_id: 'abc-123' } });
    expect(mockCapture).toHaveBeenLastCalledWith(
      'screen_viewed',
      expect.objectContaining({ bounty_id: 'abc-123' })
    );
  });
});
