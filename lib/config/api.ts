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
// Priority: Constants.expoConfig.extra (set by app.config.js at server-start time
// using the correct env file with override:true) BEFORE Metro-baked process.env.
// This prevents a base .env file's stale values from shadowing .env.staging when
// running `expo start` with APP_ENV=staging.
const explicitFunctionsUrl = fromExtra('EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL')
  || (process.env.EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL as string | undefined)?.trim()
  || ''
const supabaseBaseUrl = fromExtra('EXPO_PUBLIC_SUPABASE_URL')
  || (process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined)?.trim()
  || ''
const derivedFunctionsUrl = supabaseBaseUrl ? `${supabaseBaseUrl.replace(/\/+$/, '')}/functions/v1` : ''
const supabaseFunctionsUrl = (explicitFunctionsUrl || derivedFunctionsUrl).replace(/\/+$/, '')

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

/**
 * Returns the base URL that must be used for all financial routes
 * (/wallet/* and /payments/*).
 *
 * Unlike `getApiBaseUrl()`, this function **always** prefers the Supabase
 * Edge Functions URL and never falls back to the legacy Express/Fastify servers
 * for financial routes. This guarantees consistent data-source selection and
 * fee-schedule enforcement regardless of other env-var configuration.
 *
 * When neither Supabase variable is configured (e.g. local dev without Supabase)
 * it falls back to the generic API base URL so developers can still test locally.
 */
export function getFinancialApiUrl(): string {
  if (supabaseFunctionsUrl) return supabaseFunctionsUrl

  // Warn in dev: financial routes should always target Edge Functions in
  // staging/production to avoid silent dual-surface routing.
  try {
    // eslint-disable-next-line no-console
    if (__DEV__) {
      console.warn(
        '[API Config] getFinancialApiUrl: EXPO_PUBLIC_SUPABASE_URL / ' +
        'EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL is not set. Financial routes ' +
        'will fall back to the legacy API server. Set one of these variables ' +
        'to route /wallet/* and /payments/* to Supabase Edge Functions.'
      )
    }
  } catch {}

  // Local-dev fallback only — not used in staging/production.
  return getApiBaseUrl()
}

// Pre-resolved constant for modules that prefer a simple import.
// Always the Edge Functions URL when Supabase is configured.
export const FINANCIAL_API_BASE_URL = getFinancialApiUrl()
