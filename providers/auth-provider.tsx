import { AuthContext } from 'hooks/use-auth-context'
import { supabase } from 'lib/supabase'
import type { Session } from '@supabase/supabase-js'
import { PropsWithChildren, use, useContext, useEffect, useState } from 'react'
import { authProfileService } from '../lib/services/auth-profile-service'

type AuthData = {
  session: Session | null | undefined
  isLoading: boolean
  profile: any
  isLoggedIn: boolean
}

export default function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | undefined | null>()
  const [profile, setProfile] = useState<any>()
  const [isLoading, setIsLoading] = useState<boolean>(true)

  // Fetch the session once, and subscribe to auth state changes
  useEffect(() => {
    const fetchSession = async () => {
      setIsLoading(true)

      const {
        data: { session },
        error,
      } = await supabase.auth.getSession()

      if (error) {
        console.error('Error fetching session:', error)
      }

      setSession(session)
      
      // Sync session with auth profile service
      await authProfileService.setSession(session)
      
      setIsLoading(false)
    }

    fetchSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('Auth state changed:', { event: _event, session })
      setSession(session)
      
      // Sync session with auth profile service
      await authProfileService.setSession(session)
    })
    console.log('AuthProvider mounted')
    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe()
    }
    
  }, [])

  // Subscribe to profile updates from auth profile service
  useEffect(() => {
    const unsubscribe = authProfileService.subscribe((authProfile) => {
      setProfile(authProfile)
      setIsLoading(false)
    })

    return unsubscribe
  }, [])

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        profile,
        isLoggedIn: session != undefined,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext);