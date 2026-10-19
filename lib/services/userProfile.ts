/**
 * User Profile Service
 * Handles profile CRUD operations with validation
 * Phone number is stored but never displayed in UI
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { authProfileService } from './auth-profile-service';

const STORAGE_KEY = 'BE:userProfile';
const PROFILES_KEY = 'BE:allProfiles'; // For username uniqueness check

interface ProfileData {
  username: string;
  displayName?: string;
  title?: string;
  bio?: string;
  avatar?: string;
  location?: string;
  phone?: string; // Private - never displayed
  skills?: string[];
  verificationStatus?: 'unverified' | 'pending' | 'verified' | 'rejected';
  verifiedSince?: string;
}

export interface ProfileCompleteness {
  isComplete: boolean;
  missingFields: string[];
}

/**
 * Validate username format
 * Rules: lowercase a-z, numbers, underscore; 3-20 chars
 */
export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username || username.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  if (username.length > 20) {
    return { valid: false, error: 'Username must be 20 characters or less' };
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    return { valid: false, error: 'Username must contain only lowercase letters, numbers, and underscores' };
  }
  return { valid: true };
}

/**
 * What the server said about a username.
 * - 'available' / 'taken': an answer from is_username_available.
 * - 'unknown': no answer (network, rate limit, backend without the RPC, or
 *   input the server calls malformed). Never shown as "available".
 */
export type UsernameAvailability = 'available' | 'taken' | 'unknown';

/**
 * Ask the server whether a username is free for the caller.
 *
 * `is_username_available` is a SECURITY DEFINER RPC, callable signed out,
 * that compares case-insensitively against every profile, ignores the
 * caller's own row and is rate-limited per caller (SBA-08). A plain
 * `profiles` SELECT can't answer this: profiles are readable own-row only, so
 * it never saw anyone else's name and said "available" for every username
 * until /auth/register answered 409. That is why there is no client-side
 * fallback: anything other than a boolean from the RPC is 'unknown'.
 */
export async function checkUsernameAvailability(username: string): Promise<UsernameAvailability> {
  const trimmed = (username || '').trim();
  if (!trimmed) return 'unknown';
  try {
    const { data, error } = await supabase.rpc('is_username_available', { p_username: trimmed });
    if (!error && typeof data === 'boolean') return data ? 'available' : 'taken';
    if (error) {
      console.warn('[userProfile] is_username_available failed:', {
        code: (error as { code?: string }).code,
        message: error.message,
      });
    }
  } catch (err) {
    console.warn('[userProfile] is_username_available threw:', err);
  }
  return 'unknown';
}

/**
 * Boolean form for save paths: false only when the server says the name is
 * taken. With no answer it returns true and lets the DB UNIQUE constraint
 * decide at write time, so a failed check never blocks a save on its own.
 * `currentUserId` is kept for callers; the RPC already ignores the caller's
 * own row.
 */
export async function isUsernameUnique(username: string, _currentUserId?: string): Promise<boolean> {
  if (!(username || '').trim()) return false;
  return (await checkUsernameAvailability(username)) !== 'taken';
}

/**
 * Format phone to E.164 if possible (basic validation)
 */
export function formatPhone(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // If starts with country code, keep it; otherwise assume US
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length > 10 && digits[0] !== '1') {
    return `+${digits}`;
  }
  if (digits[0] === '1') {
    return `+${digits}`;
  }
  return `+${digits}`;
}

/**
 * Sanitize phone for logging (never log actual phone numbers)
 */
export function sanitizePhone(phone?: string): string {
  if (!phone) return '';
  return phone.slice(0, 3) + '***' + phone.slice(-2);
}

/**
 * Check if profile is complete
 * Requires username, displayName, avatar, and bio to be non-empty.
 */
export function checkProfileCompleteness(profile: ProfileData | null): ProfileCompleteness {
  const missingFields: string[] = [];

  if (!profile?.username) {
    missingFields.push('username');
  }

  if (!profile?.displayName?.trim()) {
    missingFields.push('displayName');
  }

  if (!profile?.avatar?.trim()) {
    missingFields.push('avatar');
  }

  if (!profile?.bio?.trim()) {
    missingFields.push('bio');
  }

  return {
    isComplete: missingFields.length === 0,
    missingFields,
  };
}

