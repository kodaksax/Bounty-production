// Pure rules for identity-webhooks. No I/O and no imports, so they are
// unit-tested directly (__tests__/unit/identity-webhooks-logic.test.ts) and
// index.ts only reads and writes.
//
// Why this exists (2026-11-25): Stripe can deliver
// identity.verification_session.processing and .verified for the same session
// in the same second. Each handler did a plain UPDATE, so whichever ran last
// won. In production 12 profiles ended at stripe_identity_status='processing'
// although Stripe had verified them (their legacy id_verification_status, which
// only the verified handler writes, still said 'verified'). public_profiles
// exposes only stripe_identity_status, so every other user saw them as not
// verified.
//
// The rule: once a profile is verified, no later webhook moves it off
// verified. A verified VerificationSession is terminal in Stripe, and a
// verified user can't start a new session (identity-create-session returns
// early), so any non-verified event arriving afterwards is stale. Revoking a
// verification stays an admin action (admin-review-id), not a webhook.

/** Events that set a non-verified status. */
export const NON_VERIFIED_STATUS_BY_EVENT: Readonly<Record<string, string>> = {
  'identity.verification_session.processing': 'processing',
  'identity.verification_session.requires_input': 'requires_input',
  'identity.verification_session.canceled': 'canceled',
}

/**
 * PostgREST `.or()` filter: the row is not verified. Written as part of the
 * UPDATE's WHERE so the check and the write are one statement: Postgres
 * re-checks the condition after taking the row lock, so a verified write that
 * lands first can't be overwritten. `is.null` is needed because `neq` alone
 * skips NULL rows.
 */
export const NOT_VERIFIED_FILTER = 'stripe_identity_status.is.null,stripe_identity_status.neq.verified'

/**
 * The same rule for one row, for tests and for reasoning about the filter:
 * may an event that sets `next` overwrite a profile currently at `current`?
 */
export function mayWriteIdentityStatus(current: string | null | undefined, next: string): boolean {
  if (next === 'verified') return true
  return current !== 'verified'
}

/**
 * Whether to send the event's notification. Only when the status was actually
 * written: a stale "Verification Submitted" after "Identity Verified" is
 * wrong, and so is "needs attention" or "canceled" for someone already verified.
 */
export function shouldNotifyAfterWrite(rowsUpdated: number): boolean {
  return rowsUpdated > 0
}
