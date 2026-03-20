import { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthData = {
  session?: Session | null
  profile?: any | null
  isLoading: boolean
  isLoggedIn: boolean
  isEmailVerified: boolean
  isPasswordRecovery: boolean
  // Indicates that the local session may be stale due to network/token refresh failures
  isAuthStale?: boolean
  // Allows callers to request an immediate token refresh attempt
  attemptRefresh?: () => Promise<void> | void
}

export const AuthContext = createContext<AuthData>({
  session: undefined,
  profile: undefined,
  isLoading: true,
  isLoggedIn: false,
  isEmailVerified: false,
  isPasswordRecovery: false,
})

export const useAuthContext = () => useContext(AuthContext)