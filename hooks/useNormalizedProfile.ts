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
    setSbError(null);
    if (!id) {
      setSupabaseProfile(null);
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
      setSbError(err instanceof Error ? err.message : String(err));
      setSupabaseProfile(null);
    } finally {
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
