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
const PROFILE_CACHE_EXPIRY = 30 * 60 * 1000; // 30 minutes — long enough to survive typical background restores

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
  // Phase 1 verification fields
  email_confirmed?: boolean;
  phone_verified?: boolean;
  id_verification_status?: 'unverified' | 'pending' | 'verified' | 'rejected';
  selfie_submitted_at?: string;
  display_name?: string;
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
  // Track the timestamp of the most recent fetchAndSyncProfile call to prevent
  // race conditions where background fetches complete out of order
  private latestFetchTimestamp: number = 0;

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
      // This method is for viewing ANOTHER user's profile (see docstring above
      // and hooks/useNormalizedProfile.ts, which only calls this on the
      // non-self branch). Query `public_profiles` -- a curated safe-columns
      // view -- directly, rather than `profiles.select('*')`, which would
      // expose balance/Stripe IDs/risk fields/email/phone for arbitrary other
      // users. See docs/withdrawals/08-profiles-rls-migration-strategy.md.
      let data: any = null;

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
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.log('[authProfileService] No public_profiles row for userId:', userId);
          }
          return null;
        }

        data = pub.data;
      } catch (e) {
        console.error('[authProfileService] Public_profiles query exception:', e);
        logger.error('Error fetching public_profiles', { userId, error: e });
        return null;
      }

      // Map the public_profiles row into AuthProfile shape. Fields not present
      // in the safe-columns view (email, phone, balance, verification/Stripe
      // state, etc.) are intentionally absent here -- this is another user's
      // profile, not the caller's own.
      const profile: AuthProfile = {
        id: data.id,
        username: data.username,
        email: data.email || undefined,
        avatar: data.avatar || data.avatar_url || undefined,
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
        // Phase 1 verification fields
        email_confirmed: typeof data.email_confirmed === 'boolean' ? data.email_confirmed : undefined,
        phone_verified: typeof data.phone_verified === 'boolean' ? data.phone_verified : undefined,
        id_verification_status: data.id_verification_status || undefined,
        selfie_submitted_at: data.selfie_submitted_at || undefined,
        display_name: data.display_name || undefined,
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
   * OPTIMIZATION: Check cache first for faster session restoration on app reopen
   */
  async fetchAndSyncProfile(userId: string): Promise<AuthProfile | null> {
    // Track this fetch attempt with a timestamp to prevent race conditions
    const fetchTimestamp = Date.now();
    this.latestFetchTimestamp = fetchTimestamp;
    
    console.log('[authProfileService] fetchAndSyncProfile START', { 
      userId,
      isSupabaseConfigured,
      fetchTimestamp
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

    // OPTIMIZATION: Check cache first for instant session restoration
    // This allows the app to show the main screen immediately while fresh data loads
    const cachedProfile = await this.loadFromCache(userId);
    if (cachedProfile) {
      console.log('[authProfileService] Using cached profile for fast restoration:', cachedProfile.username);
      this.currentProfile = cachedProfile;
      // Notify listeners immediately with cached data
      this.notifyListeners(cachedProfile);
      // Continue to fetch fresh data in background (don't await to avoid blocking)
      // Pass the fetchTimestamp to enable race condition detection
      // Use void to explicitly indicate intentional fire-and-forget behavior
      void this.fetchFreshProfileInBackground(userId, fetchTimestamp).catch((error) => {
        console.log('[authProfileService] Background fetch failed (non-critical, using cached data):', error);
      });
      return cachedProfile;
    }

    try {
      console.log('[authProfileService] No cache found, querying Supabase profiles table...');

      // Self-profile read goes through get_my_profile() (SECURITY DEFINER,
      // hard-scoped to auth.uid()) instead of a direct select('*') — the
      // `authenticated` role's SELECT privilege on sensitive columns
      // (balance, email, phone, stripe_*) is revoked at the column level
      // (see docs/withdrawals/08-profiles-rls-migration-strategy.md step 5).
      // Callers of fetchAndSyncProfile must only ever pass the caller's own
      // id (verified: the sole non-test call site, useNormalizedProfile.ts,
      // branches to getProfileById for any other user).
      const { data, error } = await supabase.rpc('get_my_profile');

      console.log('[authProfileService] Supabase query completed', {
        hasData: !!data,
        hasError: !!error,
        errorCode: error?.code,
        errorMessage: error?.message
      });

      if (error) {
        console.error('[authProfileService] Supabase query error:', error);
        throw error;
      }

      if (!data) {
        // get_my_profile() returns null when no row exists for auth.uid() —
        // same "needs onboarding" case the old PGRST116 branch handled.
        console.log('[authProfileService] Profile not found, user needs to complete onboarding');
        logger.warning('Profile not found, user needs onboarding', { userId });

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

      if (data) {
          const profile: AuthProfile = {
          id: data.id,
          username: data.username,
          email: data.email,
            avatar: data.avatar || data.avatar_url || undefined,
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
          // Phase 1 verification fields
          email_confirmed: typeof data.email_confirmed === 'boolean' ? data.email_confirmed : undefined,
          phone_verified: typeof data.phone_verified === 'boolean' ? data.phone_verified : undefined,
          id_verification_status: data.id_verification_status || undefined,
          selfie_submitted_at: data.selfie_submitted_at || undefined,
          display_name: data.display_name || undefined,
        };

        console.log('[authProfileService] Profile data mapped', { username: profile.username, id: profile.id });
        this.currentProfile = profile;
        await this.cacheProfile(profile);
        console.log('[authProfileService] Notifying listeners, count:', this.listeners.length);
        this.notifyListeners(profile);
        console.log('[authProfileService] fetchAndSyncProfile SUCCESS');
        return profile;
      }

      return null;
    } catch (error) {
      // Detect cases where the server returned an HTML error page (common when
      // the SUPABASE URL is misconfigured or a proxy/hosting page is returned).
      const msg = (error && (((error as any).message) || String(error))) || '';
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
   * Fetch fresh profile data in background without blocking
   * Used after returning cached data for instant UI update
   * @param userId - The user ID to fetch profile for
   * @param callerFetchTimestamp - The timestamp from the calling fetchAndSyncProfile to detect race conditions
   * @private
   */
  private async fetchFreshProfileInBackground(userId: string, callerFetchTimestamp: number): Promise<void> {
    try {
      console.log('[authProfileService] Fetching fresh profile in background for userId:', userId);
      
      // Self-profile read via get_my_profile() — see fetchAndSyncProfile for
      // why this can't be a direct select('*') anymore.
      const { data, error } = await supabase.rpc('get_my_profile');

      if (error) {
        // Don't throw — we already have cached data displayed
        console.log('[authProfileService] Background fetch error (non-critical):', error.code, error.message);
        return;
      }

      // Check if a newer fetch has started since we began
      // This prevents race conditions where multiple background fetches complete out of order
      // Only apply results if no newer fetch has been initiated
      if (callerFetchTimestamp < this.latestFetchTimestamp) {
        console.log('[authProfileService] Discarding stale background fetch result (newer fetch has started)');
        return;
      }

      if (!data) {
        // get_my_profile() returns null when no row exists for auth.uid() —
        // the profile no longer exists server-side; clear the stale cache
        // and redirect to onboarding, same as the old PGRST116 branch.
        console.log('[authProfileService] Background fetch: profile not found, clearing stale cache');
        await this.clearCache(userId);
        const onboardingNeededProfile: AuthProfile = {
          id: userId,
          username: '',
          email: this.currentSession?.user?.email,
          balance: 0,
          onboarding_completed: false,
          needs_onboarding: true,
        };
        this.currentProfile = onboardingNeededProfile;
        this.notifyListeners(onboardingNeededProfile);
        return;
      }

      if (data) {
        const freshProfile: AuthProfile = {
          id: data.id,
          username: data.username,
          email: data.email,
          avatar: data.avatar || data.avatar_url || undefined,
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
          // Phase 1 verification fields
          email_confirmed: typeof data.email_confirmed === 'boolean' ? data.email_confirmed : undefined,
          phone_verified: typeof data.phone_verified === 'boolean' ? data.phone_verified : undefined,
          id_verification_status: data.id_verification_status || undefined,
          selfie_submitted_at: data.selfie_submitted_at || undefined,
          display_name: data.display_name || undefined,
        };

        console.log('[authProfileService] Fresh profile fetched, updating cache and notifying listeners');
        this.currentProfile = freshProfile;
        await this.cacheProfile(freshProfile);
        this.notifyListeners(freshProfile);
      }
    } catch (error) {
      // Silent failure - we have cached data already displayed
      console.log('[authProfileService] Background fetch failed (non-critical):', error);
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
      // select('id') only, not select('*') — see updateProfile() for why an
      // INSERT...RETURNING of sensitive columns would fail under the
      // column-level REVOKE. The full row is re-fetched via get_my_profile()
      // below once the insert is confirmed.
      const { data: insertedRow, error } = await supabase
        .from('profiles')
        .insert(insertData)
        .select('id')
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

      if (insertedRow) {
        const { data: freshRow, error: rpcError } = await supabase.rpc('get_my_profile');
        if (rpcError || !freshRow) {
          logger.error('get_my_profile returned no row after minimal-profile insert', { userId, rpcError });
          this.currentProfile = null;
          this.notifyListeners(null);
          return null;
        }

        const profile: AuthProfile = {
          id: freshRow.id,
          username: freshRow.username,
          email: freshRow.email,
          avatar: freshRow.avatar || freshRow.avatar_url || undefined,
          about: freshRow.about,
          phone: freshRow.phone,
          title: freshRow.title || undefined,
          location: freshRow.location || undefined,
          skills: Array.isArray(freshRow.skills) ? freshRow.skills : undefined,
          age_verified: typeof freshRow.age_verified === 'boolean' ? freshRow.age_verified : undefined,
          age_verified_at: freshRow.age_verified_at || undefined,
          balance: freshRow.balance || 0,
          created_at: freshRow.created_at,
          updated_at: freshRow.updated_at,
          onboarding_completed: typeof freshRow.onboarding_completed === 'boolean' ? freshRow.onboarding_completed : undefined,
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
      // Use update() with an equality filter so unit tests that mock
      // `from('profiles').update(...).eq(...).select().single()` work
      //
      // IMPORTANT: select('id') only, not select('*'). The `authenticated`
      // role's SELECT privilege on sensitive profiles columns (balance,
      // email, phone, stripe_*) is revoked at the column level (see
      // docs/withdrawals/08-profiles-rls-migration-strategy.md step 5) — a
      // PostgREST UPDATE...RETURNING requires SELECT privilege on whatever
      // columns it returns, so selecting those columns here would fail even
      // though the UPDATE itself is allowed. `id` is never restricted; it's
      // only used to confirm a row was actually affected.
        const { data: initialRes, error: initialError } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select('id')
        .single();
      const fromProfiles: any = supabase.from('profiles');

      // If the initial update succeeded, use its result directly and skip additional writes.
      let data: any = initialRes;
      let error: any = initialError ?? null;

      if (!data) {
        // Initial update returned no row — try upsert to handle a missing-row case.
        // The test mocks sometimes provide an object with `.update()` (not `.upsert()`),
        // so support both invocation styles to keep integration tests working.
        let res: { data: any; error: any };
        if (typeof fromProfiles.upsert === 'function') {
          res = await fromProfiles
            .upsert({ id: userId, ...updates }, { onConflict: 'id' })
            .select('id')
            .single();
        } else {
          res = await fromProfiles
            .update(updates)
            .eq('id', userId)
            .select('id')
            .single();
        }
        data = res.data ?? null;
        error = res.data ? null : (res.error ?? initialError ?? null);
      }

      if (error) {
        throw error;
      }

      if (!data) {
        return null;
      }

      // Fetch the authoritative post-update row via the self-scoped RPC
      // instead of relying on UPDATE...RETURNING for it. get_my_profile()
      // is SECURITY DEFINER and hard-scoped to auth.uid(), so it can still
      // read the sensitive columns the `authenticated` role itself can no
      // longer SELECT directly.
      const { data: freshRow, error: rpcError } = await supabase.rpc('get_my_profile');
      if (rpcError || !freshRow) {
        throw rpcError ?? new Error('get_my_profile returned no row after update');
      }

      const profile: AuthProfile = {
        id: freshRow.id,
        username: freshRow.username,
        email: freshRow.email,
        avatar: freshRow.avatar || freshRow.avatar_url || undefined,
        about: freshRow.about,
        phone: freshRow.phone,
        title: freshRow.title || undefined,
        location: freshRow.location || undefined,
        skills: Array.isArray(freshRow.skills) ? freshRow.skills : undefined,
        age_verified: typeof freshRow.age_verified === 'boolean' ? freshRow.age_verified : undefined,
        age_verified_at: freshRow.age_verified_at || undefined,
        balance: freshRow.balance || 0,
        created_at: freshRow.created_at,
        updated_at: freshRow.updated_at,
        onboarding_completed: typeof freshRow.onboarding_completed === 'boolean' ? freshRow.onboarding_completed : undefined,
      };

      this.currentProfile = profile;
      await this.cacheProfile(profile);
      this.notifyListeners(profile);
      return profile;
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