export const userProfileService = {
  /**
   * Helper to compute a storage key per user. If userId is not provided,
   * prefer the authenticated user id from authProfileService, falling back
   * to a generic 'current-user' key for tests or unauthenticated flows.
   */
  storageKey(userId?: string) {
    const resolved = userId || authProfileService.getAuthUserId() || 'current-user';
    return `${STORAGE_KEY}:${resolved}`;
  },

  /**
   * Get profile for a specific user. If no userId is provided, this will
   * return the profile for the currently authenticated user (if available),
   * otherwise the legacy 'current-user' profile.
   */
  async getProfile(userId?: string): Promise<ProfileData | null> {
    try {
      // Prefer canonical Supabase session user id (most up-to-date), then
      // explicit param, then authProfileService fallback.
      let resolvedUserId: string | undefined;
      try {
        const { data } = await supabase.auth.getSession();
        resolvedUserId = data?.session?.user?.id ?? undefined;
      } catch (e) {
        resolvedUserId = undefined;
      }

      // If explicit userId provided, prefer it over session (useful for admin lookups)
      if (userId) resolvedUserId = userId;

      // Final fallback to authProfileService
      if (!resolvedUserId) resolvedUserId = authProfileService.getAuthUserId() ?? undefined;

      const key = this.storageKey(resolvedUserId);
      const profileJson = await AsyncStorage.getItem(key);
      if (!profileJson) {
        // No per-user profile found.
        // If we have a resolved user id, try legacy single-key storage and migrate it for this user.
        const legacy = await AsyncStorage.getItem(STORAGE_KEY);
        if (legacy && resolvedUserId) {
          try {
            const legacyProfile = JSON.parse(legacy);
            // Persist a copy under the new per-user key so future loads
            // return the correct user-specific profile.
            await AsyncStorage.setItem(key, legacy);
            return legacyProfile;
          } catch (e) {
            console.error('[userProfile] Failed to migrate legacy profile:', e);
            return null;
          }
        }

        // Do NOT return the legacy global profile when there's no resolved
        // authenticated user. Returning a legacy profile here causes the app
        // to show another user's profile while auth is still initializing.
        if (!resolvedUserId) {
          console.error('[userProfile] No authenticated user resolved yet; not returning legacy profile. storageKey=', key);
          return null;
        }

        // If we reached here, there's a resolved userId but no local profile.
        // Try fetching the canonical profile from Supabase (backend) so that
        // other users' usernames / avatars display correctly instead of
        // falling back to 'Unknown Poster'. Cache the result locally for
        // subsequent loads.
        try {

          // Reads 'public_profiles', the curated safe-columns view. The base
          // 'profiles' table is NOT usable here: its SELECT RLS is self-only
          // ('auth.uid() = id'), so it returns no row for any user other than
          // the caller — which is exactly why this path used to fall through to
          // 'Unknown Poster'. See docs/withdrawals/08-profiles-rls-migration-strategy.md.
          let remoteData: any | null = null;
          let remoteError: any = null;

          try {
            // Select columns known to exist in all environments (omit 'about' — not
            // present in staging schema). The 'about' / bio field is sourced from
            // auth-profile-service and is the authoritative profile provider; this
            // path is only a lightweight fallback for display names.
            const res = await supabase
              .from('public_profiles')
              .select('id,username,display_name,avatar,location,stripe_identity_status,verified_since')
              .eq('id', resolvedUserId)
              .single();
            remoteData = res.data ?? null;
            remoteError = res.error ?? null;
          } catch (e) {
            remoteData = null;
            remoteError = e;
          }

          if (!remoteData) {
            console.error('[userProfile] No remote profile found (public_profiles) for user:', resolvedUserId, 'priorError=', remoteError);
            return null;
          }

          // Normalize field names to our ProfileData shape. verificationStatus
          // is derived from Stripe Identity status here (this fallback path
          // has no access to the legacy id_verification_status column, which
          // isn't exposed on public_profiles -- see 20260725000000_add_stripe_identity_columns.sql).
          const verificationStatus: ProfileData['verificationStatus'] =
            remoteData.stripe_identity_status === 'verified'
              ? 'verified'
              : remoteData.stripe_identity_status === 'processing'
                ? 'pending'
                : remoteData.stripe_identity_status === 'requires_input'
                  ? 'rejected'
                  : 'unverified';

          const normalized = {
            username: remoteData.username || '',
            displayName: remoteData.display_name || remoteData.displayName || undefined,
            avatar: remoteData.avatar || undefined,
            location: remoteData.location || undefined,
            bio: remoteData.about || remoteData.bio || undefined,
            verificationStatus,
            verifiedSince: remoteData.verified_since || undefined,
          } as ProfileData;

          // Cache locally under the per-user key so future reads are fast
          try {
            await AsyncStorage.setItem(key, JSON.stringify(normalized));
          } catch (e) {
            console.error('[userProfile] Failed to cache remote profile locally:', e);
          }

          return normalized;
        } catch (e) {
          console.error('[userProfile] Error fetching remote profile:', e);
          return null;
        }
      }

      const profile = JSON.parse(profileJson);
      return profile;
    } catch (error) {
      console.error('[userProfile] Error loading profile:', error);
      return null;
    }
  },

  /**
   * Save profile data
   * Phone is stored but never rendered in UI
   */
  async saveProfile(data: ProfileData, userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate username
      const validation = validateUsername(data.username);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Check uniqueness
      // Pass a stable current user id so the same user can keep their username
      const currentUserId = userId || authProfileService.getAuthUserId() || 'current-user';
      const isUnique = await isUsernameUnique(data.username, currentUserId);
      if (!isUnique) {
        return { success: false, error: 'Username is already taken' };
      }

      // Format phone if provided
      if (data.phone) {
        data.phone = formatPhone(data.phone);
      }

      // Save to storage
      const key = this.storageKey(userId);
      await AsyncStorage.setItem(key, JSON.stringify(data));

      // Update profiles index for uniqueness checking. Use the resolved user id
      // as the map key so uniqueness checks are accurate across multiple users.
      const profilesJson = await AsyncStorage.getItem(PROFILES_KEY);
      const profiles = profilesJson ? JSON.parse(profilesJson) : {};
      profiles[currentUserId] = data;
      await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));

      return { success: true };
    } catch (error) {
      console.error('[userProfile] Error saving profile:', error);
      return { success: false, error: 'Failed to save profile' };
    }
  },

  /**
   * Update profile fields
   */
  async updateProfile(updates: Partial<ProfileData>, userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const current = await this.getProfile(userId);
      if (!current) {
        // No existing profile: treat this as a create (upsert)
        if (!updates.username) {
          return { success: false, error: 'Username is required to create profile' };
        }
        return await this.saveProfile(updates as ProfileData, userId);
      }

      const updated = { ...current, ...updates };
      return await this.saveProfile(updated, userId);
    } catch (error) {
      console.error('[userProfile] Error updating profile:', error);
      return { success: false, error: 'Failed to update profile' };
    }
  },

  /**
   * Clear profile (for testing/logout)
   */
  async clearProfile(userId?: string): Promise<void> {
    try {
      const key = this.storageKey(userId);
      await AsyncStorage.removeItem(key);
      // Also remove from the uniqueness index
      const profilesJson = await AsyncStorage.getItem(PROFILES_KEY);
      if (profilesJson) {
        const profiles = JSON.parse(profilesJson);
        const resolved = userId || authProfileService.getAuthUserId() || 'current-user';
        if (profiles && typeof profiles === 'object') {
          delete profiles[resolved];
          // If no profiles remain, remove the index key entirely
          if (Object.keys(profiles).length === 0) {
            await AsyncStorage.removeItem(PROFILES_KEY);
          } else {
            await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
          }
        }
      }
    } catch (error) {
      console.error('[userProfile] Error clearing profile:', error);
    }
  },

  /**
   * Check if profile is complete
   */
  async checkCompleteness(userId?: string): Promise<ProfileCompleteness> {
    const profile = await this.getProfile(userId);
    return checkProfileCompleteness(profile);
  },
};
