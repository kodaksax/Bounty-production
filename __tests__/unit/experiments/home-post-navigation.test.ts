/**
 * home_post_navigation_test (lib/experiments/home-post-navigation.ts): which
 * arm a user gets, when the answer can be trusted, that it never changes
 * within an app process, and that exposure is recorded once, for enrolled
 * users only.
 */

const mockPosthog = {
  ready: true,
  settledFor: null as string | null,
  cacheIsFor: null as string | null,
  result: undefined as { key: string; enabled: boolean; variant?: string } | undefined,
  listeners: new Set<() => void>(),
  getFeatureFlagResult: jest.fn(),
  register: jest.fn(),
};

jest.mock('../../../lib/posthog', () => ({
  isPostHogReady: () => mockPosthog.ready,
  featureFlagsSettledFor: (id: string) => mockPosthog.settledFor === id,
  featureFlagsAreFor: (id: string) =>
    mockPosthog.settledFor === id || mockPosthog.cacheIsFor === id,
  getFeatureFlagResult: (...args: any[]) => {
    mockPosthog.getFeatureFlagResult(...args);
    return mockPosthog.result;
  },
  onFeatureFlagsSettled: (listener: () => void) => {
    mockPosthog.listeners.add(listener);
    return () => mockPosthog.listeners.delete(listener);
  },
  register: (...args: any[]) => mockPosthog.register(...args),
}));

const mockTrackEvent = jest.fn();
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...args: any[]) => mockTrackEvent(...args) },
}));

jest.mock('expo-application', () => ({ nativeApplicationVersion: '2.1.9' }), { virtual: true });

import {
  CONTROL_EXPERIENCE,
  HOME_POST_NAVIGATION_FLAG,
  __resetNavigationExperimentForTests,
  centerTabFor,
  getResolvedNavigationExperience,
  launchTabFor,
  recordNavigationExposure,
  resolveNavigationExperience,
  swipeOrderFor,
  tabOrderFor,
} from '../../../lib/experiments/home-post-navigation';

const flagsSettle = (forId: string, result?: typeof mockPosthog.result) => {
  mockPosthog.settledFor = forId;
  mockPosthog.result = result;
  mockPosthog.listeners.forEach(listener => listener());
};

const variant = (v: string) => ({ key: HOME_POST_NAVIGATION_FLAG, enabled: true, variant: v });

beforeEach(() => {
  jest.useRealTimers();
  __resetNavigationExperimentForTests();
  mockPosthog.ready = true;
  mockPosthog.settledFor = null;
  mockPosthog.cacheIsFor = null;
  mockPosthog.result = undefined;
  mockPosthog.listeners.clear();
  mockPosthog.getFeatureFlagResult.mockClear();
  mockPosthog.register.mockClear();
  mockTrackEvent.mockClear();
});

describe('layout', () => {
  it('control keeps Home in the centre and launches on it', () => {
    expect(tabOrderFor('control')).toEqual(['messages', 'wallet', 'bounty', 'postings', 'profile']);
    expect(centerTabFor('control')).toBe('bounty');
    expect(launchTabFor('control')).toBe('bounty');
  });

  it('post_first swaps Home and Post and launches on Post', () => {
    expect(tabOrderFor('post_first')).toEqual(['messages', 'wallet', 'postings', 'bounty', 'profile']);
    expect(centerTabFor('post_first')).toBe('postings');
    expect(launchTabFor('post_first')).toBe('postings');
  });

  it('drops Profile from the swipe order when Admin takes its slot', () => {
    expect(swipeOrderFor('post_first', true)).toEqual(['messages', 'wallet', 'postings', 'bounty']);
    expect(swipeOrderFor('control', true)).toEqual(['messages', 'wallet', 'bounty', 'postings']);
  });
});

