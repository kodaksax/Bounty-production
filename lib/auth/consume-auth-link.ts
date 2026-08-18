/**
 * Turning a parsed auth link into a real Supabase session.
 *
 * Recovery tokens are single-use and server-side: the second attempt on the
 * same link fails no matter what the client does. That makes "the user tapped
 * the link twice" (or the screen remounted, or iOS re-delivered the URL on
 * resume) a first-class outcome rather than an error — but only when *this app
 * run* already spent a recovery link. A pre-existing ordinary session must
 * never be mistaken for recovery material, so the two cases are tracked apart.
 */

import { supabase } from '../supabase';
import type { AuthLinkType, ParsedAuthLink } from './recovery-link';

export type ConsumeAuthLinkOutcome =
  /** A session now exists because this call created it. */
  | { status: 'established'; type: AuthLinkType | null }
  /** The link was already spent by this app run, and its session still holds. */
  | { status: 'already_established'; type: AuthLinkType | null }
  /** Expired, or used and gone. Same remedy: request a fresh link. */
  | { status: 'expired' }
  /** Structurally wrong or rejected outright. */
  | { status: 'invalid' }
  /** Transient — network, timeout, Supabase outage. Retry is meaningful. */
  | { status: 'failed' }
  /** Nothing auth-related in the link at all. */
  | { status: 'none' };

/**
 * Set once a recovery link has been successfully consumed in this JS runtime.
 *
 * Module scope, deliberately not persisted: it must survive a screen remount
 * (so a re-delivered URL is recognised as a repeat) but NOT an app restart —
 * resurrecting recovery state on cold start would drag a user who already
 * finished back into "set a new password".
 */
let recoveryLinkConsumed = false;

/** Test seam, and used by the update-password screen once the reset completes. */
export function resetConsumedRecoveryLink(): void {
  recoveryLinkConsumed = false;
}

export function hasConsumedRecoveryLink(): boolean {
  return recoveryLinkConsumed;
}

/**
 * Classify a Supabase auth error without surfacing its text to the user.
 * Message matching is unavoidable here — auth-js does not give stable codes for
 * these on every path — so it is kept in one place and kept broad.
 */
function classifyAuthError(error: { message?: string; status?: number } | null): 'expired' | 'invalid' | 'failed' {
  const message = (error?.message ?? '').toLowerCase();
  const status = error?.status;

  if (message.includes('expired')) return 'expired';
  if (
    message.includes('invalid') ||
    message.includes('not found') ||
    message.includes('already been used') ||
    status === 401 ||
    status === 403 ||
    status === 404
  ) {
    return 'invalid';
  }
  // 429 and 5xx are worth retrying; so is a fetch failure with no status.
  return 'failed';
}

async function hasLiveSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data?.session?.access_token);
  } catch {
    return false;
  }
}

/**
 * Establish a session from `link`, or explain why that is not possible.
 *
 * Never logs token values. Callers map the outcome to UI state; they must not
 * navigate on anything other than `established` / `already_established`.
 */
export async function consumeAuthLink(link: ParsedAuthLink): Promise<ConsumeAuthLinkOutcome> {
  if (link.kind === 'none') return { status: 'none' };

  if (link.kind === 'error') {
    // A repeat tap on a spent recovery link reports expired. If we already hold
    // the session that first tap created, the user is exactly where they need
    // to be and an error screen would be a lie.
    if (recoveryLinkConsumed && (await hasLiveSession())) {
      return { status: 'already_established', type: link.type };
    }
    if (link.code === 'expired' || link.code === 'used') return { status: 'expired' };
    if (link.code === 'invalid') return { status: 'invalid' };
    return { status: 'failed' };
  }

  try {
    let error: { message?: string; status?: number } | null = null;
    let sessionCreated = false;

    if (link.kind === 'tokens') {
      const result = await supabase.auth.setSession({
        access_token: link.accessToken,
        refresh_token: link.refreshToken,
      });
      error = result.error ?? null;
      sessionCreated = Boolean(result.data?.session);
    } else if (link.kind === 'token_hash') {
      const result = await supabase.auth.verifyOtp({
        token_hash: link.tokenHash,
        type: link.type,
      });
      error = result.error ?? null;
      sessionCreated = Boolean(result.data?.session);
    } else {
      // PKCE. Not the current flow (the client runs auth-js's default implicit
      // grant), but a link with `?code=` must not dead-end if the project or a
      // future client option turns PKCE on.
      const exchange = supabase.auth.exchangeCodeForSession;
      if (typeof exchange !== 'function') return { status: 'invalid' };
      const result = await exchange.call(supabase.auth, link.code);
      error = result.error ?? null;
      sessionCreated = Boolean(result.data?.session);
    }

    if (error) {
      // Same repeat-tap allowance as above: the failure may just be the second
      // delivery of a link we already cashed.
      if (recoveryLinkConsumed && (await hasLiveSession())) {
        return { status: 'already_established', type: link.type };
      }
      return { status: classifyAuthError(error) };
    }

    if (!sessionCreated) {
      // No error but no session either — treat as invalid rather than pretending
      // success, otherwise the next screen would call updateUser() unauthenticated.
      if (recoveryLinkConsumed && (await hasLiveSession())) {
        return { status: 'already_established', type: link.type };
      }
      return { status: 'invalid' };
    }

    if (link.type === 'recovery') recoveryLinkConsumed = true;
    return { status: 'established', type: link.type };
  } catch {
    // Thrown (rather than returned) errors are transport-level.
    return { status: 'failed' };
  }
}
