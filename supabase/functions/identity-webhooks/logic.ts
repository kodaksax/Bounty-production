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
//
// Where it runs: public.apply_identity_webhook_event() (migration
// 20261125200000). The status write and the notification insert happen in one
// transaction holding the profile's row lock, so a slow response can't let a
// stale notification be queued after a newer one. The SQL mirrors the
// functions below; the tests check both say the same thing.

/** Events that set a non-verified status. */
export const NON_VERIFIED_STATUS_BY_EVENT: Readonly<Record<string, string>> = {
  'identity.verification_session.processing': 'processing',
  'identity.verification_session.requires_input': 'requires_input',
  'identity.verification_session.canceled': 'canceled',
}

/** The notification type each status sends (notifications_outbox.data.type). */
export const NOTIFICATION_TYPE_BY_STATUS: Readonly<Record<string, string>> = {
  verified: 'verification_verified',
  processing: 'verification_submitted',
  requires_input: 'verification_rejected',
  canceled: 'verification_canceled',
}

/**
 * May an event that sets `next` overwrite a profile currently at `current`?
 */
export function mayWriteIdentityStatus(current: string | null | undefined, next: string): boolean {
  if (next === 'verified') return true
  return current !== 'verified'
}

/**
 * Is an undelivered notification of `pendingType` stale once the status has
 * moved to `newStatus`? Yes for any verification notification that describes a
 * different status: a "Verification Submitted" still queued when "Identity
 * Verified" lands must never be delivered after it.
 */
export function isSupersededBy(pendingType: string, newStatus: string): boolean {
  const verificationTypes = Object.values(NOTIFICATION_TYPE_BY_STATUS)
  if (!verificationTypes.includes(pendingType)) return false
  return pendingType !== NOTIFICATION_TYPE_BY_STATUS[newStatus]
}

/** What apply_identity_webhook_event returns. */
export type ApplyResult =
  | { applied: true; superseded: number; notified: boolean }
  | { applied: false; reason: 'already_verified' | 'no_profile' }
