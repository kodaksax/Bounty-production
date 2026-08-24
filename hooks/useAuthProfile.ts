/**
 * useAuthProfile Hook
 * React hook for accessing authenticated user profile with real-time updates
 */

import { useCallback, useEffect, useState } from 'react';
import { AuthProfile, authProfileService } from '../lib/services/auth-profile-service';

interface UseAuthProfileResult {
  profile: AuthProfile | null;
  loading: boolean;
  userId: string | null;
  /**
   * Set when the most recent profile fetch failed (network/permission/RPC
   * error) rather than confirming no profile row exists. A truthy `profile`
   * with `needs_onboarding: true` alongside a non-null error here means "we
   * couldn't verify this user's real profile state" — callers deciding
   * whether to route into onboarding or show "not found" must check this
   * first, since a fetch failure is not evidence the user has no profile.
   */
  profileFetchError: string | null;
  updateProfile: (updates: Partial<Omit<AuthProfile, 'id' | 'created_at'>>) => Promise<AuthProfile | null>;
  refreshProfile: () => Promise<void>;
}

/**
 * Hard ceiling on how long `loading` may stay true waiting for the profile
 * fetch to resolve. The service already races its own network calls against
 * timeouts, but if a notification is somehow never delivered, callers must
 * still be released rather than showing a spinner forever.
 */
const PROFILE_RESOLVE_TIMEOUT_MS = 12000;

export function useAuthProfile(): UseAuthProfileResult {
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  // Starts as "not resolved yet" whenever a session exists but its profile
  // fetch has not completed. Reporting `loading: false` with `profile: null`
  // during that window is what let the onboarding gate route a freshly
  // registered user as though they had no account state at all.
  const [loading, setLoading] = useState(() => !authProfileService.isProfileResolved());
  const [profileFetchError, setProfileFetchError] = useState<string | null>(null);

  useEffect(() => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      setLoading(false);
    };

    // Subscribe to profile changes
    const unsubscribe = authProfileService.subscribe((newProfile) => {
      setProfile(newProfile);
      setProfileFetchError(authProfileService.getLastFetchError());
      if (authProfileService.isProfileResolved()) {
        release();
      } else {
        // A cached/interim profile arrived before the fetch settled — surface
        // it, but keep the gate closed so routing waits for the real answer.
        released = false;
        setLoading(true);
      }
    });

    // Initial load
    const initialProfile = authProfileService.getCurrentProfile();
    if (initialProfile) {
      setProfile(initialProfile);
    }
    setProfileFetchError(authProfileService.getLastFetchError());
    if (authProfileService.isProfileResolved()) {
      release();
    }

    const safetyTimer = setTimeout(release, PROFILE_RESOLVE_TIMEOUT_MS);

    return () => {
      clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, []);

  // Stable wrapper for updating the profile
  const updateProfile = useCallback(async (updates: Partial<Omit<AuthProfile, 'id' | 'created_at'>>) => {
    return await authProfileService.updateProfile(updates);
  }, []);

  // Stable wrapper for refreshing the profile
  const refreshProfile = useCallback(async () => {
    setLoading(true);
    try {
      await authProfileService.refreshProfile();
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    profile,
    loading,
    userId: authProfileService.getAuthUserId(),
    profileFetchError,
    updateProfile,
    refreshProfile,
  };
}
