/**
 * Regression coverage for the "navigation before profile state settles" race.
 *
 * `authProfileService.subscribe()` notifies a brand-new listener SYNCHRONOUSLY
 * with whatever `currentProfile` happens to be — which is `null` for the whole
 * window between "a session exists" and "the profile query came back".
 * useAuthProfile used to report `loading: false` immediately on mount anyway,
 * so app/onboarding/index.tsx made its routing decision against a null profile
 * and treated a freshly-signed-in user as though they had no account state.
 *
 * The contract now: while a session exists and its profile fetch has not
 * resolved, `loading` stays true.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

type Listener = (profile: any) => void;

const listeners: Listener[] = [];
const state = {
  profile: null as any,
  resolved: true,
  fetchError: null as string | null,
};

jest.mock('lib/services/auth-profile-service', () => ({
  authProfileService: {
    subscribe: (listener: Listener) => {
      listeners.push(listener);
      listener(state.profile);
      return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    getCurrentProfile: () => state.profile,
    getLastFetchError: () => state.fetchError,
    getAuthUserId: () => 'user-abc',
    isProfileResolved: () => state.resolved,
    updateProfile: jest.fn(),
    refreshProfile: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useAuthProfile } = require('../../../hooks/useAuthProfile');

/** Emulate the service pushing a profile to every subscriber. */
function notify(profile: any) {
  state.profile = profile;
  listeners.forEach(l => l(profile));
}

describe('useAuthProfile resolution gate', () => {
  beforeEach(() => {
    listeners.length = 0;
    state.profile = null;
    state.resolved = true;
    state.fetchError = null;
  });

  it('reports loading while a session exists but its profile has not resolved', () => {
    state.resolved = false;

    const { result } = renderHook(() => useAuthProfile());

    expect(result.current.loading).toBe(true);
    expect(result.current.profile).toBeNull();
  });

  it('clears loading once the fetch resolves', async () => {
    state.resolved = false;
    const { result } = renderHook(() => useAuthProfile());
    expect(result.current.loading).toBe(true);

    act(() => {
      state.resolved = true;
      notify({ id: 'user-abc', username: 'newuser', onboarding_completed: false });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile?.username).toBe('newuser');
  });

  it('keeps the gate closed when an interim (cached) profile arrives before the fetch settles', async () => {
    state.resolved = false;
    const { result } = renderHook(() => useAuthProfile());

    // A stale cached profile is surfaced for rendering, but must not be taken
    // as the settled answer that routing decisions are made from.
    act(() => {
      notify({ id: 'user-abc', username: 'cached', onboarding_completed: true });
    });

    await waitFor(() => expect(result.current.profile?.username).toBe('cached'));
    expect(result.current.loading).toBe(true);

    act(() => {
      state.resolved = true;
      notify({ id: 'user-abc', username: 'fresh', onboarding_completed: false });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile?.username).toBe('fresh');
  });

  it('is not loading when there is nothing to resolve (already settled)', () => {
    state.resolved = true;
    state.profile = { id: 'user-abc', username: 'veteran', onboarding_completed: true };

    const { result } = renderHook(() => useAuthProfile());

    expect(result.current.loading).toBe(false);
    expect(result.current.profile?.username).toBe('veteran');
  });

  it('releases the gate after the safety timeout even if nothing ever resolves', async () => {
    jest.useFakeTimers();
    try {
      state.resolved = false;
      const { result } = renderHook(() => useAuthProfile());
      expect(result.current.loading).toBe(true);

      act(() => {
        jest.advanceTimersByTime(12_001);
      });

      expect(result.current.loading).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
