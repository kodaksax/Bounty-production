import { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthData = {
  session?: Session | null
  profile?: any | null
  isLoading: boolean
  isLoggedIn: boolean
  isEmailVerified: boolean
  isPasswordRecovery: boolean
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