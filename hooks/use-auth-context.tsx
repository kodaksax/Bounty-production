import { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthData = {
  session?: Session | null
  profile?: any | null
  isLoading: boolean
  isLoggedIn: boolean
  isEmailVerified: boolean
}

export const AuthContext = createContext<AuthData>({
  session: undefined,
  profile: undefined,
  isLoading: true,
  isLoggedIn: false,
  isEmailVerified: false,
})

export const useAuthContext = () => useContext(AuthContext)