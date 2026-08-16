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
  // Set the instant a signed-in/restored session's profile turns out to be
  // suspended or banned. The provider force-signs-out as soon as this is
  // set; the root auth gate (app/index.tsx) routes to the matching
  // app/auth/account-banned.tsx / account-suspended.tsx screen instead of
  // the normal sign-in/app flow. See providers/auth-provider.tsx and
  // 20260726000000_enforce_account_status.sql.
  accountBlockedReason?: 'banned' | 'suspended' | null
  // Called by the banned/suspended screens when the user acknowledges the
  // message (e.g. taps "Back to Sign In"), clearing the block so the root
  // auth gate falls through to the normal unauthenticated flow.
  clearAccountBlockedReason?: () => void
  // Set when session restore failed because lib/config/env-guard.ts refused
  // to connect (the build's immutable channel doesn't match the Supabase
  // project the resolved EXPO_PUBLIC_SUPABASE_URL points at — e.g. a
  // production binary that received an OTA bundle built for the wrong
  // environment). This is NOT "signed out": the persisted session in
  // SecureStore is left untouched. The root auth gate (app/index.tsx) must
  // route to app/auth/environment-error.tsx instead of the sign-in screen,
  // otherwise a user with a perfectly valid session is misled into thinking
  // they were logged out and re-enters credentials against a broken client.
  environmentError?: boolean
}

export const AuthContext = createContext<AuthData>({
  session: undefined,
  profile: undefined,
  isLoading: true,
  isLoggedIn: false,
  isEmailVerified: false,
  isPasswordRecovery: false,
  accountBlockedReason: null,
  clearAccountBlockedReason: () => {},
  environmentError: false,
})

export const useAuthContext = () => useContext(AuthContext)