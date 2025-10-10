import { authProfileService, type AuthProfile } from 'lib/services/auth-profile-service';
import { mergeNormalized, normalizeAuthProfile, normalizeUserProfile, type NormalizedProfile } from 'lib/utils/normalize-profile';
import { useCallback, useEffect, useState } from 'react';
import { useAuthProfile } from './useAuthProfile';
import { useProfile } from './useProfile';

export function useNormalizedProfile(userId?: string) {
  const { profile: localProfile, loading: localLoading, error: localError, refresh: refreshLocal } = useProfile(userId);
  const { profile: authHookProfile, loading: authHookLoading, refreshProfile } = useAuthProfile();

  const [supabaseProfile, setSupabaseProfile] = useState<AuthProfile | null>(null);
  const [sbLoading, setSbLoading] = useState(false);
  const [sbError, setSbError] = useState<string | null>(null);

  const loadSupabase = useCallback(async (id?: string) => {
    setSupabaseProfile(null);
    setSbError(null);
    if (!id) return;
    const looksLikeUUID = typeof id === 'string' && id.includes('-') && id.length > 16;
    if (!looksLikeUUID) return;
    setSbLoading(true);
    try {
      const p = await authProfileService.fetchAndSyncProfile(id);
      setSupabaseProfile(p || null);
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
  const normalizedFromAuthHook = normalizeAuthProfile(authHookProfile || null);
  const normalizedFromLocal = normalizeUserProfile(localProfile || null);

  const effective = mergeNormalized(normalizedFromSupabase || normalizedFromAuthHook, normalizedFromLocal);

  const loading = localLoading || authHookLoading || sbLoading;
  const error = localError || sbError || null;

  const refresh = useCallback(async () => {
    await Promise.all([refreshLocal(), refreshProfile(), loadSupabase(userId)]);
  }, [refreshLocal, refreshProfile, loadSupabase, userId]);

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
