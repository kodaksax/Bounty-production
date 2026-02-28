import { makeRedirectUri } from 'expo-auth-session'
import { Platform } from 'react-native'

/**
 * Centralized helper to return the OAuth redirect URI used by the app.
 *
 * We keep the scheme/value here so it doesn't drift across the codebase.
 * Some versions of `expo-auth-session` have a narrower typed options object
 * that may not include `useProxy`. To avoid scattering `any` casts, we
 * confine a single, documented cast to this file so callers remain fully typed.
 */
export function getAuthRedirectUri(): string {
  const nativeScheme = 'bountyexpo://oauth'
  const useProxy = !!__DEV__ && Platform.OS !== 'web'

  // Confine the `any` usage to this helper. This keeps callers type-safe
  // and centralizes the place we opt into the runtime-only `useProxy` option.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const caller: any = makeRedirectUri
  return caller({ useProxy, native: nativeScheme })
}

export default getAuthRedirectUri
