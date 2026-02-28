import { createClient, SupabaseClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';
import { createAuthSessionStorageAdapter } from './auth-session-storage';

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
      storage: createAuthSessionStorageAdapter(),
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
  console.error(msg)

  // Create a safe, chainable stub that won't throw when modules import `supabase`.
  // This avoids uncaught exceptions during app startup if env variables are missing.
  const noopResult = { data: null, error: { message: msg } }

  const makeChainable = () => {
    const terminal: any = {
      select: async () => noopResult,
      insert: async () => noopResult,
      update: async () => noopResult,
      delete: async () => noopResult,
      single: async () => noopResult,
      rpc: async () => noopResult,
      then: undefined,
    }

    const handler: ProxyHandler<any> = {
      get(_target, prop) {
        if (prop in terminal) return (terminal as any)[prop]
        // for chaining, return a callable that itself is chainable
        return (..._args: any[]) => chainable
      },
      apply(_target, _thisArg, _args) {
        return Promise.resolve(noopResult)
      },
    }

    const chainable: any = new Proxy(() => Promise.resolve(noopResult), handler)
    Object.assign(chainable, terminal)
    return chainable
  }

  const chain = makeChainable()

  supabase = {
    from: (..._args: any[]) => chain,
    rpc: async () => noopResult,
    auth: {
      onAuthStateChange: (_cb: any) => ({ data: null, error: null }),
      getUser: async () => ({ data: null, error: { message: msg } }),
      signInWithPassword: async () => ({ data: null, error: { message: msg } }),
      signOut: async () => ({ data: null, error: { message: msg } }),
    },
    __unsafe__: chain,
  } as unknown as SupabaseClient
}

export { supabase };

