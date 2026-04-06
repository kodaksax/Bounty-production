/**
 * Unit tests for useAppBootstrap
 *
 * Verifies the 3-state bootstrap gate:
 *   "loading"        → waiting for auth or async onboarding check
 *   "unauthenticated" → no session
 *   "authenticated"  → session + onboardingComplete known
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetItem = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args: any[]) => mockGetItem(...args),
}));

const mockGetProfileById = jest.fn();
jest.mock('../../../lib/services/auth-profile-service', () => ({
  authProfileService: {
    getProfileById: (...args: any[]) => mockGetProfileById(...args),
  },
}));

const mockGetOnboardingCompleteKey = jest.fn((id: string) => `@bounty_onboarding_completed:${id}`);
jest.mock('../../../lib/storage/onboarding', () => ({
  getOnboardingCompleteKey: (id: string) => mockGetOnboardingCompleteKey(id),
}));

// Controlled auth context state — tests mutate this directly.
let mockAuthState = {
  session: null as null | { user: { id: string } },
  isLoading: true,
  profile: undefined as any,
};

jest.mock('../../../hooks/use-auth-context', () => ({
  useAuthContext: () => mockAuthState,
}));

// ── Helper ────────────────────────────────────────────────────────────────────

function getHook() {
  // Inline require after mocks are in place so module resolution picks them up.
  const { useAppBootstrap } = require('../../../hooks/useAppBootstrap');
  return renderHook(() => useAppBootstrap());
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useAppBootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to a neutral "still loading" state before each test.
    mockAuthState = { session: null, isLoading: true, profile: undefined };
  });

  // ── Loading phase ─────────────────────────────────────────────────────────

  it('starts in loading state', () => {
    const { result } = getHook();
    expect(result.current.status).toBe('loading');
  });

  it('remains loading while isLoading is true', async () => {
    const { result } = getHook();
    // Give effects a chance to run.
    await act(async () => {});
    expect(result.current.status).toBe('loading');
  });

  // ── Unauthenticated ───────────────────────────────────────────────────────

  it('transitions to unauthenticated when isLoading becomes false with no session', async () => {
    const { result, rerender } = getHook();

    act(() => {
      mockAuthState = { session: null, isLoading: false, profile: null };
    });
    rerender({});

    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));
  });

  // ── Authenticated – fast path (profile complete) ──────────────────────────

  it('resolves authenticated+onboardingComplete=true via fast path when profile.onboarding_completed is true', async () => {
    mockAuthState = {
      session: { user: { id: 'user-1' } },
      isLoading: false,
      profile: { onboarding_completed: true, needs_onboarding: false },
    };

    const { result } = getHook();

    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    expect(result.current).toEqual({ status: 'authenticated', onboardingComplete: true });
    // Fast path should NOT touch AsyncStorage.
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  // ── Authenticated – slow path (AsyncStorage flag present) ─────────────────

  it('resolves onboardingComplete=true when AsyncStorage flag is set and profile row exists', async () => {
    mockGetItem.mockResolvedValue('true');
    mockGetProfileById.mockResolvedValue({ id: 'user-2', username: 'alice' });

    mockAuthState = {
      session: { user: { id: 'user-2' } },
      isLoading: false,
      profile: null, // profile not loaded from DB yet
    };

    const { result } = getHook();

    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    expect(result.current).toEqual({ status: 'authenticated', onboardingComplete: true });
    expect(mockGetItem).toHaveBeenCalledWith('@bounty_onboarding_completed:user-2');
  });

  it('resolves onboardingComplete=false when AsyncStorage flag is set but profile row is missing', async () => {
    mockGetItem.mockResolvedValue('true');
    mockGetProfileById.mockResolvedValue(null); // profile row missing

    mockAuthState = {
      session: { user: { id: 'user-3' } },
      isLoading: false,
      profile: null,
    };

    const { result } = getHook();

    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    expect(result.current).toEqual({ status: 'authenticated', onboardingComplete: false });
  });

  // ── Authenticated – slow path (AsyncStorage flag absent) ─────────────────

  it('resolves onboardingComplete=false when AsyncStorage flag is not set', async () => {
    mockGetItem.mockResolvedValue(null);

    mockAuthState = {
      session: { user: { id: 'user-4' } },
      isLoading: false,
      profile: { onboarding_completed: false },
    };

    const { result } = getHook();

    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    expect(result.current).toEqual({ status: 'authenticated', onboardingComplete: false });
    // Should have checked AsyncStorage but not profile (flag absent).
    expect(mockGetItem).toHaveBeenCalled();
    expect(mockGetProfileById).not.toHaveBeenCalled();
  });

  // ── Error resilience ─────────────────────────────────────────────────────

  it('defaults onboardingComplete=false when AsyncStorage throws', async () => {
    mockGetItem.mockRejectedValue(new Error('storage error'));

    mockAuthState = {
      session: { user: { id: 'user-5' } },
      isLoading: false,
      profile: null,
    };

    const { result } = getHook();

    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    expect(result.current).toEqual({ status: 'authenticated', onboardingComplete: false });
  });

  it('defaults onboardingComplete=false when profile existence check throws', async () => {
    mockGetItem.mockResolvedValue('true');
    mockGetProfileById.mockRejectedValue(new Error('network error'));

    mockAuthState = {
      session: { user: { id: 'user-6' } },
      isLoading: false,
      profile: null,
    };

    const { result } = getHook();

    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    expect(result.current).toEqual({ status: 'authenticated', onboardingComplete: false });
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it('does not re-run the async check when profile updates after resolution', async () => {
    mockGetItem.mockResolvedValue('true');
    mockGetProfileById.mockResolvedValue({ id: 'user-7' });

    mockAuthState = {
      session: { user: { id: 'user-7' } },
      isLoading: false,
      profile: null,
    };

    const { result, rerender } = getHook();

    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    const callsBefore = mockGetItem.mock.calls.length;

    // Simulate a profile update arriving after resolution.
    act(() => {
      mockAuthState = {
        ...mockAuthState,
        profile: { onboarding_completed: true },
      };
    });

    rerender({});
    await act(async () => {});

    // No additional AsyncStorage calls should have been made.
    expect(mockGetItem.mock.calls.length).toBe(callsBefore);
  });

  // ── Session change ────────────────────────────────────────────────────────

  it('resets to loading and re-resolves when the session changes', async () => {
    mockGetItem.mockResolvedValue(null);

    mockAuthState = {
      session: { user: { id: 'user-8' } },
      isLoading: false,
      profile: { onboarding_completed: false },
    };

    const { result, rerender } = getHook();

    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current).toEqual({ status: 'authenticated', onboardingComplete: false });

    // Simulate sign-out.
    act(() => {
      mockAuthState = { session: null, isLoading: false, profile: null };
    });

    rerender({});

    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));
  });
});
