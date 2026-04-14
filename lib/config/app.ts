// App-level configuration constants
// Centralize the deep link scheme to avoid mismatches across client and server

// Prefer Expo public env var for bundling to client, then fallback to server env
export const DEEP_LINK_SCHEME = (
  (process.env.EXPO_PUBLIC_DEEP_LINK_SCHEME as string | undefined)
  || (process.env.APP_DEEP_LINK_SCHEME as string | undefined)
  || 'bountyexpo-workspace'
)

export const DEEP_LINK_PREFIX = `${DEEP_LINK_SCHEME}://`

// Stripe Connect onboarding return/refresh URLs.
// Must be HTTPS – Stripe rejects custom-scheme URLs for account links.
// These match the iOS associatedDomains and the Android intent filter in app.json.
export const CONNECT_RETURN_URL = 'https://bountyfinder.app/wallet/connect/return'
export const CONNECT_REFRESH_URL = 'https://bountyfinder.app/wallet/connect/refresh'

export default {
  DEEP_LINK_SCHEME,
  DEEP_LINK_PREFIX,
  CONNECT_RETURN_URL,
  CONNECT_REFRESH_URL,
}
