/**
 * Auth Index Route — Deep Link Entry Point
 *
 * Supabase falls back to the project's Site URL whenever a link's `redirect_to`
 * is absent or not allowlisted. In production that Site URL is
 * `bountyexpo-workspace://auth` — the bare `/auth` path — so recovery and magic
 * links can legitimately land here rather than on `/auth/callback`. Verified
 * against production: an unlisted `redirect_to` redirects to
 * `bountyexpo-workspace://auth#error=...`, and a link minted with no
 * `redirect_to` at all redirects to `bountyexpo-workspace://auth#access_token=…`.
 *
 * This route therefore renders the auth-callback handler directly instead of
 * forwarding to it. It used to rebuild a query string from
 * `useLocalSearchParams()` and `router.replace` into `/auth/callback`, which
 * silently destroyed the credentials on native: expo-router drops the URL
 * fragment from deep links before the params are populated, and Supabase puts
 * the tokens in the fragment. Rendering the handler in place lets it read the
 * untouched URL from `expo-linking` itself, so `/auth` and `/auth/callback`
 * behave identically no matter which one the link points at.
 */

import AuthCallbackScreen from './callback';

export default function AuthIndex() {
  return <AuthCallbackScreen />;
}
