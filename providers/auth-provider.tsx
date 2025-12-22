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
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null)

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

    const expiresAt = session.expires_at * 1000 // Convert to milliseconds
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

  /**
   * Manually refresh the session token
   */
  const refreshTokenNow = async () => {
    try {
      console.log('[AuthProvider] Attempting to refresh token...')
      const { data, error } = await supabase.auth.refreshSession()
      
      if (error) {
        console.error('[AuthProvider] Token refresh failed:', error)
        // On refresh failure, clear session and let user re-authenticate
        setSession(null)
        await authProfileService.setSession(null)
        return
      }

      if (data.session) {
        console.log('[AuthProvider] Token refreshed successfully')
        setSession(data.session)
        await authProfileService.setSession(data.session)
        
        // Schedule next refresh
        scheduleTokenRefresh(data.session)
      } else {
        console.warn('[AuthProvider] Token refresh returned no session')
        setSession(null)
        await authProfileService.setSession(null)
      }
    } catch (error) {
      console.error('[AuthProvider] Unexpected error refreshing token:', error)
      setSession(null)
      await authProfileService.setSession(null)
    }
  }

  // Fetch the session once, and subscribe to auth state changes
  useEffect(() => {
    const fetchSession = async () => {
      setIsLoading(true)

      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession()

        if (error) {
          console.error('[AuthProvider] Error fetching session:', error)
          setSession(null)
          await authProfileService.setSession(null)
        } else {
          console.log('[AuthProvider] Session loaded:', session ? 'authenticated' : 'not authenticated')
          setSession(session)
          
          // Sync session with auth profile service
          await authProfileService.setSession(session)
          
          // Email verification gate: Check if email is verified
          // Priority: session.user?.email_confirmed_at > profile.email_verified > false
          const verified = Boolean(
            session?.user?.email_confirmed_at ||
            session?.user?.confirmed_at
          )
          setIsEmailVerified(verified)

          // Schedule automatic token refresh
          if (session) {
            scheduleTokenRefresh(session)
          }
        }
      } catch (error) {
        console.error('[AuthProvider] Unexpected error fetching session:', error)
        setSession(null)
        await authProfileService.setSession(null)
      } finally {
        setIsLoading(false)
      }
    }

    fetchSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('[AuthProvider] Auth state changed:', { event: _event, session: session ? 'present' : 'null' })
      setSession(session)
      
      // Sync session with auth profile service
      await authProfileService.setSession(session)
      
      // Email verification gate: Check if email is verified
      const verified = Boolean(
        session?.user?.email_confirmed_at ||
        session?.user?.confirmed_at
      )
      setIsEmailVerified(verified)
      
      // Schedule token refresh for new session
      if (_event === 'SIGNED_IN' || _event === 'TOKEN_REFRESHED') {
        scheduleTokenRefresh(session)
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
      setIsLoading(false)
      
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