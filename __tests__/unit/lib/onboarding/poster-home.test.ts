/**
 * The onboarding decision behind `poster-home`: one answer per app run, and
 * only an explicit `true` selects the new order.
 */

const mockGetFeatureFlag = jest.fn();
let mockFlagsListener: (() => void) | null = null;
jest.mock('../../../../lib/posthog', () => ({
  getFeatureFlag: (...args: unknown[]) => mockGetFeatureFlag(...args),
  onFeatureFlags: (listener: () => void) => {
    mockFlagsListener = listener;
    return () => {
      mockFlagsListener = null;
    };
  },
  useFeatureFlag: jest.fn(),
}));

import {
  __resetPosterHomeDecisionForTests,
  POSTER_HOME_FLAG,
  resolvePosterHomeDecision,
  stepAfterLocation,
  stepAfterRoleSelect,
} from '../../../../lib/onboarding/poster-home';

beforeEach(() => {
  jest.clearAllMocks();
  mockFlagsListener = null;
  __resetPosterHomeDecisionForTests();
});

describe('resolvePosterHomeDecision', () => {
  it('reads the poster-home flag', async () => {
    mockGetFeatureFlag.mockReturnValue(true);
    await expect(resolvePosterHomeDecision()).resolves.toBe(true);
    expect(mockGetFeatureFlag).toHaveBeenCalledWith(POSTER_HOME_FLAG);
    expect(POSTER_HOME_FLAG).toBe('poster-home');
  });

  it.each([[false], ['test'], ['control'], [null]])('treats %p as off', async value => {
    mockGetFeatureFlag.mockReturnValue(value);
    await expect(resolvePosterHomeDecision()).resolves.toBe(false);
  });

  it('keeps its first answer when the flag changes during the run', async () => {
    mockGetFeatureFlag.mockReturnValue(false);
    await resolvePosterHomeDecision();
    mockGetFeatureFlag.mockReturnValue(true);
    await expect(resolvePosterHomeDecision()).resolves.toBe(false);
  });

  it('waits for flags that have not loaded', async () => {
    mockGetFeatureFlag.mockReturnValue(undefined);
    const decision = resolvePosterHomeDecision();
    mockGetFeatureFlag.mockReturnValue(true);
    mockFlagsListener?.();
    await expect(decision).resolves.toBe(true);
  });

  it('takes the old order if flags never arrive', async () => {
    jest.useFakeTimers();
    mockGetFeatureFlag.mockReturnValue(undefined);
    const decision = resolvePosterHomeDecision();
    jest.advanceTimersByTime(400);
    jest.useRealTimers();
    await expect(decision).resolves.toBe(false);
  });
});

describe('onboarding order', () => {
  function walk(role: 'poster' | 'hunter', posterHome: boolean) {
    return {
      afterRole: stepAfterRoleSelect(role, posterHome),
      afterLocation: stepAfterLocation(role, posterHome),
    };
  }

  it('flag on: posters go role, location, poster profile', () => {
    expect(walk('poster', true)).toEqual({
      afterRole: '/onboarding/location',
      afterLocation: '/onboarding/poster-profile',
    });
  });

  it('flag on: hunters go role, feed layout, location, payouts', () => {
    expect(walk('hunter', true)).toEqual({
      afterRole: '/onboarding/style?after_role=1',
      afterLocation: '/onboarding/payouts',
    });
  });

  it('flag off: role comes after location, as it does today', () => {
    expect(walk('poster', false)).toEqual({
      afterRole: '/onboarding/poster-profile',
      afterLocation: '/onboarding/role-select',
    });
    expect(walk('hunter', false)).toEqual({
      afterRole: '/onboarding/payouts',
      afterLocation: '/onboarding/role-select',
    });
  });

  it('flag on without a role still asks for one after location', () => {
    expect(stepAfterLocation(null, true)).toBe('/onboarding/role-select');
  });
});
