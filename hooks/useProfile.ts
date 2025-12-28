import { useEffect, useState } from 'react';
import type { UserProfile } from '../lib/types';
import { userProfileService } from '../lib/services/user-profile-service';

interface UseProfileResult {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useProfile(userId?: string): UseProfileResult {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = userId 
        ? await userProfileService.getProfile(userId)
        : await userProfileService.getCurrentProfile();
      
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!profile) return;

    try {
      setError(null);
      
      // Optimistic update
      setProfile({ ...profile, ...updates });
      
      const updated = await userProfileService.updateProfile(profile.id, updates);
      if (updated) {
        setProfile(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
      // Revert on error
      await fetchProfile();
    }
  };

  const refresh = async () => {
    await fetchProfile();
  };

  useEffect(() => {
    fetchProfile();
  }, [userId]);

  return {
    profile,
    loading,
    error,
    updateProfile,
    refresh,
  };
}
