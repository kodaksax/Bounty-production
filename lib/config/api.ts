import getApiBaseFallback from 'lib/utils/dev-host'
import { getReachableApiBaseUrl } from 'lib/utils/network'

// Preferred environment variables (Expo public envs are bundled to client)
const preferred = (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined)
  || (process.env.EXPO_PUBLIC_API_URL as string | undefined)
  || (process.env.API_BASE_URL as string | undefined)
  || ''

/**
 * Returns a runtime-resolved API base URL appropriate for the current device.
 * Uses the network helper to map localhost to the dev machine's LAN address when needed.
 */
export function getApiBaseUrl(fallbackPort = 3001): string {
  // Resolve using network helper first
  const resolved = getReachableApiBaseUrl(preferred, fallbackPort)

  // If resolution yielded a localhost address (which mobile devices cannot reach)
  // prefer the dev-host runtime helper which attempts to map to the dev machine
  // or emulator-specific loopback (10.0.2.2) for Android.
  try {
    const isLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1)[:/]/i.test(resolved)
    if (isLocal) {
      const fallback = getApiBaseFallback()
      if (fallback) return fallback
    }
  } catch {
    // ignore and fall back to resolved value
  }

  return resolved
}

// Convenience constant for modules that prefer a simple string import
export const API_BASE_URL = getApiBaseUrl()
// Log the resolved API base URL at module load to help diagnose device network issues
try {
  // eslint-disable-next-line no-console
  if (__DEV__) {
    console.log('[API Config] Resolved API_BASE_URL:', API_BASE_URL)
  }
} catch {}