describe('resolveNavigationExperience', () => {
  it('shows control at once when PostHog is unavailable', async () => {
    mockPosthog.ready = false;
    await expect(resolveNavigationExperience('u1')).resolves.toEqual(CONTROL_EXPERIENCE);
    expect(mockPosthog.register).toHaveBeenCalledWith({ nav_experience: 'flag_unavailable' });
  });

  it('uses flags already settled for this user without waiting', async () => {
    mockPosthog.settledFor = 'u1';
    mockPosthog.result = variant('post_first');
    await expect(resolveNavigationExperience('u1')).resolves.toEqual({
      variant: 'post_first',
      enrollment: 'enrolled',
    });
    // Reading the flag to decide must not count as exposure.
    expect(mockPosthog.getFeatureFlagResult).toHaveBeenCalledWith(HOME_POST_NAVIGATION_FLAG, {
      sendEvent: false,
    });
    expect(mockPosthog.register).toHaveBeenCalledWith({ nav_experience: 'post_first' });
  });

  it.each([
    ['an off flag', { key: HOME_POST_NAVIGATION_FLAG, enabled: false }],
    ['an unknown variant', variant('post_first_v2')],
  ])('treats %s as not enrolled, on control', async (_label, result) => {
    mockPosthog.settledFor = 'u1';
    mockPosthog.result = result;
    await expect(resolveNavigationExperience('u1')).resolves.toEqual({
      variant: 'control',
      enrollment: 'not_enrolled',
    });
  });

  it("waits for this user's flags to arrive", async () => {
    const promise = resolveNavigationExperience('u1', 5_000);
    flagsSettle('anon-id', variant('control')); // someone else's answer: keep waiting
    flagsSettle('u1', variant('post_first'));
    await expect(promise).resolves.toEqual({ variant: 'post_first', enrollment: 'enrolled' });
  });

  it("falls back to this user's own cache when the flags request is slow", async () => {
    jest.useFakeTimers();
    mockPosthog.cacheIsFor = 'u1';
    mockPosthog.result = variant('post_first');
    const promise = resolveNavigationExperience('u1', 1_000);
    jest.advanceTimersByTime(1_000);
    await expect(promise).resolves.toEqual({ variant: 'post_first', enrollment: 'enrolled' });
  });

  it("never uses a cache that isn't this user's (just signed in)", async () => {
    jest.useFakeTimers();
    mockPosthog.cacheIsFor = 'previous-user';
    mockPosthog.result = variant('post_first');
    const promise = resolveNavigationExperience('u1', 1_000);
    jest.advanceTimersByTime(1_000);
    await expect(promise).resolves.toEqual(CONTROL_EXPERIENCE);
  });

  it('keeps the first answer for the rest of the process', async () => {
    mockPosthog.settledFor = 'u1';
    mockPosthog.result = variant('control');
    await resolveNavigationExperience('u1');
    // The flag flips mid-session (a rollout edit): the user keeps their arm.
    flagsSettle('u1', variant('post_first'));
    await expect(resolveNavigationExperience('u1')).resolves.toEqual({
      variant: 'control',
      enrollment: 'enrolled',
    });
    expect(getResolvedNavigationExperience('u1')).toEqual({ variant: 'control', enrollment: 'enrolled' });
  });

  it('shares one resolution between concurrent callers', async () => {
    const a = resolveNavigationExperience('u1', 5_000);
    const b = resolveNavigationExperience('u1', 5_000);
    flagsSettle('u1', variant('post_first'));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
    expect(mockPosthog.register).toHaveBeenCalledTimes(1);
  });
});

describe('recordNavigationExposure', () => {
  const context = {
    landingTab: 'postings',
    landingReason: 'app_launch',
    primaryRole: 'poster',
    accountCreatedAt: new Date(Date.now() - 3 * 86_400_000 - 1000).toISOString(),
  };

  it('records one exposure per user with the rendered arm', () => {
    const experience = { variant: 'post_first' as const, enrollment: 'enrolled' as const };
    recordNavigationExposure('u1', experience, context);
    recordNavigationExposure('u1', experience, context);

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'navigation_experiment_exposed',
      expect.objectContaining({
        experiment: HOME_POST_NAVIGATION_FLAG,
        variant: 'post_first',
        [`$feature/${HOME_POST_NAVIGATION_FLAG}`]: 'post_first',
        landing_tab: 'postings',
        landing_reason: 'app_launch',
        auth_state: 'authenticated',
        primary_role: 'poster',
        account_age_days: 3,
        app_version: '2.1.9',
      })
    );
    // This read is the one that records $feature_flag_called.
    expect(mockPosthog.getFeatureFlagResult).toHaveBeenCalledWith(HOME_POST_NAVIGATION_FLAG);
  });

  it('records nothing for a user outside the experiment', () => {
    recordNavigationExposure('u1', { variant: 'control', enrollment: 'not_enrolled' }, context);
    recordNavigationExposure('u2', CONTROL_EXPERIENCE, context);
    expect(mockTrackEvent).not.toHaveBeenCalled();
    expect(mockPosthog.getFeatureFlagResult).not.toHaveBeenCalled();
  });
});
