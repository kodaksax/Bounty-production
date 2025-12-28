import * as Sentry from '@sentry/react-native'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from 'hooks/use-auth-context'
import { supabase } from 'lib/supabase'
import { PropsWithChildren, useContext, useEffect, useRef, useState } from 'react'
import { analyticsService } from '../lib/services/analytics-service'
import { authProfileService } from '../lib/services/auth-profile-service'

type AuthData = {
  session: Session | null | undefined
  isLoading: boolean
  profile: any
  isLoggedIn: boolean
}

/**
 * Token refresh threshold in milliseconds (5 minutes before expiration)
 * Proactively refresh the token when it's close to expiring
 */
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000

export default function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | undefined | null>()
  const [profile, setProfile] = useState<any>()
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isEmailVerified, setIsEmailVerified] = useState<boolean>(false)
  const refreshTimerRef = useRef<number | null>(null)
  const isRefreshingRef = useRef<boolean>(false)
  const isMountedRef = useRef<boolean>(true)
  const isInitializingRef = useRef<boolean>(true)
  const profileFetchCompletedRef = useRef<boolean>(false)
  const sessionIdRef = useRef<string | null>(null)
  const lastProfileLogRef = useRef<string | null>(null)

  /**
   * Manually refresh the session token
   */
  const refreshTokenNow = async () => {
    // Prevent concurrent refresh attempts
    if (isRefreshingRef.current) {
      console.log('[AuthProvider] Refresh already in progress, skipping')
      return
    }

    // Check if component is still mounted
    if (!isMountedRef.current) {
      console.log('[AuthProvider] Component unmounted, skipping refresh')
      return
    }

    isRefreshingRef.current = true

    try {
      console.log('[AuthProvider] Attempting to refresh token...')
      const { data, error } = await supabase.auth.refreshSession()
      
      if (error) {
        console.error('[AuthProvider] Token refresh failed:', error)
        
        // Distinguish between network errors and auth errors
        const isNetworkError = error.message?.includes('network') || 
                               error.message?.includes('fetch') ||
                               error.status === 503 ||
                               error.status === 504
        
        if (isNetworkError) {
          console.log('[AuthProvider] Network error during refresh, will retry')
          // Don't clear session on network errors, let it be retried
          return
        }
        
        // On permanent auth failure, clear session and let user re-authenticate
        if (isMountedRef.current) {
          setSession(null)
          try {
            await authProfileService.setSession(null)
          } catch (e) {
            console.error('[AuthProvider] Error clearing session in profile service:', e)
          }
        }
        return
      }

      if (data.session) {
        console.log('[AuthProvider] Token refreshed successfully')
        if (isMountedRef.current) {
          setSession(data.session)
          try {
            await authProfileService.setSession(data.session)
          } catch (e) {
            console.error('[AuthProvider] Error setting session in profile service:', e)
          }
          
          // Schedule next refresh
          scheduleTokenRefresh(data.session)
        }
      } else {
        console.warn('[AuthProvider] Token refresh returned no session')
        if (isMountedRef.current) {
          setSession(null)
          try {
            await authProfileService.setSession(null)
          } catch (e) {
            console.error('[AuthProvider] Error clearing session in profile service:', e)
          }
        }
      }
    } catch (error) {
      console.error('[AuthProvider] Unexpected error refreshing token:', error)
      if (isMountedRef.current) {
        setSession(null)
        try {
          await authProfileService.setSession(null)
        } catch (e) {
          console.error('[AuthProvider] Error clearing session in profile service:', e)
        }
      }
    } finally {
      isRefreshingRef.current = false
    }
  }

  /**
   * Schedule automatic token refresh before expiration
   * @param session - The session to schedule refresh for. If null or missing expires_at, no refresh is scheduled.
   */
  const scheduleTokenRefresh = (session: Session | null) => {
    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }

    // If no session or no expiration timestamp, nothing to refresh
    if (!session?.expires_at) {
      return
    }

    // Check if component is still mounted
    if (!isMountedRef.current) {
      return
    }

    // Supabase returns expires_at as Unix timestamp in seconds, convert to milliseconds
    const expiresAt = session.expires_at * 1000
    const now = Date.now()
    const timeUntilExpiry = expiresAt - now

    // If already expired, refresh immediately
    if (timeUntilExpiry <= 0) {
      console.log('[AuthProvider] Token expired, refreshing immediately')
      refreshTokenNow()
      return
    }

    // Schedule refresh 5 minutes before expiration
    // If token expires sooner than threshold, refreshIn will be 0 (immediate refresh)
    const refreshIn = Math.max(0, timeUntilExpiry - TOKEN_REFRESH_THRESHOLD_MS)
    
    console.log('[AuthProvider] Scheduling token refresh in', Math.floor(refreshIn / 1000), 'seconds')
    
    refreshTimerRef.current = setTimeout(() => {
      console.log('[AuthProvider] Proactive token refresh triggered')
      refreshTokenNow()
    }, refreshIn)
  }

  // Fetch the session once, and subscribe to auth state changes
  useEffect(() => {
    isMountedRef.current = true
    isInitializingRef.current = true
    profileFetchCompletedRef.current = false

    const fetchSession = async () => {
      setIsLoading(true)
      let sessionFound = false

      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession()

        if (!isMountedRef.current) return

        if (error) {
          console.error('[AuthProvider] Error fetching session:', error)
          setSession(null)
          try {
            await authProfileService.setSession(null)
          } catch (e) {
            console.error('[AuthProvider] Error clearing session in profile service:', e)
          }
        } else if (session) {
          // Valid session found
          sessionFound = true
          console.log('[AuthProvider] Session loaded: authenticated')
          setSession(session)
          sessionIdRef.current = session.user.id
          
          // Sync session with auth profile service
          try {
            await authProfileService.setSession(session)
            // Mark that profile fetch has completed (successfully or not)
            profileFetchCompletedRef.current = true
          } catch (e) {
            console.error('[AuthProvider] Error setting session in profile service:', e)
            // Even on error, mark as completed to avoid blocking
            profileFetchCompletedRef.current = true
          }
          
          // Email verification gate: Check if email is verified
          // Priority: session.user?.email_confirmed_at > profile.email_verified > false
          const verified = Boolean(
            session.user?.email_confirmed_at ||
            session.user?.confirmed_at
          )
          setIsEmailVerified(verified)

          // Schedule automatic token refresh
          if (isMountedRef.current) {
            scheduleTokenRefresh(session)
          }
        } else {
          // No error but also no session (user not logged in)
          console.log('[AuthProvider] Session loaded: not authenticated')
          setSession(null)
          try {
            await authProfileService.setSession(null)
          } catch (e) {
            console.error('[AuthProvider] Error clearing session in profile service:', e)
          }
        }
      } catch (error) {
        console.error('[AuthProvider] Unexpected error fetching session:', error)
        if (!isMountedRef.current) return
        setSession(null)
        try {
          await authProfileService.setSession(null)
        } catch (e) {
          console.error('[AuthProvider] Error clearing session in profile service:', e)
        }
      } finally {
        if (isMountedRef.current) {
          // Only set isLoading to false if there's no session
          // If there is a session, wait for the profile to load via subscription
          if (!sessionFound) {
            setIsLoading(false)
          }
          isInitializingRef.current = false
        }
      }
    }

    fetchSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      // Process auth state changes even during initialization to avoid missing SIGNED_IN
      // events that occur while the initial session fetch is in progress.
      // We rely on the subsequent logic (profile sync + timers) to be idempotent.

      console.log('[AuthProvider] Auth state changed:', { event: _event, session: session ? 'present' : 'null' })
      
      if (!isMountedRef.current) return
      
      setSession(session)
      sessionIdRef.current = session?.user?.id || null
      
      // Reset profile fetch flag for events that trigger profile fetch
      profileFetchCompletedRef.current = false
      
      // Sync session with auth profile service
      try {
        await authProfileService.setSession(session)
        // Mark profile fetch as completed after setSession finishes
        profileFetchCompletedRef.current = true
      } catch (e) {
        console.error('[AuthProvider] Error syncing session in profile service:', e)
        // Mark as completed even on error to avoid blocking
        profileFetchCompletedRef.current = true
      }
      
      // Email verification gate: Check if email is verified
      const verified = Boolean(
        session?.user?.email_confirmed_at ||
        session?.user?.confirmed_at
      )
      setIsEmailVerified(verified)
      
      // Schedule token refresh for new session
      if (_event === 'SIGNED_IN' || _event === 'TOKEN_REFRESHED') {
        if (isMountedRef.current) {
          scheduleTokenRefresh(session)
        }
      } else if (_event === 'SIGNED_OUT') {
        // Clear refresh timer on sign out
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current)
          refreshTimerRef.current = null
        }
      }
      
      // Track authentication events
      if (_event === 'SIGNED_IN' && session?.user) {
        await analyticsService.identifyUser(session.user.id, {
          email: session.user.email,
        })
        await analyticsService.trackEvent('user_logged_in', {
          method: session.user.app_metadata?.provider || 'email',
        })
        Sentry.setUser({
          id: session.user.id,
          email: session.user.email,
        })
      } else if (_event === 'SIGNED_OUT') {
        await analyticsService.trackEvent('user_logged_out')
        await analyticsService.reset()
        Sentry.setUser(null)
      } else if (_event === 'USER_UPDATED' && verified && session?.user) {
        await analyticsService.trackEvent('email_verified', {
          userId: session.user.id,
        })
      } else if (_event === 'TOKEN_REFRESHED') {
        console.log('[AuthProvider] Token refreshed by Supabase')
      }
    })
    console.log('[AuthProvider] mounted')
    
    // Cleanup subscription and timer on unmount
    return () => {
      isMountedRef.current = false
      subscription.unsubscribe()
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
    
  }, [])

  // Subscribe to profile updates from auth profile service
  useEffect(() => {
    const unsubscribe = authProfileService.subscribe((authProfile) => {
      setProfile(authProfile)

      // Only set isLoading to false if:
      // 1. No session exists (immediate subscription callback with null), OR
      // 2. Profile fetch has completed (after setSession finishes)
      const currentSessionId = sessionIdRef.current
      const shouldSetLoadingFalse = !currentSessionId || profileFetchCompletedRef.current

      // Only log profile updates in development and only when the username changes
      try {
        const username = authProfile?.username ?? null
        if (__DEV__ && lastProfileLogRef.current !== username) {
          lastProfileLogRef.current = username
          if (shouldSetLoadingFalse) {
            console.log('[AuthProvider] Profile update received, setting isLoading to false:', {
              hasSession: Boolean(currentSessionId),
              hasProfile: Boolean(authProfile),
              username,
            })
          } else {
            console.log('[AuthProvider] Profile update received but waiting for fetch to complete')
          }
        }
      } catch (e) {
        // swallow logging errors
      }

      if (shouldSetLoadingFalse) {
        setIsLoading(false)
      }
      
      // Email verification gate: Also check profile for email_verified flag (some profile shapes include this field)
      if (authProfile && (('email_verified' in authProfile) || (authProfile as any).email_verified !== undefined)) {
        setIsEmailVerified((authProfile as any).email_verified)
      }
    })

    return unsubscribe
  }, [])

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        profile,
        isLoggedIn: Boolean(session),
        isEmailVerified,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext);