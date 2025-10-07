/**
 * useUserProfile Hook
 * Manages user profile state and provides profile operations
 */

import { useCallback, useEffect, useState } from 'react';
import { userProfileService, type ProfileCompleteness } from '../lib/services/userProfile';

interface ProfileData {
  username: string;
  displayName?: string;
  avatar?: string;
  location?: string;
  phone?: string;
}

interface UseUserProfileResult {
  profile: ProfileData | null;
  loading: boolean;
  error: string | null;
  isComplete: boolean;
  completeness: ProfileCompleteness | null;
  saveProfile: (data: ProfileData) => Promise<{ success: boolean; error?: string }>;
  updateProfile: (updates: Partial<ProfileData>) => Promise<{ success: boolean; error?: string }>;
  clearProfile: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useUserProfile(): UseUserProfileResult {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState<ProfileCompleteness | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await userProfileService.getProfile();
      setProfile(data);
      
      const complete = await userProfileService.checkCompleteness();
      setCompleteness(complete);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
      console.error('[useUserProfile] Error fetching profile:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveProfile = useCallback(async (data: ProfileData) => {
    try {
      setError(null);
      const result = await userProfileService.saveProfile(data);
      
      if (result.success) {
        setProfile(data);
        const complete = await userProfileService.checkCompleteness();
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
  }, []);

  const updateProfile = useCallback(async (updates: Partial<ProfileData>) => {
    try {
      setError(null);
      const result = await userProfileService.updateProfile(updates);
      
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
  }, [fetchProfile]);

  const clearProfile = useCallback(async () => {
    try {
      await userProfileService.clearProfile();
      setProfile(null);
      setCompleteness({ isComplete: false, missingFields: ['username'] });
    } catch (err) {
      console.error('[useUserProfile] Error clearing profile:', err);
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return {
    profile,
    loading,
    error,
    isComplete: completeness?.isComplete ?? false,
    completeness,
    saveProfile,
    updateProfile,
    clearProfile,
    refresh,
  };
}
