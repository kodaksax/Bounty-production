// Poster email fallback + provider-error helpers for process-notification.
//
// Pure and dependency-free for unit testing; also inlined into index.ts
// because the Supabase Edge bundler does not support local imports.
//
// Why a fallback exists (2026-09-25): poster-facing notifications failed 58-61%
// of the time (vs 18% for hunter-facing bounty_nearby). Two causes, both
// invisible from the funnel: every Android push was rejected by Expo (no FCM
// credentials on the Expo project), and a set of posters had no token at all.
// A poster who never hears about an applicant is a dead marketplace
// transaction, so for these two types only, a failed push is retried by email.

// Only these types get an email when push can't reach the poster. They are
// excluded from the blanket email fan-out so the fallback is the ONLY email
// path for them — capped at one email per application (bounty_request).
export const POSTER_EMAIL_FALLBACK_TYPES = new Set(['application', 'application_pending_reminder'])

export function isPosterFallbackType(type: string): boolean {
  return POSTER_EMAIL_FALLBACK_TYPES.has(type)
}

const MAX_ERROR_MESSAGE_LENGTH = 300

export function truncateMessage(value: unknown): string | null {
  if (value == null) return null
  const text = String(value)
  if (!text) return null
  return text.length > MAX_ERROR_MESSAGE_LENGTH ? `${text.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…` : text
}

/**
 * Pull the provider error out of one Expo push ticket. Expo relays APNs/FCM
 * failures as `{ status: 'error', message, details: { error } }`; `details.error`
 * is the machine code (DeviceNotRegistered, InvalidCredentials, ...) and
 * `message` is the human text that usually names the actual cause.
 */
export function describeTicketError(ticket: unknown): { code: string; message: string | null } {
  const t = (ticket ?? {}) as { message?: unknown; details?: { error?: unknown } }
  const code = typeof t.details?.error === 'string' && t.details.error ? t.details.error : 'unknown'
  return { code, message: truncateMessage(t.message) }
}

/**
 * One email per application: the dedupe key is the bounty_request id, which
 * the `application` trigger writes as `request_id` and the reminder cron as
 * `requestId`. Rows with neither fall back to the outbox id, which still makes
 * outbox retries idempotent.
 */
export function fallbackDedupeKey(data: Record<string, unknown>, outboxId: string): string {
  const requestId = data.requestId ?? data.request_id
  if (typeof requestId === 'string' && requestId.trim()) return `request:${requestId.trim()}`
  return `outbox:${outboxId}`
}

export function applicantListLink(base: string, bountyId: string): string {
  const normalized = base.endsWith('/') ? base : `${base}/`
  return `${normalized}postings/${encodeURIComponent(bountyId)}`
}

export function buildPosterFallbackEmail(params: {
  bountyTitle: string | null
  applicantCount: number
}): { title: string; body: string } {
  const bountyTitle = (params.bountyTitle ?? '').trim() || 'your bounty'
  const count = Math.max(1, Math.floor(params.applicantCount || 0))
  const title =
    count === 1
      ? `Someone applied to "${bountyTitle}"`
      : `${count} applicants are waiting on "${bountyTitle}"`
  const body =
    count === 1
      ? `A hunter applied to "${bountyTitle}" and is waiting for your answer. Accept or decline in the Bounty app — unanswered applications close automatically.`
      : `${count} hunters applied to "${bountyTitle}" and are waiting for your answer. Accept or decline in the Bounty app — unanswered applications close automatically.`
  return { title, body }
}
