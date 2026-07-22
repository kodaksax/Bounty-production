import { useEffect, useState } from 'react';
import type { UserProfile } from '../lib/types';
import { authProfileService } from '../lib/services/auth-profile-service';
import { authProfileToUserProfile } from '../lib/utils/normalize-profile';

interface UseProfileResult {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  refresh: () => Promise<void>;
}

// Note: `updateProfile` only persists the fields that map onto real
// `profiles` columns (username, display_name/name, bio, location, skills,
// avatar). This hook was previously backed by an in-memory mock
// (userProfileService in user-profile-service.ts) that was never seeded from
// Supabase and reset on every relaunch — every read returned null and every
// write silently vanished. It now reads/writes through authProfileService,
// the same Supabase-backed source the rest of the app treats as canonical.
export function useProfile(userId?: string): UseProfileResult {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      setError(null);

      const authId = authProfileService.getAuthUserId();
      const targetId = userId || authId || undefined;
      const isSelf = !targetId || (authId ? targetId === authId : false);

      const data = isSelf
        ? await authProfileService.fetchAndSyncProfile(targetId || authId || '')
        : await authProfileService.getProfileById(targetId);

      setProfile(data ? authProfileToUserProfile(data) : null);
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

      const updated = await authProfileService.updateProfile({
        username: updates.username,
        display_name: updates.name,
        about: updates.bio,
        location: updates.location,
        skills: updates.skills,
        avatar: updates.avatar,
      });
      if (updated) {
        setProfile(authProfileToUserProfile(updated));
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
