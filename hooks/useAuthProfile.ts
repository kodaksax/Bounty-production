/**
 * useAuthProfile Hook
 * React hook for accessing authenticated user profile with real-time updates
 */

import { useEffect, useState } from 'react';
import { authProfileService, AuthProfile } from '../lib/services/auth-profile-service';

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

  const updateProfile = async (updates: Partial<Omit<AuthProfile, 'id' | 'created_at'>>) => {
    return await authProfileService.updateProfile(updates);
  };

  const refreshProfile = async () => {
    setLoading(true);
    await authProfileService.refreshProfile();
    setLoading(false);
  };

  return {
    profile,
    loading,
    userId: authProfileService.getAuthUserId(),
    updateProfile,
    refreshProfile,
  };
}
