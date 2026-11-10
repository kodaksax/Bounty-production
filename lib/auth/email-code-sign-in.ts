/**
 * Email-code (OTP) sign-in for accounts that already exist.
 *
 * Website checkout creates the poster's account with no password
 * (supabase/functions/webhooks: admin.createUser with user_metadata.source =
 * 'bounty_checkout_web'). When that person later installs the app, sign-up
 * answers 409 email_already_registered and they have no password to sign in
 * with. A typed 6-digit code needs no password and no link handoff (links
 * opened from a mail app are unreliable on tablets), so it is the one-step way
 * in for them and for anyone else who has forgotten how they signed up.
 *
 * Analytics never carries the email address: only `method`, `source` and
 * low-cardinality outcome fields.
 */
import { analyticsService } from '../services/analytics-service';
import { supabase } from '../supabase';

/** Where the code request started. Kept small so it groups in analytics. */
export type EmailCodeSource = 'signup_existing_account' | 'sign_in_form';

export const EMAIL_CODE_METHOD = 'email_otp';

/** user_metadata.source that website checkout stamps on accounts it creates. */
export const WEB_CHECKOUT_ACCOUNT_SOURCE = 'bounty_checkout_web';

/** Supabase's email OTP length is a project setting (6–10 digits). */
export const EMAIL_CODE_PATTERN = /^\d{6,10}$/;

function errorCode(error: unknown): string {
  const e = error as { code?: unknown; status?: unknown; name?: unknown } | null;
  if (e && typeof e.code === 'string' && e.code) return e.code;
  if (e && typeof e.status === 'number') return `http_${e.status}`;
  if (e && typeof e.name === 'string' && e.name) return e.name;
  return 'unknown';
}

/**
 * Supabase allows one code per address per "max frequency" window (60s on
 * hosted projects) and says "you can only request this after N seconds". The
 * generic rate-limit copy says "wait a few minutes", which is wrong and
 * discouraging here, so say exactly how long. Null for any other error.
 */
export function emailCodeWaitMessage(error: unknown): string | null {
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  const match = /after (\d+) seconds?/i.exec(message);
  if (!match) return null;
  return `We just sent a code. You can ask for another in ${match[1]} seconds.`;
}

/**
 * Ask Supabase to email a sign-in code. Never creates an account: a typo'd
 * address must not silently make a second, empty one.
 */
export async function requestEmailSignInCode(
  email: string,
  source: EmailCodeSource,
  { isResend = false }: { isResend?: boolean } = {}
): Promise<void> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) throw error;
  } catch (error) {
    void analyticsService.trackEvent('auth_otp_failed', {
      method: EMAIL_CODE_METHOD,
      source,
      stage: 'send',
      is_resend: isResend,
      error_code: errorCode(error),
    });
    throw error;
  }
  void analyticsService.trackEvent('auth_otp_sent', {
    method: EMAIL_CODE_METHOD,
    source,
    is_resend: isResend,
  });
}

/**
 * Exchange the emailed code for a session. Throws when Supabase rejects the
 * code or returns no session.
 */
export async function verifyEmailSignInCode(
  email: string,
  token: string,
  source: EmailCodeSource
) {
  try {
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
    if (!data?.session) {
      const noSession: Error & { code?: string } = new Error(
        'No session was returned. Request a new code and try again.'
      );
      noSession.code = 'session_missing_after_otp';
      throw noSession;
    }
    const origin = data.session.user?.user_metadata?.source;
    void analyticsService.trackEvent('auth_otp_verified', {
      method: EMAIL_CODE_METHOD,
      source,
      account_origin: origin === WEB_CHECKOUT_ACCOUNT_SOURCE ? 'web_checkout' : 'other',
    });
    return data;
  } catch (error) {
    void analyticsService.trackEvent('auth_otp_failed', {
      method: EMAIL_CODE_METHOD,
      source,
      stage: 'verify',
      error_code: errorCode(error),
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Handoff from sign-up to the code-entry step on sign-in.
//
// Kept in memory, not in route params: on web the params land in the URL, and
// the URL lands in analytics ($current_url) — the address must not. If the
// handoff is lost (web reload), sign-in still works; the person just types
// their email and taps "Email me a code" again.
// ---------------------------------------------------------------------------

export interface EmailCodeHandoff {
  email: string;
  source: EmailCodeSource;
  sentAt: number;
}

/** Supabase email OTPs expire within an hour; a handoff older than this is stale. */
const HANDOFF_TTL_MS = 30 * 60 * 1000;

let pendingHandoff: EmailCodeHandoff | null = null;

export function setEmailCodeHandoff(handoff: Omit<EmailCodeHandoff, 'sentAt'>): void {
  pendingHandoff = { ...handoff, sentAt: Date.now() };
}

/**
 * The pending handoff, if it is still fresh. Does not clear it: React may run
 * a state initializer twice (StrictMode), and a read-once value would be gone
 * by the second call. Call clearEmailCodeHandoff() once it has been used up.
 */
export function peekEmailCodeHandoff(now: number = Date.now()): EmailCodeHandoff | null {
  if (!pendingHandoff) return null;
  if (now - pendingHandoff.sentAt > HANDOFF_TTL_MS) {
    pendingHandoff = null;
    return null;
  }
  return pendingHandoff;
}

export function clearEmailCodeHandoff(): void {
  pendingHandoff = null;
}
