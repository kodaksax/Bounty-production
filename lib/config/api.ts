import Constants from 'expo-constants';
import getApiBaseFallback from 'lib/utils/dev-host';
import { getReachableApiBaseUrl } from 'lib/utils/network';

/** Read a string key from Constants.expoConfig.extra (set by app.config.js). */
function fromExtra(key: string): string {
  try {
    const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
    const v = extra?.[key];
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

// Supabase Edge Functions base URL.
// Prefer EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL when explicitly set; otherwise
// derive from EXPO_PUBLIC_SUPABASE_URL so wallet/payments route to Edge
// Functions automatically without extra configuration.
// Format: https://<project-ref>.supabase.co/functions/v1  (no trailing slash)
//
// Resolution order: process.env FIRST, then Constants.expoConfig.extra.
// This MUST match lib/config.ts's resolution order (which configures the
// Supabase auth client) to guarantee the Edge Function URL always targets
// the same Supabase project as the auth session. A mismatch causes 401
// errors because the Supabase gateway rejects JWTs issued by a different project.
//
// NOTE: In earlier versions expoConfig.extra was checked first to handle
// .env file shadowing in dev, but this caused production 401s when an OTA
// update or env-file mismatch made the two sources disagree. Matching the
// resolution order of lib/config.ts is the correct fix — both modules now
// agree on which Supabase project to use.
const explicitFunctionsUrl = (process.env.EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL as string | undefined)?.trim()
  || fromExtra('EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL')
  || ''
const supabaseBaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined)?.trim()
  || fromExtra('EXPO_PUBLIC_SUPABASE_URL')
  || ''
const derivedFunctionsUrl = supabaseBaseUrl ? `${supabaseBaseUrl.replace(/\/+$/, '')}/functions/v1` : ''
const supabaseFunctionsUrl = (explicitFunctionsUrl || derivedFunctionsUrl).replace(/\/+$/, '')

// ── Mismatch detection ─────────────────────────────────────────────────────
// Log a warning if expoConfig.extra and process.env disagree on the Supabase
// URL. This is the root cause of production 401 errors when process.env
// (used by lib/config.ts for auth) points to project A but expoConfig.extra
// (previously used here) points to project B.
try {
  const envUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined)?.trim() || ''
  const extraUrl = fromExtra('EXPO_PUBLIC_SUPABASE_URL') || ''
  if (envUrl && extraUrl && envUrl !== extraUrl) {
    // eslint-disable-next-line no-console
    console.warn(
      `[API Config] ⚠️ Supabase URL mismatch detected: process.env="${envUrl.substring(0, 50)}" vs expoConfig.extra="${extraUrl.substring(0, 50)}". ` +
      `Using process.env to match auth client. This may indicate stale OTA config or env file conflict.`
    )
  }
} catch { /* ignore diagnostic errors */ }

// Preferred environment variables (Expo public envs are bundled to client)
const preferred = (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined)
  || (process.env.EXPO_PUBLIC_API_URL as string | undefined)
  || (process.env.API_BASE_URL as string | undefined)
  || ''

/**
 * Returns a runtime-resolved API base URL appropriate for the current device.
 * Prefers EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL when explicitly set.
 * Falls back to deriving the Edge Functions URL from EXPO_PUBLIC_SUPABASE_URL
 * (i.e. setting EXPO_PUBLIC_SUPABASE_URL alone is sufficient to route wallet
 * and payment calls to Supabase Edge Functions without any extra config).
 * When neither Supabase variable is set, falls back to the legacy Node server
 * URL helpers.
 */
export function getApiBaseUrl(fallbackPort = 3001): string {
  // Prefer Supabase Edge Functions when configured — this is the primary backend.
  // Explicit EXPO_PUBLIC_API_BASE_URL / EXPO_PUBLIC_API_URL are only consulted as
  // a fallback when Supabase Functions are not configured (e.g. local dev without Supabase).
  if (supabaseFunctionsUrl) return supabaseFunctionsUrl

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
