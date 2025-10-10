/**
 * Auth Profile Service
 * Central service for managing authenticated user profile data
 * Ensures tight coupling between Supabase auth and profile data
 */

import { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../supabase';
import { logger } from '../utils/error-logger';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PROFILE_CACHE_KEY = 'BE:authProfile';
const PROFILE_CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

export interface AuthProfile {
  id: string; // User ID from Supabase auth
  username: string;
  email?: string;
  avatar?: string;
  about?: string;
  phone?: string;
  balance: number;
  created_at?: string;
  updated_at?: string;
}

interface CachedProfile {
  profile: AuthProfile;
  timestamp: number;
}

export class AuthProfileService {
  private static instance: AuthProfileService;
  private currentSession: Session | null = null;
  private currentProfile: AuthProfile | null = null;
  private listeners: Array<(profile: AuthProfile | null) => void> = [];

  private constructor() {}

  static getInstance(): AuthProfileService {
    if (!AuthProfileService.instance) {
      AuthProfileService.instance = new AuthProfileService();
    }
    return AuthProfileService.instance;
  }

  /**
   * Set the current session and fetch/sync profile
   */
  async setSession(session: Session | null): Promise<void> {
    this.currentSession = session;
    
    if (!session) {
      this.currentProfile = null;
      await this.clearCache();
      this.notifyListeners(null);
      return;
    }

    // Fetch and sync profile for authenticated user
    await this.fetchAndSyncProfile(session.user.id);
  }

  /**
   * Get the authenticated user ID
   */
  getAuthUserId(): string | null {
    return this.currentSession?.user?.id || null;
  }

  /**
   * Get the current authenticated user's profile
   */
  getCurrentProfile(): AuthProfile | null {
    return this.currentProfile;
  }

  /**
   * Fetch profile from Supabase and sync with local cache
   */
  async fetchAndSyncProfile(userId: string): Promise<AuthProfile | null> {
    if (!isSupabaseConfigured) {
      logger.error('Supabase not configured', { userId });
      return null;
    }

    try {
      // Try to get profile from Supabase
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        // If profile doesn't exist, create a minimal one
        if (error.code === 'PGRST116') {
          logger.warning('Profile not found, creating minimal profile', { userId });
          return await this.createMinimalProfile(userId);
        }
        throw error;
      }

      if (data) {
        const profile: AuthProfile = {
          id: data.id,
          username: data.username,
          email: data.email,
          avatar: data.avatar,
          about: data.about,
          phone: data.phone,
          balance: data.balance || 0,
          created_at: data.created_at,
          updated_at: data.updated_at,
        };

        this.currentProfile = profile;
        await this.cacheProfile(profile);
        this.notifyListeners(profile);
        return profile;
      }

      return null;
    } catch (error) {
      logger.error('Error fetching profile', { userId, error });
      
      // Try to load from cache
      const cached = await this.loadFromCache();
      if (cached && cached.id === userId) {
        this.currentProfile = cached;
        this.notifyListeners(cached);
        return cached;
      }
      
      return null;
    }
  }

  /**
   * Create a minimal profile for a new user
   * This is called when a Supabase auth user exists but has no profile record
   * Note: Minimal profiles are temporary - users should complete onboarding
   */
  private async createMinimalProfile(userId: string): Promise<AuthProfile | null> {
    if (!isSupabaseConfigured) {
      return null;
    }

    try {
      // Generate a temporary username from email or user ID
      // This will be replaced during onboarding
      const username = this.currentSession?.user?.email?.split('@')[0] || `user_${userId.slice(0, 8)}`;
      const email = this.currentSession?.user?.email;

      // Check if profile already exists (race condition protection)
      const { data: existing } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (existing) {
        // Profile was created by another process, use it
        const profile: AuthProfile = {
          id: existing.id,
          username: existing.username,
          email: existing.email,
          avatar: existing.avatar,
          about: existing.about,
          phone: existing.phone,
          balance: existing.balance || 0,
          created_at: existing.created_at,
          updated_at: existing.updated_at,
        };

        this.currentProfile = profile;
        await this.cacheProfile(profile);
        this.notifyListeners(profile);
        return profile;
      }

      // Create new minimal profile
      const { data, error } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          username: username,
          email: email,
          balance: 0,
        })
        .select()
        .single();

      if (error) {
        // If error is due to duplicate key, profile was created concurrently
        if (error.code === '23505') {
          logger.warning('Profile already exists (concurrent creation)', { userId });
          // Fetch the existing profile
          const { data: existingProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

          if (existingProfile) {
            const profile: AuthProfile = {
              id: existingProfile.id,
              username: existingProfile.username,
              email: existingProfile.email,
              avatar: existingProfile.avatar,
              about: existingProfile.about,
              phone: existingProfile.phone,
              balance: existingProfile.balance || 0,
              created_at: existingProfile.created_at,
              updated_at: existingProfile.updated_at,
            };

            this.currentProfile = profile;
            await this.cacheProfile(profile);
            this.notifyListeners(profile);
            return profile;
          }
        }

        logger.error('Error creating minimal profile', { userId, error });
        return null;
      }

      if (data) {
        const profile: AuthProfile = {
          id: data.id,
          username: data.username,
          email: data.email,
          avatar: data.avatar,
          about: data.about,
          phone: data.phone,
          balance: data.balance || 0,
          created_at: data.created_at,
          updated_at: data.updated_at,
        };

        this.currentProfile = profile;
        await this.cacheProfile(profile);
        this.notifyListeners(profile);
        logger.info('Created minimal profile for new user', { userId, username });
        return profile;
      }

      return null;
    } catch (error) {
      logger.error('Error creating minimal profile', { userId, error });
      return null;
    }
  }

  /**
   * Update the authenticated user's profile
   */
  async updateProfile(updates: Partial<Omit<AuthProfile, 'id' | 'created_at'>>): Promise<AuthProfile | null> {
    const userId = this.getAuthUserId();
    if (!userId) {
      logger.error('Cannot update profile: no authenticated user');
      return null;
    }

    if (!isSupabaseConfigured) {
      logger.error('Supabase not configured');
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      if (data) {
        const profile: AuthProfile = {
          id: data.id,
          username: data.username,
          email: data.email,
          avatar: data.avatar,
          about: data.about,
          phone: data.phone,
          balance: data.balance || 0,
          created_at: data.created_at,
          updated_at: data.updated_at,
        };

        this.currentProfile = profile;
        await this.cacheProfile(profile);
        this.notifyListeners(profile);
        return profile;
      }

      return null;
    } catch (error) {
      logger.error('Error updating profile', { userId, updates, error });
      return null;
    }
  }

  /**
   * Refresh the current profile from Supabase
   */
  async refreshProfile(): Promise<AuthProfile | null> {
    const userId = this.getAuthUserId();
    if (!userId) {
      return null;
    }

    return await this.fetchAndSyncProfile(userId);
  }

  /**
   * Subscribe to profile changes
   */
  subscribe(listener: (profile: AuthProfile | null) => void): () => void {
    this.listeners.push(listener);
    
    // Immediately notify with current profile
    listener(this.currentProfile);
    
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Notify all listeners of profile changes
   */
  private notifyListeners(profile: AuthProfile | null): void {
    this.listeners.forEach(listener => {
      try {
        listener(profile);
      } catch (error) {
        logger.error('Error in profile listener', { error });
      }
    });
  }

  /**
   * Cache profile locally
   */
  private async cacheProfile(profile: AuthProfile): Promise<void> {
    try {
      const cached: CachedProfile = {
        profile,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(cached));
    } catch (error) {
      logger.error('Error caching profile', { error });
    }
  }

  /**
   * Load profile from cache
   */
  private async loadFromCache(): Promise<AuthProfile | null> {
    try {
      const cachedJson = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
      if (!cachedJson) {
        return null;
      }

      const cached: CachedProfile = JSON.parse(cachedJson);
      
      // Check if cache is still valid
      if (Date.now() - cached.timestamp > PROFILE_CACHE_EXPIRY) {
        return null;
      }

      return cached.profile;
    } catch (error) {
      logger.error('Error loading profile from cache', { error });
      return null;
    }
  }

  /**
   * Clear profile cache
   */
  private async clearCache(): Promise<void> {
    try {
      await AsyncStorage.removeItem(PROFILE_CACHE_KEY);
    } catch (error) {
      logger.error('Error clearing profile cache', { error });
    }
  }
}

// Export singleton instance
export const authProfileService = AuthProfileService.getInstance();
