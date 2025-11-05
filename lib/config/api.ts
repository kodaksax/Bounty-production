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
  return getReachableApiBaseUrl(preferred, fallbackPort)
}

// Convenience constant for modules that prefer a simple string import
export const API_BASE_URL = getApiBaseUrl()
// Log the resolved API base URL at module load to help diagnose device network issues
try {
  // eslint-disable-next-line no-console
  console.log('[client-config] Resolved API_BASE_URL ->', API_BASE_URL)
} catch (e) {}
