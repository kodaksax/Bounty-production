/**
 * Auth Profile Service
 * Central service for managing authenticated user profile data
 * Ensures tight coupling between Supabase auth and profile data
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase, supabaseEnv } from '../supabase';
import { logger } from '../utils/error-logger';

const PROFILE_CACHE_KEY_PREFIX = 'BE:authProfile';
const PROFILE_CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

// Helper to generate user-specific cache key
const getProfileCacheKey = (userId: string) => `${PROFILE_CACHE_KEY_PREFIX}:${userId}`;

export interface AuthProfile {
  id: string; // User ID from Supabase auth
  username: string;
  email?: string;
  avatar?: string;
  about?: string;
  phone?: string;
  age_verified?: boolean;
  age_verified_at?: string; // ISO timestamp for audit purposes
  balance: number;
  created_at?: string;
  updated_at?: string;
  onboarding_completed?: boolean; // Track if user has completed onboarding flow
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
  private externalProfileCache = new Map<string, CachedProfile>();

  private constructor() {}

  static getInstance(): AuthProfileService {
    if (!AuthProfileService.instance) {
      AuthProfileService.instance = new AuthProfileService();
    }
    return AuthProfileService.instance;
  }

  /**
   * Fetch a profile by ID without mutating the authenticated profile state.
   * Useful for looking up other users (e.g., bounty posters) while keeping the
   * current session profile intact. Results are cached briefly to avoid
   * refetching for the same card renders.
   */
  async getProfileById(userId: string, options: { bypassCache?: boolean } = {}): Promise<AuthProfile | null> {
    if (!isSupabaseConfigured) {
      return null;
    }

    const { bypassCache = false } = options;
    if (!bypassCache) {
      const cached = this.externalProfileCache.get(userId);
      if (cached && Date.now() - cached.timestamp < PROFILE_CACHE_EXPIRY) {
        return cached.profile;
      }
    }

    try {
      // Try canonical profiles table first
      let data: any = null;
      let error: any = null;

      try {
        const res = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        data = res.data ?? null;
        error = res.error ?? null;
      } catch (e) {
        data = null;
        error = e;
      }

      // If profiles returned an error or no data, attempt public_profiles fallback
      if (!data) {
        try {
          const pub = await supabase
            .from('public_profiles')
            // PostgREST aliasing uses `alias:column` — alias the snake_case DB column
            // to a camelCase property so the app can read `displayName` safely.
            .select('id,username,displayName:display_name,avatar,location')
            .eq('id', userId)
            .maybeSingle();
          if (pub.error) {
            // If both attempts fail, surface a warning and return null
            // Include error.code/message and the select used so we can trace 42703 (undefined column) errors.
            logger.warning('public_profiles fetch error', {
              userId,
              select: "id,username,displayName:display_name,avatar,location",
              errorCode: pub.error?.code,
              errorMessage: pub.error?.message || pub.error,
              rawError: pub.error,
            });
            return null;
          }

          if (!pub.data) {
            // No public profile either
            return null;
          }

          data = pub.data;
        } catch (e) {
          logger.error('Error fetching public_profiles', { userId, error: e });
          return null;
        }
      }

      if (!data) {
        return null;
      }

      // Map returned row (from profiles or public_profiles) into AuthProfile shape
      const profile: AuthProfile = {
        id: data.id,
        username: data.username,
        email: data.email || undefined,
        avatar: data.avatar || undefined,
        about: data.about || undefined,
        phone: data.phone || undefined,
        age_verified: typeof data.age_verified === 'boolean' ? data.age_verified : undefined,
        age_verified_at: data.age_verified_at || undefined,
        balance: data.balance || 0,
        created_at: data.created_at || undefined,
        updated_at: data.updated_at || undefined,
        onboarding_completed: typeof data.onboarding_completed === 'boolean' ? data.onboarding_completed : undefined,
      };

      if (!bypassCache) {
        this.externalProfileCache.set(userId, {
          profile,
          timestamp: Date.now(),
        });
      }

      return profile;
    } catch (error) {
      logger.error('Error fetching profile by id', { userId, error });
      if (!bypassCache) {
        this.externalProfileCache.delete(userId);
      }
      return null;
    }
  }

  /**
   * Set the current session and fetch/sync profile
   */
  async setSession(session: Session | null): Promise<void> {
    const previousUserId = this.currentSession?.user?.id;
    this.currentSession = session;
    
    if (!session) {
      this.currentProfile = null;
      // Clear cache for the previous user if switching users
      if (previousUserId) {
        await this.clearCache(previousUserId);
      }
      this.notifyListeners(null);
      return;
    }

    // If switching users, clear the previous user's cache
    if (previousUserId && previousUserId !== session.user.id) {
      await this.clearCache(previousUserId);
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
          age_verified: typeof data.age_verified === 'boolean' ? data.age_verified : undefined,
          age_verified_at: data.age_verified_at || undefined,
          balance: data.balance || 0,
          created_at: data.created_at,
          updated_at: data.updated_at,
          onboarding_completed: typeof data.onboarding_completed === 'boolean' ? data.onboarding_completed : undefined,
        };

        this.currentProfile = profile;
        await this.cacheProfile(profile);
        this.notifyListeners(profile);
        return profile;
      }

      return null;
    } catch (error: any) {
      // Detect cases where the server returned an HTML error page (common when
      // the SUPABASE URL is misconfigured or a proxy/hosting page is returned).
      const msg = (error && (error.message || String(error))) || '';
      if (typeof msg === 'string' && (msg.includes('<!DOCTYPE') || msg.toLowerCase().includes('<html'))) {
        logger.error('Error fetching profile - received HTML response from Supabase. This usually means EXPO_PUBLIC_SUPABASE_URL is incorrect or points to a non-Supabase host.', { userId, supabaseEnv, errorSummary: msg.substring(0, 300) });
      } else {
        logger.error('Error fetching profile', { userId, error });
      }
      
      // Try to load from cache
  const cached = await this.loadFromCache(userId);
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
  const metaAgeVerified = (this.currentSession?.user?.user_metadata as any)?.age_verified;
  const age_verified = typeof metaAgeVerified === 'boolean' ? metaAgeVerified : false;
  // Set age_verified_at timestamp if age was verified during signup (for audit purposes)
  // Use undefined instead of null to properly omit the field when not verified
  const age_verified_at = age_verified ? new Date().toISOString() : undefined;

      // Check if profile already exists (race condition protection)
      const existing = await this.getProfileById(userId, { bypassCache: true });

      if (existing) {
        // Profile was created by another process, use it
        this.currentProfile = existing;
        await this.cacheProfile(existing);
        this.notifyListeners(existing);
        return existing;
      }

      // Create new minimal profile - only include age_verified_at if age is verified
      // NEW USERS: Set onboarding_completed = false so they go through onboarding
      const insertData: Record<string, any> = {
        id: userId,
        username: username,
        email: email,
        balance: 0,
        age_verified: age_verified,
        onboarding_completed: false, // New users haven't completed onboarding yet
      };
      if (age_verified_at) {
        insertData.age_verified_at = age_verified_at;
      }
      
      const { data, error } = await supabase
        .from('profiles')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        // If error is due to duplicate key, profile was created concurrently
        if (error.code === '23505') {
          logger.warning('Profile already exists (concurrent creation)', { userId });
          // Fetch the existing profile
          const existingProfile = await this.getProfileById(userId, { bypassCache: true });

          if (existingProfile) {
            this.currentProfile = existingProfile;
            await this.cacheProfile(existingProfile);
            this.notifyListeners(existingProfile);
            return existingProfile;
          }
        }

        if (error.code === '42501') {
          logger.error('Supabase RLS blocked profile insert. Grant authenticated users insert access on public.profiles (id = auth.uid()).', { userId, error });
        } else {
          logger.error('Error creating minimal profile', { userId, error });
        }
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
          age_verified: typeof data.age_verified === 'boolean' ? data.age_verified : undefined,
          age_verified_at: data.age_verified_at || undefined,
          balance: data.balance || 0,
          created_at: data.created_at,
          updated_at: data.updated_at,
          onboarding_completed: typeof data.onboarding_completed === 'boolean' ? data.onboarding_completed : undefined,
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
          age_verified: typeof data.age_verified === 'boolean' ? data.age_verified : undefined,
          age_verified_at: data.age_verified_at || undefined,
          balance: data.balance || 0,
          created_at: data.created_at,
          updated_at: data.updated_at,
          onboarding_completed: typeof data.onboarding_completed === 'boolean' ? data.onboarding_completed : undefined,
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
      const cacheKey = getProfileCacheKey(profile.id);
      await AsyncStorage.setItem(cacheKey, JSON.stringify(cached));
    } catch (error) {
      logger.error('Error caching profile', { error });
    }
  }

  /**
   * Load profile from cache
   */
  private async loadFromCache(userId: string): Promise<AuthProfile | null> {
    try {
      const cacheKey = getProfileCacheKey(userId);
      const cachedJson = await AsyncStorage.getItem(cacheKey);
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
   * Clear profile cache for a specific user
   */
  private async clearCache(userId: string): Promise<void> {
    try {
      const cacheKey = getProfileCacheKey(userId);
      await AsyncStorage.removeItem(cacheKey);
    } catch (error) {
      logger.error('Error clearing profile cache', { error });
    }
  }

  /**
   * Clear all user-specific draft data (edit profile drafts, etc.)
   * Should be called on logout to prevent data leaks
   */
  async clearUserDraftData(userId: string): Promise<void> {
    try {
      // Clear edit profile draft
      const draftKey = `editProfile:draft:${userId}`;
      await AsyncStorage.removeItem(draftKey);
      
      // Clear skills data
      const skillsKey = `profileSkills:${userId}`;
      await AsyncStorage.removeItem(skillsKey);
      
      // Clear profile data
      const profileDataKey = `profileData:${userId}`;
      await AsyncStorage.removeItem(profileDataKey);
      
      // Clear profile cache
      await this.clearCache(userId);
      
      logger.info('Cleared user draft data', { userId });
    } catch (error) {
      logger.error('Error clearing user draft data', { error });
    }
  }
}

// Export singleton instance
export const authProfileService = AuthProfileService.getInstance();
