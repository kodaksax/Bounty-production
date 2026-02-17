import { authProfileService, type AuthProfile } from 'lib/services/auth-profile-service';
import { CURRENT_USER_ID } from 'lib/utils/data-utils';
import { mergeNormalized, normalizeAuthProfile, normalizeUserProfile, type NormalizedProfile } from 'lib/utils/normalize-profile';
import { useCallback, useEffect, useState } from 'react';
import { useAuthProfile } from './useAuthProfile';
import { useProfile } from './useProfile';

export function useNormalizedProfile(userId?: string) {
  const __DEV__flag = typeof __DEV__ !== 'undefined' && __DEV__;
  const { profile: localProfile, loading: localLoading, error: localError, refresh: refreshLocal } = useProfile(userId);
  const { profile: authHookProfile, loading: authHookLoading, refreshProfile } = useAuthProfile();

  const authHookUserId = authHookProfile?.id ?? authProfileService.getAuthUserId();
  const isViewingSelf = !userId || (authHookUserId ? userId === authHookUserId : false);

  const [supabaseProfile, setSupabaseProfile] = useState<AuthProfile | null>(null);
  const [sbLoading, setSbLoading] = useState(false);
  const [sbError, setSbError] = useState<string | null>(null);

  const loadSupabase = useCallback(async (id?: string) => {
    // Fetches a Supabase profile for the given user ID.
    // Returns early and clears loading if the ID is missing/invalid or
    // matches the sentinel CURRENT_USER_ID (indicating the current user),
    // in which case we rely on existing local/auth-based profile data.
    setSbError(null);
    if (!id || id === CURRENT_USER_ID) {
      setSupabaseProfile(null);
      setSbLoading(false); // Ensure loading is cleared when no valid id
      return;
    }

    // Always attempt to load a Supabase profile for the provided id. In
    // previous implementations we only fetched when the id looked like a
    // UUID (contained '-' and was long). That prevented fetching public
    // profiles for some poster ids. Remove that heuristic so `public_profiles`
    // fallback (implemented in auth-profile-service) can be used.

    setSbLoading(true);
    try {
      const authId = authProfileService.getAuthUserId();
      const isSelf = authId ? id === authId : false;
      const profile = isSelf
        ? await authProfileService.fetchAndSyncProfile(id)
        : await authProfileService.getProfileById(id);
      setSupabaseProfile(profile || null);
    } catch (err) {
      console.error('[useNormalizedProfile] Fetch error:', err);
      setSbError(err instanceof Error ? err.message : String(err));
      setSupabaseProfile(null);
    } finally {
      setSbLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSupabase(userId);
    
    // Safety timeout: ensure loading is cleared after max 8 seconds
    // Only clear if still loading to avoid clearing successfully loaded data
    const safetyTimeout = setTimeout(() => {
      setSbLoading((currentLoading) => {
        if (currentLoading) {
          setSupabaseProfile(null);
          return false;
        }
        return currentLoading;
      });
    }, 8000);
    
    return () => clearTimeout(safetyTimeout);
    // loadSupabase has no dependencies and won't change, safe to exclude
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const normalizedFromSupabase = normalizeAuthProfile(supabaseProfile || null);
  const normalizedFromAuthHook = isViewingSelf ? normalizeAuthProfile(authHookProfile || null) : null;
  const normalizedFromLocal = normalizeUserProfile(localProfile || null);

  const primary = normalizedFromSupabase || normalizedFromAuthHook;
  const effective = mergeNormalized(primary, normalizedFromLocal);

  // Derive final normalized profile state (profile, loading, error) by merging Supabase, auth hook, and local profiles.
  // Intentionally no verbose logging here to avoid flooding the console in dev.
  const error = localError || sbError || null;
    // Refreshes profile data from all relevant sources.
    // For self-viewing users, refreshes local profile, auth hook profile, and Supabase profile in parallel,
    // using an effective user id (explicit userId if provided, otherwise the auth hook user id).
    // For other users, refreshes only the local profile and Supabase profile in parallel.
  // Intentionally no verbose logging here to avoid flooding console in dev.

  const refresh = useCallback(async () => {
    // refresh: reload local/auth/supabase sources
    if (isViewingSelf) {
      const effectiveId = userId ?? authHookUserId ?? undefined;
      await Promise.all([refreshLocal(), refreshProfile(), loadSupabase(effectiveId)]);
      return;
    }

    await Promise.all([refreshLocal(), loadSupabase(userId)]);
  }, [isViewingSelf, refreshLocal, refreshProfile, loadSupabase, userId, authHookUserId]);

  // Combine individual loading flags into a single `loading` state for consumers
  const loading = Boolean(localLoading || authHookLoading || sbLoading);

  return {
    profile: effective,
    loading,
    error,
    refresh,
  } as {
    profile: NormalizedProfile | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
  };
}
