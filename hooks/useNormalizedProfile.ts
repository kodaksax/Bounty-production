import { authProfileService, type AuthProfile } from 'lib/services/auth-profile-service';
import { mergeNormalized, normalizeAuthProfile, normalizeUserProfile, type NormalizedProfile } from 'lib/utils/normalize-profile';
import { CURRENT_USER_ID } from 'lib/utils/data-utils';
import { useCallback, useEffect, useState } from 'react';
import { useAuthProfile } from './useAuthProfile';
import { useProfile } from './useProfile';

export function useNormalizedProfile(userId?: string) {
  const { profile: localProfile, loading: localLoading, error: localError, refresh: refreshLocal } = useProfile(userId);
  const { profile: authHookProfile, loading: authHookLoading, refreshProfile } = useAuthProfile();

  const authHookUserId = authHookProfile?.id ?? authProfileService.getAuthUserId();
  const isViewingSelf = !userId || (authHookUserId ? userId === authHookUserId : false);

  const [supabaseProfile, setSupabaseProfile] = useState<AuthProfile | null>(null);
  const [sbLoading, setSbLoading] = useState(false);
  const [sbError, setSbError] = useState<string | null>(null);

  const loadSupabase = useCallback(async (id?: string) => {
    console.log('[useNormalizedProfile] loadSupabase called', { id, hasId: !!id });
    setSbError(null);
    if (!id || id === CURRENT_USER_ID) {
      console.log('[useNormalizedProfile] No valid id provided (or sentinel user), setting profile to null and clearing loading');
      setSupabaseProfile(null);
      setSbLoading(false); // Ensure loading is cleared when no valid id
      return;
    }

    // Always attempt to load a Supabase profile for the provided id. In
    // previous implementations we only fetched when the id looked like a
    // UUID (contained '-' and was long). That prevented fetching public
    // profiles for some poster ids. Remove that heuristic so `public_profiles`
    // fallback (implemented in auth-profile-service) can be used.

    console.log('[useNormalizedProfile] Starting Supabase fetch...');
    setSbLoading(true);
    try {
      const authId = authProfileService.getAuthUserId();
      const isSelf = authId ? id === authId : false;
      console.log('[useNormalizedProfile] Fetch params', { id, authId, isSelf });
      const profile = isSelf
        ? await authProfileService.fetchAndSyncProfile(id)
        : await authProfileService.getProfileById(id);
      console.log('[useNormalizedProfile] Fetch completed', { hasProfile: !!profile, username: profile?.username });
      setSupabaseProfile(profile || null);
    } catch (err) {
      console.error('[useNormalizedProfile] Fetch error:', err);
      setSbError(err instanceof Error ? err.message : String(err));
      setSupabaseProfile(null);
    } finally {
      console.log('[useNormalizedProfile] Setting sbLoading to false');
      setSbLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log('[useNormalizedProfile] useEffect triggered', { userId });
    loadSupabase(userId);
  }, [userId, loadSupabase]);

  const normalizedFromSupabase = normalizeAuthProfile(supabaseProfile || null);
  const normalizedFromAuthHook = isViewingSelf ? normalizeAuthProfile(authHookProfile || null) : null;
  const normalizedFromLocal = normalizeUserProfile(localProfile || null);

  const primary = normalizedFromSupabase || normalizedFromAuthHook;
  const effective = mergeNormalized(primary, normalizedFromLocal);

  const loading = localLoading || (isViewingSelf ? authHookLoading : false) || sbLoading;
  const error = localError || sbError || null;

  console.log('[useNormalizedProfile] Current state', {
    userId,
    isViewingSelf,
    localLoading,
    authHookLoading: isViewingSelf ? authHookLoading : false,
    sbLoading,
    loading,
    hasEffectiveProfile: !!effective,
    effectiveUsername: effective?.username,
  });

  const refresh = useCallback(async () => {
    console.log('[useNormalizedProfile] refresh called');
    if (isViewingSelf) {
      const effectiveId = userId ?? authHookUserId ?? undefined;
      await Promise.all([refreshLocal(), refreshProfile(), loadSupabase(effectiveId)]);
      return;
    }

    await Promise.all([refreshLocal(), loadSupabase(userId)]);
  }, [isViewingSelf, refreshLocal, refreshProfile, loadSupabase, userId, authHookUserId]);

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
