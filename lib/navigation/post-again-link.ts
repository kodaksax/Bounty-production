/**
 * The "Post again" deep link, for thank-you emails: it opens the composer with
 * a past bounty copied in (app/bounty/[id]/post-again.tsx). Signed out, it goes
 * through sign-in and resumes there.
 *
 * Two spellings reach the same route:
 *   - the app's custom scheme (app.json `scheme`):
 *       bountyexpo-workspace://bounty/<id>/post-again?source=email
 *   - the universal link, already claimed for /bounty/* by the iOS AASA and
 *     the Android intent filter:
 *       https://bountyfinder.app/bounty/<id>/post-again?source=email
 * An email should use the https one: Gmail on the web strips custom-scheme
 * links (the 2026-10-06 incident, supabase/functions/_shared/web-links.ts).
 *
 * Only an opaque bounty id goes in the URL. Ownership is re-checked in the app
 * (buildDraftFromBounty), so a forwarded link copies nothing for anyone else.
 */

import { isUuid } from '../../supabase/functions/_shared/web-links';
import { isPostAgainSource, type PostAgainSource } from '../post-again/sources';

export const APP_SCHEME = 'bountyexpo-workspace';
export const UNIVERSAL_LINK_ORIGIN = 'https://bountyfinder.app';

/** In-app route: `/bounty/<id>/post-again[?source=<source>]`. */
export function postAgainRoutePath(bountyId: string, source?: PostAgainSource): string {
  const path = `/bounty/${encodeURIComponent(bountyId)}/post-again`;
  return source ? `${path}?source=${source}` : path;
}

/** Custom-scheme link: opens the app directly (does nothing without it). */
export function postAgainDeepLink(bountyId: string, source: PostAgainSource = 'email'): string {
  return `${APP_SCHEME}://${postAgainRoutePath(bountyId, source).slice(1)}`;
}

/** https link: opens the app where installed. Use this one in emails. */
export function postAgainUniversalLink(bountyId: string, source: PostAgainSource = 'email'): string {
  return `${UNIVERSAL_LINK_ORIGIN}${postAgainRoutePath(bountyId, source)}`;
}

const POST_AGAIN_PATH_RE = /^\/bounty\/([^/?#]+)\/post-again\/?$/;

/**
 * `value` rebuilt as a post-again route path when it is exactly one (a UUID
 * bounty id, nothing but an optional valid `source`), else null. Used to
 * resume the link after sign-in, so nothing else can ride along.
 */
export function safePostAgainRedirect(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return null;
  try {
    const url = new URL(raw, 'https://app.invalid');
    if (url.origin !== 'https://app.invalid' || url.hash) return null;
    const match = POST_AGAIN_PATH_RE.exec(url.pathname);
    if (!match || !isUuid(match[1])) return null;
    for (const key of url.searchParams.keys()) {
      if (key !== 'source' || url.searchParams.getAll(key).length !== 1) return null;
    }
    const source = url.searchParams.get('source');
    if (source !== null && !isPostAgainSource(source)) return null;
    return postAgainRoutePath(match[1].toLowerCase(), source ?? undefined);
  } catch {
    return null;
  }
}
