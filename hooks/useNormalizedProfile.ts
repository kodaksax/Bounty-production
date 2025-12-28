import { authProfileService, type AuthProfile } from 'lib/services/auth-profile-service';
import { mergeNormalized, normalizeAuthProfile, normalizeUserProfile, type NormalizedProfile } from 'lib/utils/normalize-profile';
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
    console.log('[useNormalizedProfile] loadSupabase called with id:', id);
    setSbError(null);
    if (!id) {
      console.log('[useNormalizedProfile] No id provided, setting profile to null');
      setSupabaseProfile(null);
      return;
    }

    // Always attempt to load a Supabase profile for the provided id. In
    // previous implementations we only fetched when the id looked like a
    // UUID (contained '-' and was long). That prevented fetching public
    // profiles for some poster ids. Remove that heuristic so `public_profiles`
    // fallback (implemented in auth-profile-service) can be used.

    console.log('[useNormalizedProfile] Setting sbLoading to true');
    setSbLoading(true);
    try {
      const authId = authProfileService.getAuthUserId();
      const isSelf = authId ? id === authId : false;
      console.log('[useNormalizedProfile] isSelf:', isSelf, 'authId:', authId);
      const profile = isSelf
        ? await authProfileService.fetchAndSyncProfile(id)
        : await authProfileService.getProfileById(id);
      console.log('[useNormalizedProfile] Profile loaded:', profile ? 'found' : 'null');
      setSupabaseProfile(profile || null);
    } catch (err) {
      console.error('[useNormalizedProfile] Error loading profile:', err);
      setSbError(err instanceof Error ? err.message : String(err));
      setSupabaseProfile(null);
    } finally {
      console.log('[useNormalizedProfile] Setting sbLoading to false');
      setSbLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSupabase(userId);
  }, [userId, loadSupabase]);

  const normalizedFromSupabase = normalizeAuthProfile(supabaseProfile || null);
  const normalizedFromAuthHook = isViewingSelf ? normalizeAuthProfile(authHookProfile || null) : null;
  const normalizedFromLocal = normalizeUserProfile(localProfile || null);

  const primary = normalizedFromSupabase || normalizedFromAuthHook;
  const effective = mergeNormalized(primary, normalizedFromLocal);

  const loading = localLoading || (isViewingSelf ? authHookLoading : false) || sbLoading;
  const error = localError || sbError || null;

  console.log('[useNormalizedProfile] State:', {
    localLoading,
    authHookLoading: isViewingSelf ? authHookLoading : false,
    sbLoading,
    loading,
    hasProfile: !!effective,
    userId,
    isViewingSelf,
  });

  const refresh = useCallback(async () => {
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
