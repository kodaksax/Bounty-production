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
  updateProfile: (updates: Partial<Omit<AuthProfile, 'id' | 'created_at'>>) => Promise<AuthProfile | null>;
  refreshProfile: () => Promise<void>;
}

export function useAuthProfile(): UseAuthProfileResult {
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Subscribe to profile changes
    const unsubscribe = authProfileService.subscribe((newProfile) => {
      setProfile(newProfile);
      setLoading(false);
    });

    // Initial load
    const initialProfile = authProfileService.getCurrentProfile();
    if (initialProfile) {
      setProfile(initialProfile);
    }
    setLoading(false);

    return unsubscribe;
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
    updateProfile,
    refreshProfile,
  };
}
