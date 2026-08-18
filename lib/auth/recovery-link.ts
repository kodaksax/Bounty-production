/**
 * Auth callback link parsing.
 *
 * Supabase's `/auth/v1/verify` endpoint answers with a 303 whose Location puts
 * every result — tokens AND errors — in the URL **fragment**, not the query
 * string. Verified against production (project xwlwqzzphmmhghiqvkeu):
 *
 *   303 See Other
 *   Location: https://bountyfinder.app/auth/callback
 *             #error=access_denied&error_code=otp_expired&error_description=...
 *
 * and on success:
 *
 *   Location: <redirect_to>#access_token=...&refresh_token=...&type=recovery
 *
 * Nothing in the app used to read that fragment, so every recovery link — valid
 * or expired — resolved to "Invalid Confirmation Link". Two further wrinkles
 * this module absorbs:
 *
 *  1. On native, expo-router's `extractExactPathFromURL` rebuilds the path from
 *     `host + pathname + search` and **discards the fragment entirely**, so
 *     `useLocalSearchParams()` can never see recovery tokens from a universal
 *     link. Callers must hand us the raw URL from `expo-linking` instead.
 *  2. On web the fragment survives, and expo-router exposes it as the reserved
 *     `'#'` search param. `app/auth/index.tsx` also forwards it that way when
 *     it bounces `/auth` to `/auth/callback`.
 *
 * Everything here is pure string work — no `URL`, no platform APIs — so it runs
 * identically under Hermes, on web, and in jest, and can be unit-tested with
 * plain strings.
 *
 * Token VALUES never appear in the returned error fields and must never be
 * logged; use `redactAuthUrl` when a link needs to appear in a log.
 */

/** Auth link kinds Supabase can hand back to a redirect target. */
export type AuthLinkType =
  | 'recovery'
  | 'signup'
  | 'invite'
  | 'email'
  | 'email_change'
  | 'magiclink';

const AUTH_LINK_TYPES: readonly AuthLinkType[] = [
  'recovery',
  'signup',
  'invite',
  'email',
  'email_change',
  'magiclink',
];

/**
 * Normalised failure reasons. Deliberately coarse: these map to user-facing
 * copy, and Supabase's raw `error_description` is never shown to users.
 */
export type AuthLinkErrorCode = 'expired' | 'used' | 'invalid' | 'unknown';

export type ParsedAuthLink =
  /** Implicit flow (Supabase default): tokens arrived in the fragment. */
  | { kind: 'tokens'; accessToken: string; refreshToken: string; type: AuthLinkType | null }
  /** `?token_hash=…&type=…` — survives native deep-link parsing; preferred. */
  | { kind: 'token_hash'; tokenHash: string; type: AuthLinkType }
  /** PKCE flow: `?code=…`, exchanged via `exchangeCodeForSession`. */
  | { kind: 'code'; code: string; type: AuthLinkType | null }
  /** Supabase reported a failure (expired / already used / malformed). */
  | { kind: 'error'; code: AuthLinkErrorCode; type: AuthLinkType | null }
  /** No auth material present at all. */
  | { kind: 'none' };

function isAuthLinkType(value: unknown): value is AuthLinkType {
  return typeof value === 'string' && (AUTH_LINK_TYPES as readonly string[]).includes(value);
}

function decodeParamValue(raw: string): string {
  // `application/x-www-form-urlencoded` encodes spaces as `+`, which
  // decodeURIComponent leaves alone. Supabase's error_description relies on it.
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    // Malformed percent-escapes (e.g. a bare `%` in a hand-mangled link) must
    // not throw — a broken link is an "invalid link", not a crash.
    return raw.replace(/\+/g, ' ');
  }
}

/**
 * Parse an `a=1&b=2` parameter string. Later duplicates lose to earlier ones so
 * an attacker appending `&access_token=…` to a legitimate link cannot override
 * the value Supabase put there first.
 */
export function parseParamString(input: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!input) return out;

  for (const pair of input.replace(/^[?#]/, '').split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
    const key = decodeParamValue(rawKey);
    if (!key || key in out) continue;
    out[key] = decodeParamValue(rawValue);
  }

  return out;
}

/**
 * Split a URL (any scheme, including custom schemes that `new URL` mishandles
 * under Hermes) into its query and fragment parameter strings.
 */
export function splitAuthUrl(url: string): { query: string; fragment: string } {
  if (!url) return { query: '', fragment: '' };

  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : url.slice(hashIndex + 1);

  const queryIndex = beforeHash.indexOf('?');
  const query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1);

  return { query, fragment };
}

/**
 * Collect every parameter bag a callback URL can carry, in the order the caller
 * supplied them. The first bag to define a key wins.
 *
 * A `'#'` key in any bag is itself an encoded parameter string — that is how
 * expo-router surfaces a web fragment and how `app/auth/index.tsx` forwards one
 * — so it is expanded rather than treated as a value.
 */
