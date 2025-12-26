import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

// SecureStore adapter for RN environment (persists auth session)
type StorageAdapter = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};
// On iOS, default SecureStore accessibility (WHEN_UNLOCKED) can fail when the app is in background
// and Supabase tries to auto-refresh ("User interaction is not allowed"). Persist items with
// AFTER_FIRST_UNLOCK so background reads work after the device has been unlocked once post-boot.
const SECURE_OPTS: SecureStore.SecureStoreOptions | undefined =
  Platform.OS === 'ios' ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } : undefined;

// Chunking adapter: expo-secure-store may warn/fail when storing values larger
// than ~2048 bytes. Supabase stores a session object that can exceed this size
// (user metadata). To avoid failures, split large values into smaller chunks.
const CHUNK_SIZE = 1900 // safe chunk size below 2048
const CHUNK_META_SUFFIX = '__chunkCount'

const ExpoSecureStoreAdapter: StorageAdapter = {
  getItem: async (key: string) => {
    try {
      const val = await SecureStore.getItemAsync(key)
      // If marker value indicates chunked payload, reassemble
      if (val === '__chunked__') {
        const countStr = await SecureStore.getItemAsync(key + CHUNK_META_SUFFIX)
        const count = parseInt(countStr || '0', 10)
        let out = ''
        for (let i = 0; i < count; i++) {
          const part = await SecureStore.getItemAsync(`${key}__${i}`)
          out += part ?? ''
        }
        return out
      }
      return val
    } catch (e) {
      // Bubble up the error to caller
      throw e
    }
  },

  setItem: async (key: string, value: string) => {
    try {
      if (typeof value !== 'string') value = String(value)

      // If value fits in one item, store directly and clean up any old chunks
      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value, SECURE_OPTS)

        // Remove previously stored chunks (if any)
        const prevCountStr = await SecureStore.getItemAsync(key + CHUNK_META_SUFFIX)
        if (prevCountStr) {
          const prevCount = parseInt(prevCountStr, 10) || 0
          for (let i = 0; i < prevCount; i++) {
            await SecureStore.deleteItemAsync(`${key}__${i}`)
          }
          await SecureStore.deleteItemAsync(key + CHUNK_META_SUFFIX)
        }

        return
      }

      // Chunk the value
      const chunks = Math.ceil(value.length / CHUNK_SIZE)
      for (let i = 0; i < chunks; i++) {
        const part = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
        await SecureStore.setItemAsync(`${key}__${i}`, part, SECURE_OPTS)
      }

      // Write marker and metadata
      await SecureStore.setItemAsync(key, '__chunked__', SECURE_OPTS)
      await SecureStore.setItemAsync(key + CHUNK_META_SUFFIX, String(chunks), SECURE_OPTS)
    } catch (e) {
      throw e
    }
  },

  removeItem: async (key: string) => {
    try {
      const val = await SecureStore.getItemAsync(key)
      if (val === '__chunked__') {
        const countStr = await SecureStore.getItemAsync(key + CHUNK_META_SUFFIX)
        const count = parseInt(countStr || '0', 10)
        for (let i = 0; i < count; i++) {
          await SecureStore.deleteItemAsync(`${key}__${i}`)
        }
        await SecureStore.deleteItemAsync(key + CHUNK_META_SUFFIX)
        await SecureStore.deleteItemAsync(key)
      } else {
        await SecureStore.deleteItemAsync(key)
      }
    } catch (e) {
      throw e
    }
  },
}

// Public (client) env vars MUST be prefixed with EXPO_PUBLIC_ to be inlined by Expo.
// Never expose the service role key here – that belongs ONLY on the backend.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim()

// Helper: extract project ref from URL and anon key (JWT)
const projectRefFromUrl = (url?: string) => {
  try {
    if (!url) return undefined
    const u = new URL(url)
    const [sub] = u.hostname.split('.')
    return sub // <ref>.supabase.co
  } catch { return undefined }
}
const projectRefFromAnonKey = (jwt?: string) => {
  try {
    if (!jwt) return undefined
    const [, payload] = jwt.split('.')
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    return json?.ref as string | undefined
  } catch { return undefined }
}

const urlRef = projectRefFromUrl(supabaseUrl)
const keyRef = projectRefFromAnonKey(supabaseAnonKey)
const hasBasics = Boolean(supabaseUrl && supabaseAnonKey)
const mismatch = Boolean(urlRef && keyRef && urlRef !== keyRef)

// Export diagnostic info for UI/debug (does not expose secrets)
export const supabaseEnv = {
  hasUrl: Boolean(supabaseUrl),
  hasKey: Boolean(supabaseAnonKey),
  urlRef,
  keyRef,
  mismatch,
}

// Export a simple flag so UI can disable auth actions when not configured
export const isSupabaseConfigured = hasBasics && !mismatch

let supabase: SupabaseClient

if (isSupabaseConfigured) {
  supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: {
      // Add custom fetch with timeout to prevent hanging requests
      // This applies to all Supabase operations (auth, database, storage, etc.)
      fetch: (url, options = {}) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30000) // 30s global timeout
        
        // If options already has a signal, we need to handle both signals
        const originalSignal = options.signal
        let combinedSignal = controller.signal
        
        // If there's an existing signal, listen to both
        if (originalSignal) {
          // Create a new controller that aborts when either signal aborts
          const combinedController = new AbortController()
          const abortBoth = () => combinedController.abort()
          
          originalSignal.addEventListener('abort', abortBoth, { once: true })
          controller.signal.addEventListener('abort', abortBoth, { once: true })
          
          combinedSignal = combinedController.signal
        }
        
        return fetch(url, {
          ...options,
          signal: combinedSignal,
        }).finally(() => clearTimeout(timeoutId))
      },
    },
  })
} else {
  const reasons: string[] = []
  if (!supabaseUrl) reasons.push('EXPO_PUBLIC_SUPABASE_URL missing')
  if (!supabaseAnonKey) reasons.push('EXPO_PUBLIC_SUPABASE_ANON_KEY missing')
  if (mismatch) reasons.push(`Project ref mismatch (url=${urlRef}, key=${keyRef})`)
  const msg = `[supabase] Not configured: ${reasons.join('; ')}`
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.error(msg)
  else console.error(msg)
  supabase = new Proxy({} as any, {
    get() {
      throw new Error(msg)
    },
  })
}

export { supabase };

