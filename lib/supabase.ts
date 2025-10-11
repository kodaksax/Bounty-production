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

const ExpoSecureStoreAdapter: StorageAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value, SECURE_OPTS),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

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
  })
} else {
  const reasons: string[] = []
  if (!supabaseUrl) reasons.push('EXPO_PUBLIC_SUPABASE_URL missing')
  if (!supabaseAnonKey) reasons.push('EXPO_PUBLIC_SUPABASE_ANON_KEY missing')
  if (mismatch) reasons.push(`Project ref mismatch (url=${urlRef}, key=${keyRef})`)
  const msg = `[supabase] Not configured: ${reasons.join('; ')}`
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.error(msg)
  else console.warn(msg)
  supabase = new Proxy({} as any, {
    get() {
      throw new Error(msg)
    },
  })
}

export { supabase };

