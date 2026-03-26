/**
 * Frontend configuration wrapper
 * Centralizes access to EXPO_PUBLIC_* env vars for the app runtime.
 *
 * Resolution order (each key):
 *   1. EXPO_PUBLIC_<KEY>  — preferred; baked into the bundle by Expo/EAS.
 *   2. <KEY>              — fallback for local dev or server-side usage.
 *
 * The `diagnostics` export records which variant was resolved for each key
 * so operators can quickly see which fallback is active without logging secret values.
 */
function sanitizeEnv(value?: string | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  let v = String(value).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v === '' ? undefined : v;
}

type FallbackSource = 'EXPO_PUBLIC' | 'FALLBACK' | null;

function resolveWithFallback(
  primaryKey: string,
  fallbackKey: string
): { value: string; source: FallbackSource } {
  const primary = sanitizeEnv(process.env[primaryKey]);
  if (primary) return { value: primary, source: 'EXPO_PUBLIC' };
  const fallback = sanitizeEnv(process.env[fallbackKey]);
  if (fallback) return { value: fallback, source: 'FALLBACK' };
  return { value: '', source: null };
}

const supabaseUrl   = resolveWithFallback('EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
const supabaseAnon  = resolveWithFallback('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
const apiBaseUrl    = resolveWithFallback('EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_API_BASE_URL');

/**
 * Safe diagnostics — records only which source was used per key.
 * Never contains actual secret values; safe to log in dev builds.
 */
export const configDiagnostics = {
  supabaseUrlSource:    supabaseUrl.source,
  supabaseAnonSource:   supabaseAnon.source,
  apiBaseUrlSource:     apiBaseUrl.source,
  /** Truncated URL prefix (first 40 chars) — non-secret, useful for debugging wrong endpoint. */
  supabaseUrlPrefix:    supabaseUrl.value ? supabaseUrl.value.substring(0, 40) : '(not set)',
  apiBaseUrlPrefix:     apiBaseUrl.value  ? apiBaseUrl.value.substring(0, 40)  : '(not set)',
};

// Dev-only safe diagnostic log — never runs in production builds.
if (typeof __DEV__ !== 'undefined' && __DEV__) {
  // eslint-disable-next-line no-console
  console.debug('[config] env diagnostics', configDiagnostics);
}

export const config = {
  supabase: {
    // Public env vars in Expo must be EXPO_PUBLIC_ prefixed. Fall back to SUPABASE_* if missing.
    url:     supabaseUrl.value,
    anonKey: supabaseAnon.value,
  },

  api: {
    baseUrl: apiBaseUrl.value,
  },
} as const;

export default config;
