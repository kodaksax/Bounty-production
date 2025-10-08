import Constants from 'expo-constants'
import { NativeModules, Platform } from 'react-native'

function parseHostFromScriptURL(): string | null {
  try {
    // e.g. http://192.168.1.5:19000/index.bundle?platform=ios&dev=true
    const scriptURL: string | undefined = (NativeModules as any)?.SourceCode?.scriptURL
    if (!scriptURL) return null
    const url = new URL(scriptURL)
    return url.hostname || null
  } catch {
    return null
  }
}

function parseHostFromExpoEnv(): string | null {
  try {
    const host = process.env.EXPO_DEV_SERVER_HOST || process.env.EXPO_PACKAGER_HOSTNAME
    if (!host) return null
    // host may include :port
    return host.split(':')[0]
  } catch {
    return null
  }
}

function parseHostFromExpoGo(): string | null {
  try {
    // SDK 49+: Constants.expoGoConfig?.hostUri e.g. "192.168.1.5:8081"
    const expoHostUri: string | undefined = (Constants as any)?.expoGoConfig?.hostUri
    if (expoHostUri && expoHostUri.includes(':')) {
      return expoHostUri.split(':')[0]
    }
    // Older manifest/debuggerHost fallback e.g. "192.168.1.5:19000"
    const dbg: string | undefined = (Constants as any)?.manifest?.debuggerHost
    if (dbg && dbg.includes(':')) {
      return dbg.split(':')[0]
    }
    return null
  } catch {
    return null
  }
}

export function getReachableApiBaseUrl(preferred?: string, fallbackPort = 3001): string {
  const pref = (preferred || '').trim()
  if (!pref) {
    // no preferred; try to infer a LAN host in dev
    const host = parseHostFromScriptURL() || parseHostFromExpoGo() || parseHostFromExpoEnv() || 'localhost'
    return `http://${host}:${fallbackPort}`
  }

  // If preferred already points to a non-localhost, use it
  const isLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1)[:/]/i.test(pref)
  if (!isLocal) return pref

  // Native platforms can't reach localhost on the dev machine; map to LAN IP
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    const host = parseHostFromScriptURL() || parseHostFromExpoGo() || parseHostFromExpoEnv()
    if (host) {
      try {
        const url = new URL(pref)
        const port = url.port || String(fallbackPort)
        return `${url.protocol}//${host}:${port}`
      } catch {
        return `http://${host}:${fallbackPort}`
      }
    }
  }

  return pref
}
