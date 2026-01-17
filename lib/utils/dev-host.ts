// Runtime helper to pick a sensible dev API base URL for Expo/React Native
// Works in multiple environments and falls back safely when running in Node tests.

let Constants: any = null
try {
  // expo-constants may not be available in Node test environments
  // so require dynamically and fall back gracefully.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Constants = require('expo-constants')
} catch (e) {
  Constants = null
}

const DEFAULT_DEV_PORT = process.env.DEV_API_PORT || '3001'

function getIpFromDebuggerHost(debuggerHost?: string | null): string | null {
  if (!debuggerHost || typeof debuggerHost !== 'string') return null
  const parts = debuggerHost.split(':')
  return parts.length ? parts[0] : null
}

export function getApiBase(): string {
  // 1) explicit override via env (CI/scripts can set this)
  if (process.env.DEV_API_URL) return process.env.DEV_API_URL

  // 2) try to derive from Expo debuggerHost (LAN mode)
  try {
    const manifest: any = Constants?.manifest || (Constants?.expoConfig || null)
    const debuggerHost = manifest?.debuggerHost || (Constants?.debuggerHost ?? null)
    const ip = getIpFromDebuggerHost(debuggerHost)
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') return `http://${ip}:${DEFAULT_DEV_PORT}`
  } catch (e) {
    // ignore and continue to fallbacks
  }

  // 3) platform specific emulator fallback (react-native Platform if available)
  try {
    // require react-native dynamically so this module is safe to import in Node
    // test environments where react-native isn't installed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RN = require('react-native')
    if (RN && RN.Platform && RN.Platform.OS === 'android') {
      return `http://10.0.2.2:${DEFAULT_DEV_PORT}`
    }
  } catch (e) {
    // ignore - fall back to localhost
  }

  // 4) localhost (iOS simulator / node)
  return `http://localhost:${DEFAULT_DEV_PORT}`
}

export default getApiBase
