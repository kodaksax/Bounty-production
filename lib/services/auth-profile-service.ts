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
  title?: string; // Professional title/role
  location?: string; // Geographic location
  skills?: string[]; // Array of skills/expertise
  age_verified?: boolean;
  age_verified_at?: string; // ISO timestamp for audit purposes
  balance: number;
  created_at?: string;
  updated_at?: string;
  onboarding_completed?: boolean; // Track if user has completed onboarding flow
  needs_onboarding?: boolean; // Flag to indicate user needs to complete onboarding (no profile exists)
}

interface CachedProfile {
  profile: AuthProfile;
  timestamp: number;
}

export class AuthProfileService {
  private static instance: AuthProfileService;
  private currentSession: Session | null = null;
  private currentProfile: AuthProfile | null = null;
  private listeners: ((profile: AuthProfile | null) => void)[] = [];
  private externalProfileCache = new Map<string, CachedProfile>();
  // Re-entrancy guard for notification cycles. If notifyListeners is called
  // while a notification is already in progress, the latest pending profile
  // will be scheduled to run after the current cycle completes. This preserves
  // synchronous delivery semantics for `subscribe()` while preventing
  // recursive feedback loops.
  private isNotifying = false;
  private hasPendingNotification = false;
  private pendingProfile: AuthProfile | null = null;

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
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('[authProfileService] getProfileById called', { userId, isSupabaseConfigured });
    }

    if (!isSupabaseConfigured) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[authProfileService] Supabase not configured - cannot fetch profile by ID');
      }
      return null;
    }

    const { bypassCache = false } = options;
      if (!bypassCache) {
      const cached = this.externalProfileCache.get(userId);
      if (cached && Date.now() - cached.timestamp < PROFILE_CACHE_EXPIRY) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.log('[authProfileService] Returning cached profile for userId:', userId);
        }
        return cached.profile;
      }
    }

    try {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('[authProfileService] Fetching profile from Supabase for userId:', userId);
      }
      // Try canonical profiles table first
      let data: any = null;
      let error: any = null;

      try {
        // Use Supabase SDK without custom timeout wrapper
        // Allows SDK to use its internal network handling and retry logic
        // Custom timeouts were causing premature request cancellation
        const res = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        data = res.data ?? null;
        error = res.error ?? null;
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.log('[authProfileService] Profiles table query result', { hasData: !!data, hasError: !!error });
        }
      } catch (e: any) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.error('[authProfileService] Profiles table query exception:', e);
        }
        logger.warning('Profile fetch error', { userId, error: e });
        data = null;
        error = e;
      }

      // If profiles returned an error or no data, attempt public_profiles fallback
      if (!data) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.log('[authProfileService] Trying public_profiles fallback...');
        }
        try {
          // Use Supabase SDK without custom timeout wrapper
          // Allows SDK to use its internal network handling and retry logic
          const pub = await supabase
            .from('public_profiles')
            // PostgREST aliasing uses `alias:column` — alias the snake_case DB column
            // to a camelCase property so the app can read `displayName` safely.
            .select('id,username,displayName:display_name,avatar,location')
            .eq('id', userId)
            .maybeSingle();
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.log('[authProfileService] Public_profiles query result', { hasData: !!pub.data, hasError: !!pub.error });
          }
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
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              console.log('[authProfileService] No data in public_profiles either');
            }
            return null;
          }

          data = pub.data;
        } catch (e) {
          console.error('[authProfileService] Public_profiles query exception:', e);
          logger.error('Error fetching public_profiles', { userId, error: e });
          return null;
        }
      }

      if (!data) {
        console.warn('[authProfileService] No profile data found for userId:', userId);
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
        title: data.title || undefined,
        location: data.location || undefined,
        skills: Array.isArray(data.skills) ? data.skills : undefined,
        age_verified: typeof data.age_verified === 'boolean' ? data.age_verified : undefined,
        age_verified_at: data.age_verified_at || undefined,
        balance: data.balance || 0,
        created_at: data.created_at || undefined,
        updated_at: data.updated_at || undefined,
        onboarding_completed: typeof data.onboarding_completed === 'boolean' ? data.onboarding_completed : undefined,
      };

      console.log('[authProfileService] Successfully fetched profile', { username: profile.username, id: profile.id });

      if (!bypassCache) {
        this.externalProfileCache.set(userId, {
          profile,
          timestamp: Date.now(),
        });
      }

      return profile;
    } catch (error) {
      console.error('[authProfileService] getProfileById exception:', error);
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
    
    console.log('[authProfileService] setSession called', { 
      previousUserId, 
      newUserId: session?.user?.id,
      hasSession: !!session 
    });
    
    if (!session) {
      console.log('[authProfileService] No session, clearing profile');
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

    console.log('[authProfileService] Calling fetchAndSyncProfile for userId:', session.user.id);
    // Fetch and sync profile for authenticated user
    await this.fetchAndSyncProfile(session.user.id);
    console.log('[authProfileService] fetchAndSyncProfile completed, profile exists:', !!this.currentProfile);
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
    console.log('[authProfileService] fetchAndSyncProfile START', { 
      userId,
      isSupabaseConfigured 
    });
    
    if (!isSupabaseConfigured) {
      console.log('[authProfileService] Supabase not configured - creating fallback profile');
      // When Supabase is not configured, return a fallback profile so the app
      // can function in development mode without full backend setup
      const normalizedUserId = (userId ?? '').toString().trim();
      const safeUserSuffix = (normalizedUserId || 'devuser').slice(0, 8);
      const fallbackProfile: AuthProfile = {
        id: userId,
        username: `user_${safeUserSuffix}`,
        email: undefined,
        about: 'Development user (Supabase not configured)',
        balance: 0,
        onboarding_completed: false,
      };
      console.log('[authProfileService] Using fallback profile:', fallbackProfile.username);
      this.currentProfile = fallbackProfile;
      await this.cacheProfile(fallbackProfile);
      this.notifyListeners(fallbackProfile);
      return fallbackProfile;
    }

    try {
      console.log('[authProfileService] Querying Supabase profiles table...');
      
      // Use Supabase SDK's built-in network handling and timeouts
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      console.log('[authProfileService] Supabase query completed', { 
        hasData: !!data, 
        hasError: !!error,
        errorCode: error?.code,
        errorMessage: error?.message 
      });

      if (error) {
        // If profile doesn't exist, return a special state indicating onboarding is needed
        // Instead of creating a minimal profile, we'll redirect the user to onboarding
        if (error.code === 'PGRST116') {
          console.log('[authProfileService] Profile not found (PGRST116), user needs to complete onboarding');
          logger.warning('Profile not found, user needs onboarding', { userId });
          
          // Return a special profile state indicating onboarding is needed
          const onboardingNeededProfile: AuthProfile = {
            id: userId,
            username: '', // Will be set during onboarding
            email: this.currentSession?.user?.email,
            balance: 0,
            onboarding_completed: false,
            needs_onboarding: true, // Special flag to indicate onboarding is required
          };
          
          this.currentProfile = onboardingNeededProfile;
          this.notifyListeners(onboardingNeededProfile);
          return onboardingNeededProfile;
        }
        console.error('[authProfileService] Supabase query error:', error);
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
          title: data.title || undefined,
          location: data.location || undefined,
          skills: Array.isArray(data.skills) ? data.skills : undefined,
          age_verified: typeof data.age_verified === 'boolean' ? data.age_verified : undefined,
          age_verified_at: data.age_verified_at || undefined,
          balance: data.balance || 0,
          created_at: data.created_at,
          updated_at: data.updated_at,
          onboarding_completed: typeof data.onboarding_completed === 'boolean' ? data.onboarding_completed : undefined,
        };

        console.log('[authProfileService] Profile data mapped', { username: profile.username, id: profile.id });
        this.currentProfile = profile;
        await this.cacheProfile(profile);
        console.log('[authProfileService] Notifying listeners, count:', this.listeners.length);
        this.notifyListeners(profile);
        console.log('[authProfileService] fetchAndSyncProfile SUCCESS');
        return profile;
      }

      console.warn('[authProfileService] Supabase returned no data and no error - user needs onboarding');
      // If no data and no error, return onboarding needed state
      // This handles edge cases where the profile wasn't created by the trigger
      logger.warning('Profile query returned no data, user needs onboarding. This should be rare if DB trigger is working.', { userId });
      
      // Track this fallback for monitoring
      if (__DEV__) {
        console.warn('[authProfileService] MONITORING: No profile found - check if DB trigger is working');
      }
      
      // Return a special profile state indicating onboarding is needed
      const onboardingNeededProfile: AuthProfile = {
        id: userId,
        username: '', // Will be set during onboarding
        email: this.currentSession?.user?.email,
        balance: 0,
        onboarding_completed: false,
        needs_onboarding: true, // Special flag to indicate onboarding is required
      };
      
      this.currentProfile = onboardingNeededProfile;
      this.notifyListeners(onboardingNeededProfile);
      return onboardingNeededProfile;
    } catch (error: any) {
      // Detect cases where the server returned an HTML error page (common when
      // the SUPABASE URL is misconfigured or a proxy/hosting page is returned).
      const msg = (error && (error.message || String(error))) || '';
      if (typeof msg === 'string' && (msg.includes('<!DOCTYPE') || msg.toLowerCase().includes('<html'))) {
        console.error('[authProfileService] Received HTML response - likely misconfigured Supabase URL');
        logger.error('Error fetching profile - received HTML response from Supabase. This usually means EXPO_PUBLIC_SUPABASE_URL is incorrect or points to a non-Supabase host.', { userId, supabaseEnv, errorSummary: msg.substring(0, 300) });
      } else {
        console.error('[authProfileService] fetchAndSyncProfile ERROR:', error);
        logger.error('Error fetching profile', { userId, error });
      }
      
      // Try to load from cache
      console.log('[authProfileService] Attempting to load from cache...');
      const cached = await this.loadFromCache(userId);
      if (cached && cached.id === userId) {
        console.log('[authProfileService] Loaded profile from cache');
        this.currentProfile = cached;
        this.notifyListeners(cached);
        return cached;
      }
      
      console.error('[authProfileService] No cached profile available, returning null');
      // IMPORTANT: Always notify listeners even on failure to clear loading states
      this.currentProfile = null;
      this.notifyListeners(null);
      return null;
    }
  }

  /**
   * Create a minimal profile for a new user with retry logic
   * This is called when a Supabase auth user exists but has no profile record
   * Note: Minimal profiles are temporary - users should complete onboarding
   */
  private async createMinimalProfile(userId: string, retryCount: number = 0): Promise<AuthProfile | null> {
    if (!isSupabaseConfigured) {
      return null;
    }

    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1000;

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
        logger.info('Profile already exists, using existing profile', { userId, retryCount });
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
      
      // Use Supabase SDK's built-in network handling and timeouts
      const { data, error } = await supabase
        .from('profiles')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        // If error is due to duplicate key, profile was created concurrently
        if (error.code === '23505') {
          logger.warning('Profile already exists (concurrent creation)', { userId, retryCount });
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
          logger.error('Error creating minimal profile', { userId, error, retryCount });
          
          // Retry on transient errors (network, timeout, etc.)
          const isRetryableError = 
            error.message?.includes('network') ||
            error.message?.includes('timeout') ||
            error.code === 'PGRST301' || // Connection error
            error.code === '08000' || // Connection exception
            error.code === '08003' || // Connection does not exist
            error.code === '08006'; // Connection failure
          
          if (isRetryableError && retryCount < MAX_RETRIES) {
            const delayMs = BASE_DELAY_MS * Math.pow(2, retryCount); // Exponential backoff
            logger.info('Retrying profile creation after transient error', { userId, retryCount, delayMs });
            await new Promise(resolve => setTimeout(resolve, delayMs));
            return this.createMinimalProfile(userId, retryCount + 1);
          }
        }
        // IMPORTANT: Notify listeners with null to clear loading states even on failure
        this.currentProfile = null;
        this.notifyListeners(null);
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
          title: data.title || undefined,
          location: data.location || undefined,
          skills: Array.isArray(data.skills) ? data.skills : undefined,
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
        logger.info('Created minimal profile for new user', { userId, username, retryCount });
        return profile;
      }

      // No data returned from insert - notify listeners with null
      console.warn('[authProfileService] Profile insert returned no data');
      this.currentProfile = null;
      this.notifyListeners(null);
      return null;
    } catch (error) {
      logger.error('Error creating minimal profile', { userId, error });
      // IMPORTANT: Always notify listeners even on error to clear loading states
      this.currentProfile = null;
      this.notifyListeners(null);
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
      // Use Supabase SDK's built-in network handling and timeouts
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
          title: data.title || undefined,
          location: data.location || undefined,
          skills: Array.isArray(data.skills) ? data.skills : undefined,
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
   *
   * Immediately notifies the new subscriber synchronously with the current
   * profile value. A re-entrancy guard prevents listeners from causing
   * recursive notification loops: if notifications are triggered while a
   * delivery is in progress, the latest pending profile will be delivered
   * after the current cycle completes.
   */
  subscribe(listener: (profile: AuthProfile | null) => void): () => void {
    this.listeners.push(listener);

    // Immediately notify synchronously (preserve historical behavior).
    try {
      listener(this.currentProfile);
    } catch (e) {
      logger.error('Error in initial profile listener', { error: e });
    }

    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Notify all listeners of profile changes
   */
  private notifyListeners(profile: AuthProfile | null): void {
    // If a notification cycle is already in progress, schedule the latest
    // profile as a pending notification and return. It will be delivered
    // once the current cycle completes. This prevents re-entrant listeners
    // from causing infinite or nested notification loops while keeping
    // delivery synchronous for subscribers added via `subscribe()`.
    if (this.isNotifying) {
      this.hasPendingNotification = true;
      this.pendingProfile = profile;
      return;
    }

    this.isNotifying = true;
    try {
      const listenersSnapshot = [...this.listeners];
      for (const listener of listenersSnapshot) {
        try {
          listener(profile);
        } catch (error) {
          logger.error('Error in profile listener', { error });
        }
      }
    } finally {
      this.isNotifying = false;
      if (this.hasPendingNotification) {
        // Consume pending notification and reset the flag before delivering
        // to avoid re-entrancy races.
        this.hasPendingNotification = false;
        const next = this.pendingProfile;
        this.pendingProfile = null;
        // Deliver the pending notification synchronously as well.
        this.notifyListeners(next);
      }
    }
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
