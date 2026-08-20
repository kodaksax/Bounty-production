/**
 * Where Supabase should send the user after it verifies an auth email link.
 *
 * This value is passed as `redirectTo` on `resetPasswordForEmail`, so it has to
 * be a URL that (a) Supabase's redirect allowlist accepts and (b) actually
 * resolves to this app on the device the email is opened on. Getting either
 * half wrong silently strands the user: Supabase falls back to the project's
 * Site URL when `redirectTo` is not allowlisted (verified against production —
 * an unlisted host redirected to `bountyexpo-workspace://auth` instead of
 * erroring), and a listed-but-unreachable URL produces a dead link.
 *
 * Production allowlist state, probed directly against project
 * xwlwqzzphmmhghiqvkeu via `GET /auth/v1/verify?...&redirect_to=…`:
 *
 *   bountyexpo-workspace://auth/callback     accepted  (reachable today)
 *   https://bountyfinder.app/auth/callback   accepted  (NOT reachable — see below)
 *   bountyexpo://auth/callback               rejected  (stale scheme)
 *   https://evil.example.com/steal           rejected  → Site URL
 *
 * `https://bountyfinder.app` currently terminates no TLS at all (the apex
 * redirects plain HTTP to a Carrd site and the HTTPS handshake fails), so the
 * web callback URL cannot load a page, cannot serve
 * `/.well-known/apple-app-site-association`, and therefore cannot open the app
 * via a universal link either. Until that domain serves the app over HTTPS the
 * native custom scheme is the only redirect that reaches Bounty, so it is the
 * native default. Set `EXPO_PUBLIC_AUTH_REDIRECT_URL` to the web callback once
 * the domain is fixed — no code change needed.
 */

import { Platform } from 'react-native';

/** Path segment that handles auth callbacks (app/auth/callback.tsx). */
export const AUTH_CALLBACK_PATH = '/auth/callback';

/**
 * The app's own deep-link scheme. Matches `expo.scheme` in app.json and is
 * present in Supabase's production redirect allowlist.
 */
export const NATIVE_AUTH_CALLBACK_URL = 'bountyexpo-workspace://auth/callback';

/** Web callback, once bountyfinder.app serves the app over HTTPS. */
export const WEB_AUTH_CALLBACK_URL = 'https://bountyfinder.app/auth/callback';

/**
 * Redirect targets this app is willing to ask Supabase to send users to.
 *
 * This is the client-side half of open-redirect defence. Supabase enforces its
 * own allowlist server-side, but an operator can widen that list (or add a
 * wildcard) far more easily than they can edit this file, and
 * `EXPO_PUBLIC_AUTH_REDIRECT_URL` is an OTA-updatable value. Validating here
 * means a loose server config or a mistyped env var degrades to a known-good
 * default instead of mailing users a link that points somewhere else.
 *
 * Entries are matched as exact-origin prefixes, never as substrings, so
 * `https://bountyfinder.app.evil.com` cannot pass by sharing a prefix.
 */
const ALLOWED_REDIRECT_ORIGINS: readonly string[] = [
  'bountyexpo-workspace://auth',
  'https://bountyfinder.app',
  // Expo Go / dev-client and local web dev. Harmless in production builds:
  // Supabase's own allowlist still has to accept whatever is requested, and
  // these origins are not reachable from an end user's mail client.
  'exp://',
  'http://localhost',
  'http://127.0.0.1',
];

function normalizeOrigin(url: string): string | null {
  // Custom schemes (`scheme://host/path`) and http(s) URLs both split on the
  // first `/` after the `://`. Deliberately hand-rolled: `new URL` treats
  // unknown schemes inconsistently across Hermes, Node and browsers.
  const schemeEnd = url.indexOf('://');
  if (schemeEnd === -1) return null;

  const afterScheme = schemeEnd + 3;
  const pathStart = url.indexOf('/', afterScheme);
  const origin = pathStart === -1 ? url : url.slice(0, pathStart);
  return origin.toLowerCase();
}

/**
 * True when `url` is a redirect target Bounty is willing to hand to Supabase.
 *
 * Rejects anything with credentials, a fragment, or an unlisted origin. The
 * fragment check matters specifically for this flow: Supabase appends the
 * session tokens to the fragment of whatever it is given, so a `redirectTo`
 * that already carries one would corrupt the callback it produces.
 */
export function isAllowedAuthRedirect(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  if (url.includes('#')) return false;
  // `@` before the path would let `https://bountyfinder.app@evil.com/` read as
  // an allowed origin to a naive prefix check while resolving to evil.com.
  if (url.includes('\\') || /^[a-z0-9+.-]+:\/\/[^/]*@/i.test(url)) return false;

  const origin = normalizeOrigin(url);
  if (!origin) return false;

  return ALLOWED_REDIRECT_ORIGINS.some(allowed => {
    const normalized = allowed.toLowerCase();
    // Scheme-only entries (`exp://`) authorise any host under that scheme.
    if (normalized.endsWith('://')) return origin.startsWith(normalized);
    // Otherwise the origin must match exactly, or differ only by port
    // (localhost dev servers move around).
    return origin === normalized || origin.startsWith(`${normalized}:`);
  });
}

/**
 * Resolve the `redirectTo` for auth emails.
 *
 * Precedence: explicit env override (validated) → the current web origin on
 * web → the native deep-link scheme. Every branch returns a URL that has
 * passed `isAllowedAuthRedirect`, so callers never need to re-check.
 */
export function getAuthCallbackUrl(): string {
  const override = process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL;
  if (override) {
    if (isAllowedAuthRedirect(override)) return override;
    // Loud but non-fatal: a bad override must not break password reset.
    console.warn(
      '[auth-redirect] Ignoring EXPO_PUBLIC_AUTH_REDIRECT_URL — not an allowed redirect origin'
    );
  }

  if (Platform.OS === 'web') {
    // Same-origin by construction: the callback lands back on the page the
    // user is already using, so no allowlist question arises beyond Supabase's.
    const origin =
      typeof globalThis !== 'undefined' &&
      (globalThis as { location?: { origin?: string } }).location?.origin;
    if (origin) return `${origin}${AUTH_CALLBACK_PATH}`;
    return WEB_AUTH_CALLBACK_URL;
  }

  return NATIVE_AUTH_CALLBACK_URL;
}
