/**
 * User Profile Service
 * Handles profile CRUD operations with validation
 * Phone number is stored but never displayed in UI
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { authProfileService } from './auth-profile-service';
import { supabase } from '../supabase';

const STORAGE_KEY = 'BE:userProfile';
const PROFILES_KEY = 'BE:allProfiles'; // For username uniqueness check

interface ProfileData {
  username: string;
  displayName?: string;
  avatar?: string;
  location?: string;
  phone?: string; // Private - never displayed
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
 * Check if username is unique (client-side check)
 * In production, this should be a server-side check
 */
export async function isUsernameUnique(username: string, currentUserId?: string): Promise<boolean> {
  try {
    const profilesJson = await AsyncStorage.getItem(PROFILES_KEY);
    const profiles: { [key: string]: ProfileData } = profilesJson ? JSON.parse(profilesJson) : {};
    
    // Check if username exists for a different user
    for (const [userId, profile] of Object.entries(profiles)) {
      if (profile.username === username && userId !== currentUserId) {
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error('[userProfile] Error checking username uniqueness:', error);
    return true; // Optimistic - allow if check fails
  }
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
 */
export function checkProfileCompleteness(profile: ProfileData | null): ProfileCompleteness {
  if (!profile) {
    return {
      isComplete: false,
      missingFields: ['username', 'displayName', 'location', 'phone'],
    };
  }

  const missingFields: string[] = [];
  
  if (!profile.username) {
    missingFields.push('username');
  }

  // Username is the only required field for basic completion
  // Other fields are optional but we track them
  
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
      console.log('[userProfile] Resolving profile. resolvedUserId=', resolvedUserId, 'storageKey=', key);
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
            console.log('[userProfile] Migrated legacy profile to per-user storage for user:', resolvedUserId, 'storageKey=', key);
            console.log('[userProfile] Loaded profile for:', legacyProfile.username || 'unknown', sanitizePhone(legacyProfile.phone), 'for userId=', resolvedUserId);
            return legacyProfile;
          } catch (e) {
            console.warn('[userProfile] Failed to migrate legacy profile:', e);
            return null;
          }
        }

        // Do NOT return the legacy global profile when there's no resolved
        // authenticated user. Returning a legacy profile here causes the app
        // to show another user's profile while auth is still initializing.
        if (!resolvedUserId) {
          console.warn('[userProfile] No authenticated user resolved yet; not returning legacy profile. storageKey=', key);
          return null;
        }

        const idToLog = resolvedUserId;
        console.warn('[userProfile] No profile found for user:', idToLog, 'storageKey=', key);
        return null;
      }

      const profile = JSON.parse(profileJson);
      console.log('[userProfile] Loaded profile for:', profile.username || 'unknown', sanitizePhone(profile.phone), 'for userId=', resolvedUserId, 'storageKey=', this.storageKey(resolvedUserId));
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

      console.log('[userProfile] Profile saved:', data.username, sanitizePhone(data.phone));
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
      console.log('[userProfile] Profile cleared');
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
