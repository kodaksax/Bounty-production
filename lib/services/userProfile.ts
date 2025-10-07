/**
 * User Profile Service
 * Handles profile CRUD operations with validation
 * Phone number is stored but never displayed in UI
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Profile } from './database.types';

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
   * Get current user profile
   */
  async getProfile(): Promise<ProfileData | null> {
    try {
      const profileJson = await AsyncStorage.getItem(STORAGE_KEY);
      if (!profileJson) return null;
      
      const profile = JSON.parse(profileJson);
      console.log('[userProfile] Loaded profile for:', profile.username || 'unknown', sanitizePhone(profile.phone));
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
  async saveProfile(data: ProfileData): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate username
      const validation = validateUsername(data.username);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Check uniqueness
      const isUnique = await isUsernameUnique(data.username);
      if (!isUnique) {
        return { success: false, error: 'Username is already taken' };
      }

      // Format phone if provided
      if (data.phone) {
        data.phone = formatPhone(data.phone);
      }

      // Save to storage
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      
      // Update profiles index for uniqueness checking
      const profilesJson = await AsyncStorage.getItem(PROFILES_KEY);
      const profiles = profilesJson ? JSON.parse(profilesJson) : {};
      profiles['current-user'] = data;
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
  async updateProfile(updates: Partial<ProfileData>): Promise<{ success: boolean; error?: string }> {
    try {
      const current = await this.getProfile();
      if (!current) {
        return { success: false, error: 'No profile found' };
      }

      const updated = { ...current, ...updates };
      return await this.saveProfile(updated);
    } catch (error) {
      console.error('[userProfile] Error updating profile:', error);
      return { success: false, error: 'Failed to update profile' };
    }
  },

  /**
   * Clear profile (for testing/logout)
   */
  async clearProfile(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
      console.log('[userProfile] Profile cleared');
    } catch (error) {
      console.error('[userProfile] Error clearing profile:', error);
    }
  },

  /**
   * Check if profile is complete
   */
  async checkCompleteness(): Promise<ProfileCompleteness> {
    const profile = await this.getProfile();
    return checkProfileCompleteness(profile);
  },
};
