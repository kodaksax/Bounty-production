/**
 * Frontend configuration wrapper
 * Centralizes access to EXPO_PUBLIC_* env vars for the app runtime.
 */
function sanitizeEnv(value?: string | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  let v = String(value).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v === '' ? undefined : v;
}

export const config = {
  supabase: {
    // Public env vars in Expo must be EXPO_PUBLIC_ prefixed. Fall back to SUPABASE_* if missing.
    url: sanitizeEnv(process.env.EXPO_PUBLIC_SUPABASE_URL) || sanitizeEnv(process.env.SUPABASE_URL) || '',
    anonKey: sanitizeEnv(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) || sanitizeEnv(process.env.SUPABASE_ANON_KEY) || '',
  },

  api: {
    baseUrl: sanitizeEnv(process.env.EXPO_PUBLIC_API_BASE_URL) || sanitizeEnv(process.env.API_BASE_URL) || '',
  },
} as const;

export default config;
