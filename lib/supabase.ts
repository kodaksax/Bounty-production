import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import 'react-native-url-polyfill/auto';

// SecureStore adapter for RN environment (persists auth session)
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

// Public (client) env vars MUST be prefixed with EXPO_PUBLIC_ to be inlined by Expo.
// Never expose the service role key here – that belongs ONLY on the backend.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

let supabase: SupabaseClient;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: ExpoSecureStoreAdapter as any,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
} else {
  // Provide a clear developer-facing error without crashing immediately during import.
  const missing = [!supabaseUrl && 'EXPO_PUBLIC_SUPABASE_URL', !supabaseAnonKey && 'EXPO_PUBLIC_SUPABASE_ANON_KEY']
    .filter(Boolean)
    .join(', ');
  const msg = `[supabase] Missing required env var(s): ${missing}.\n` +
    'Add them to a .env file or app.config.(js|ts) extra, e.g.:\n' +
    'EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co\n' +
    'EXPO_PUBLIC_SUPABASE_ANON_KEY=ey... (anon public key)';
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.error(msg);
  } else {
    console.warn(msg);
  }
  // Create a proxy that throws when any property is accessed, so mistakes are obvious.
  supabase = new Proxy({} as any, {
    get() {
      throw new Error('[supabase] Not configured – supply EXPO_PUBLIC_SUPABASE_URL & EXPO_PUBLIC_SUPABASE_ANON_KEY');
    },
  });
}

export { supabase };