function collectParamBags(bags: Record<string, string>[]): Record<string, string> {
  const merged: Record<string, string> = Object.create(null);

  for (const bag of bags) {
    for (const [key, value] of Object.entries(bag)) {
      if (key === '#') {
        // Expand a forwarded fragment. Its contents rank alongside the bag it
        // came from, and still cannot overwrite an earlier bag's value.
        for (const [innerKey, innerValue] of Object.entries(parseParamString(value))) {
          if (!(innerKey in merged)) merged[innerKey] = innerValue;
        }
        continue;
      }
      if (!(key in merged)) merged[key] = value;
    }
  }

  return merged;
}

function mapErrorCode(params: Record<string, string>): AuthLinkErrorCode {
  const errorCode = (params.error_code ?? '').toLowerCase();
  const error = (params.error ?? '').toLowerCase();
  const description = (params.error_description ?? '').toLowerCase();
  const haystack = `${errorCode} ${error} ${description}`;

  // Supabase burns a recovery token on first use, so a second tap on the same
  // link reports it exactly like an expired one (error_code=otp_expired). We
  // cannot tell the two apart from the redirect alone and the remedy is
  // identical, so 'expired' covers both and the copy says "expired or used".
  if (haystack.includes('expired')) return 'expired';
  if (haystack.includes('already') || haystack.includes('used')) return 'used';
  if (
    haystack.includes('invalid') ||
    haystack.includes('not found') ||
    haystack.includes('validation_failed') ||
    haystack.includes('otp_disabled') ||
    error === 'access_denied' ||
    error === 'unauthorized_client'
  ) {
    return 'invalid';
  }
  return 'unknown';
}

/**
 * Parse an auth callback link into exactly one actionable outcome.
 *
 * @param sources Raw URL strings and/or router param records, most trustworthy
 *   first. `null`/`undefined` entries are skipped so callers can pass a
 *   not-yet-resolved `Linking.useURL()` value directly.
 */
export function parseAuthLink(
  ...sources: (string | Record<string, string | string[] | undefined> | null | undefined)[]
): ParsedAuthLink {
  const bags: Record<string, string>[] = [];

  for (const source of sources) {
    if (!source) continue;

    if (typeof source === 'string') {
      const { query, fragment } = splitAuthUrl(source);
      // Fragment before query: Supabase's implicit-flow tokens live there.
      if (fragment) bags.push(parseParamString(fragment));
      if (query) bags.push(parseParamString(query));
      continue;
    }

    // A router param record (`useLocalSearchParams()`): flatten array values.
    const flat: Record<string, string> = Object.create(null);
    for (const [key, value] of Object.entries(source)) {
      const single = Array.isArray(value) ? value[0] : value;
      if (typeof single === 'string' && single !== '') flat[key] = single;
    }
    if (Object.keys(flat).length) bags.push(flat);
  }

  const params = collectParamBags(bags);
  const type = isAuthLinkType(params.type) ? params.type : null;

  // An explicit failure wins over anything else present. Supabase never sends
  // both, and treating a reported error as usable material would produce a
  // confusing generic failure later instead of "request a new link".
  if (params.error || params.error_code || params.error_description) {
    return { kind: 'error', code: mapErrorCode(params), type };
  }

  // `token_hash` (and its `token` alias) is the only form that survives every
  // transport unchanged, so it is preferred when present.
  const tokenHash = params.token_hash || params.token;
  if (tokenHash) {
    // A token hash is meaningless without knowing what to verify it as;
    // `recovery` is the only type this app mints hash links for.
    return { kind: 'token_hash', tokenHash, type: type ?? 'recovery' };
  }

  if (params.code) {
    return { kind: 'code', code: params.code, type };
  }

  if (params.access_token && params.refresh_token) {
    return {
      kind: 'tokens',
      accessToken: params.access_token,
      refreshToken: params.refresh_token,
      type,
    };
  }

  // An access_token with no refresh_token cannot seed a durable session, and a
  // type-only link carries nothing to verify. Both are malformed rather than
  // absent — reporting 'none' would strand the user on a blank spinner.
  if (params.access_token || params.refresh_token || type) {
    return { kind: 'error', code: 'invalid', type };
  }

  return { kind: 'none' };
}

/** True when the link carries password-recovery material rather than another flow. */
export function isRecoveryLink(link: ParsedAuthLink): boolean {
  switch (link.kind) {
    case 'tokens':
    case 'code':
    case 'token_hash':
      return link.type === 'recovery';
    default:
      return false;
  }
}

/**
 * Strip credentials out of a URL so it is safe to log. Keeps the shape (which
 * keys were present) because that is what makes a log entry diagnostic, and
 * drops every value that could be replayed.
 */
export function redactAuthUrl(url: string | null | undefined): string {
  if (!url) return '<none>';

  const SENSITIVE = new Set([
    'access_token',
    'refresh_token',
    'token',
    'token_hash',
    'code',
    'code_verifier',
    'provider_token',
    'provider_refresh_token',
    'id_token',
  ]);

  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = beforeHash.indexOf('?');
  const base = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);

  const { query, fragment } = splitAuthUrl(url);
  const describe = (input: string): string =>
    Object.keys(parseParamString(input))
      .map(key => (SENSITIVE.has(key) ? `${key}=<redacted>` : key))
      .join('&');

  let out = base;
  const q = describe(query);
  if (q) out += `?${q}`;
  const f = describe(fragment);
  if (f) out += `#${f}`;
  return out;
}
