// App-level configuration constants
// Centralize the deep link scheme to avoid mismatches across client and server

// Prefer Expo public env var for bundling to client, then fallback to server env
export const DEEP_LINK_SCHEME = (
  (process.env.EXPO_PUBLIC_DEEP_LINK_SCHEME as string | undefined)
  || (process.env.APP_DEEP_LINK_SCHEME as string | undefined)
  || 'bountyexpo-workspace'
)

export const DEEP_LINK_PREFIX = `${DEEP_LINK_SCHEME}://`

export default {
  DEEP_LINK_SCHEME,
  DEEP_LINK_PREFIX,
}
