import { useCallback, useEffect, useMemo, useState } from 'react';
import { CACHE_KEYS } from '../lib/services/cached-data-service';
import { userProfileService, type ProfileCompleteness } from '../lib/services/userProfile';
import { useAuthContext } from './use-auth-context';
import { useCachedData } from './useCachedData';

interface ProfileData {
  username: string;
  displayName?: string;
  bio?: string;
  avatar?: string;
  location?: string;
  phone?: string;
  skills?: string[];
}

interface UseUserProfileResult {
  profile: ProfileData | null;
  loading: boolean;
  isValidating: boolean;
  error: string | null;
  isComplete: boolean;
  completeness: ProfileCompleteness | null;
  saveProfile: (data: ProfileData) => Promise<{ success: boolean; error?: string }>;
  updateProfile: (updates: Partial<ProfileData>) => Promise<{ success: boolean; error?: string }>;
  clearProfile: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useUserProfile(): UseUserProfileResult {
  const { session } = useAuthContext();
  const authUserId = session?.user?.id;

  const cacheKey = useMemo(() =>
    authUserId ? CACHE_KEYS.USER_PROFILE(authUserId) : 'user_profile_guest',
    [authUserId]
  );

  const fetchFn = useCallback(async () => {
    const data = await userProfileService.getProfile(authUserId);
    const complete = await userProfileService.checkCompleteness(authUserId);
    return { profile: data, completeness: complete };
  }, [authUserId]);

  const {
    data: cachedData,
    isLoading: loading,
    isValidating,
    error: fetchError,
    refetch,
    setData: setCachedData
  } = useCachedData<{ profile: ProfileData | null; completeness: ProfileCompleteness | null }>(
    cacheKey,
    fetchFn,
    { enabled: !!authUserId }
  );

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState<ProfileCompleteness | null>(null);

  // Sync state with cached data
  useEffect(() => {
    if (cachedData) {
      setProfile(cachedData.profile);
      setCompleteness(cachedData.completeness);
    }
  }, [cachedData]);

  useEffect(() => {
    if (fetchError) {
      setError(fetchError.message);
    }
  }, [fetchError]);

  const fetchProfile = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const saveProfile = useCallback(async (data: ProfileData) => {
    try {
      setError(null);
      const result = await userProfileService.saveProfile(data, authUserId);

      if (result.success) {
        setProfile(data);
        const complete = await userProfileService.checkCompleteness(authUserId);
        setCompleteness(complete);
      } else {
        setError(result.error || 'Failed to save profile');
      }

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to save profile';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    }
  }, [authUserId]);

  const updateProfile = useCallback(async (updates: Partial<ProfileData>) => {
    try {
      setError(null);
      const result = await userProfileService.updateProfile(updates, authUserId);

      if (result.success) {
        await fetchProfile();
      } else {
        setError(result.error || 'Failed to update profile');
      }

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update profile';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    }
  }, [fetchProfile, authUserId]);

  const clearProfile = useCallback(async () => {
    try {
      await userProfileService.clearProfile(authUserId);
      setProfile(null);
      setCompleteness({ isComplete: false, missingFields: ['username'] });
    } catch (err) {
      console.error('[useUserProfile] Error clearing profile:', err);
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchProfile();
  }, [fetchProfile]);

  // Re-fetch profile when the authenticated user changes
  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return {
    profile,
    loading,
    isValidating,
    error,
    isComplete: completeness?.isComplete ?? false,
    completeness,
    saveProfile,
    updateProfile,
    clearProfile,
    refresh,
  };
}
