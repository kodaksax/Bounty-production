// Email fallback + provider-error helpers for process-notification.
//
// Pure and dependency-free so the fallback rules (who is eligible, which
// preference applies, how emails are deduped and worded) are unit-tested here
// and index.ts only orchestrates I/O. index.ts imports this module directly
// (the CLI bundler resolves relative imports, as ../_shared/ imports in
// connect/ and admin-withdrawals/ already rely on) -- do not re-inline it.
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
export const POSTER_EMAIL_FALLBACK_TYPES = new Set(['application'])

export function isPosterFallbackType(type: string): boolean {
  return POSTER_EMAIL_FALLBACK_TYPES.has(type)
}

// Hunter-facing: the closed-loop notice when a request auto-closes without a
// poster decision (72h expiry, or the absent-poster sweep; data.reason says
// which). Same rule as the poster types: email only when push can't reach
// them, one email per application, never via the blanket fan-out.
//
// Since SBA-09 (2026-10-20) closures are held in the database and reported in
// one application_closure_digest per hunter per day
// (fn_send_hunter_closure_digests), so application_expired only reaches this
// function if the hold failed and let the row through. The digest follows the
// same rule (product decision 2026-10-19): email only when push can't reach
// the hunter, one email per digest.
export const CLOSURE_DIGEST_TYPE = 'application_closure_digest'
export const HUNTER_EMAIL_FALLBACK_TYPES = new Set(['application_expired', CLOSURE_DIGEST_TYPE])

export function isEmailFallbackType(type: string): boolean {
  return POSTER_EMAIL_FALLBACK_TYPES.has(type) || HUNTER_EMAIL_FALLBACK_TYPES.has(type)
}

/**
 * Whether a fallback email of `type` needs a bounty to be worth sending. The
 * digest covers several bounties and may have no live alternative to link
 * to, so it is sent without one.
 */
export function fallbackNeedsBounty(type: string): boolean {
  return type !== CLOSURE_DIGEST_TYPE
}

// Push and in-app only: never emailed, neither as a fallback nor through the
// blanket fan-out. Pending-application reminders (SBA-04, 2026-10-19) are a
// per-bounty digest capped at two per bounty; the poster already gets one
// email per application through the `application` fallback, and a reminder
// email used to be suppressed by sharing that application's dedupe key.
export const NO_EMAIL_TYPES = new Set(['application_pending_reminder'])

export function isEmailSuppressedType(type: string): boolean {
  return NO_EMAIL_TYPES.has(type)
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
 * the `application` trigger writes as `request_id` (normalized to
 * `requestId`). Rows with neither fall back to the outbox id, which still
 * makes outbox retries idempotent.
 */
export function fallbackDedupeKey(data: Record<string, unknown>, outboxId: string, type?: string): string {
  // One email per digest (hunter_closure_digests.id).
  if (type === CLOSURE_DIGEST_TYPE) {
    const digestId = data.digestId
    if (typeof digestId === 'string' && digestId.trim()) return `digest:${digestId.trim()}`
    return `outbox:${outboxId}`
  }
  // The hunter's closure email is keyed separately from the poster's
  // application email for the same bounty_request: sharing `request:<id>`
  // would make whichever was sent first suppress the other forever.
  if (type && HUNTER_EMAIL_FALLBACK_TYPES.has(type)) {
    const requestId = data.requestId ?? data.request_id ?? data.applicationId
    if (typeof requestId === 'string' && requestId.trim()) return `closed:${requestId.trim()}`
    return `outbox:${outboxId}`
  }
  const requestId = data.requestId ?? data.request_id
  if (typeof requestId === 'string' && requestId.trim()) return `request:${requestId.trim()}`
  return `outbox:${outboxId}`
}

/**
 * What replying to this email does, said plainly. A poster replied "Accept"
 * to one of these on 2026-10-07 and nothing happened: replies went to the
 * support inbox and nothing read them. When inbound reply handling is on
 * (EMAIL_REPLY_DOMAIN, see email-inbound/) a reply gets a one-tap
 * confirmation link back; otherwise the email must not imply a reply works.
 */
export function replyExpectation(replyHandled: boolean): string {
  return replyHandled
    ? 'You can also reply ACCEPT or DECLINE and we’ll email you a link to confirm — a reply on its own never accepts anyone.'
    : 'Replying to this email reaches our support team; it does not accept or decline anyone.'
}

/**
 * The button goes to the website (see _shared/web-links.ts), so the copy must
 * not send people to the app: the poster this was written for paid on the
 * web, never installed it, and could not act on "Accept or decline in the
 * Bounty app".
 */
export function buildPosterFallbackEmail(params: {
  bountyTitle: string | null
  applicantCount: number
  replyHandled?: boolean
}): { title: string; body: string } {
  const bountyTitle = (params.bountyTitle ?? '').trim() || 'your bounty'
  const count = Math.max(1, Math.floor(params.applicantCount || 0))
  const title =
    count === 1
      ? `Someone applied to "${bountyTitle}"`
      : `${count} applicants are waiting on "${bountyTitle}"`
  const who =
    count === 1
      ? `A hunter applied to "${bountyTitle}" and is waiting for your answer.`
      : `${count} hunters applied to "${bountyTitle}" and are waiting for your answer.`
  const body =
    `${who} Use the button below to see who applied and accept or decline in your web browser — you don’t need the app. ` +
    `Unanswered applications close automatically. ${replyExpectation(params.replyHandled === true)}`
  return { title, body }
}

/**
 * Worded as a closure, never as the poster's decision: the poster didn't
 * decide anything. `reason` is data.reason from fn_expire_bounty_requests
 * ('no_response' -- which also covers requests that expired after the poster
 * engaged, e.g. by messaging, so the copy says "no decision", not "no
 * response") or fn_sweep_absent_posters ('poster_absent', with
 * data.bountyClosed saying whether the bounty itself was archived).
 */
export function buildHunterClosedEmail(params: {
  bountyTitle: string | null
  reason: string | null
  /** From data.bountyClosed: true only when the sweep archived the bounty. */
  bountyClosed?: boolean
}): { title: string; body: string } {
  const bountyTitle = (params.bountyTitle ?? '').trim() || 'a bounty'
  const title = `Your application to "${bountyTitle}" closed`
  // Only say the bounty closed when the sweep actually archived it: a funded
  // bounty is left open (flagged stale) for a human to resolve.
  const body =
    params.reason === 'poster_absent'
      ? params.bountyClosed === true
        ? `The poster of "${bountyTitle}" hasn't been active on Bounty, so we closed the bounty and your application with it. This wasn't a rejection — there are other bounties open near you now.`
        : `The poster of "${bountyTitle}" hasn't been active on Bounty, so we closed your application. This wasn't a rejection — there are other bounties open near you now.`
      : `The poster of "${bountyTitle}" didn't make a decision in time, so your application closed automatically. This wasn't a rejection — there are other bounties open near you now.`
  return { title, body }
}

function quoteTitle(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return `"${text || fallback}"`
}

/** "A", "A and B", "A, B and C". */
function joinTitles(titles: string[]): string {
  if (titles.length <= 1) return titles[0] ?? ''
  return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`
}

const DIGEST_EMAIL_MAX_TITLES = 10

/**
 * The daily closure digest, written from its outbox payload (data.items,
 * data.alternatives, data.closedCount; see
 * 20261020090000_hunter_closure_digest.sql). Same tone as the single-closure
 * email: a closure, never a rejection. Unlike the push, which fits two
 * titles, the email names up to ten.
 */
export function buildHunterDigestEmail(data: Record<string, unknown>): { title: string; body: string } {
  const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : []
  const alternatives = Array.isArray(data.alternatives) ? (data.alternatives as Record<string, unknown>[]) : []
  const count = Math.max(1, typeof data.closedCount === 'number' ? Math.floor(data.closedCount) : items.length)

  const closed = items.slice(0, DIGEST_EMAIL_MAX_TITLES).map((i) => quoteTitle(i.bountyTitle, 'a bounty'))
  const more = count - closed.length
  const closedList = more > 0 ? `${closed.join(', ')} and ${more} more` : joinTitles(closed)

  const title =
    count === 1
      ? `Your application to ${closed[0] ?? '"a bounty"'} closed`
      : `${count} of your applications closed`
  let body =
    count === 1
      ? `Your application to ${closed[0] ?? '"a bounty"'} closed automatically. This wasn't a rejection.`
      : closed.length > 0
        ? `${count} of your applications closed automatically: ${closedList}. This wasn't a rejection.`
        : `${count} of your applications closed automatically. This wasn't a rejection.`
  if (alternatives.length > 0) {
    body += ` Still open for you: ${joinTitles(alternatives.map((a) => quoteTitle(a.title, 'a bounty')))}.`
  }
  return { title, body }
}

export type FallbackPushOutcome = { status: 'sent' } | { status: 'failed'; reason: string }

/**
 * Who gets a fallback email: recipients whose push failed, plus recipients for
 * whom push was never attempted (channel off / no push preference) -- except
 * those held back by quiet hours, which is a deliberate suppression.
 */
export function selectFallbackCandidates(
  recipients: string[],
  pushOutcome: Map<string, FallbackPushOutcome>,
  quietHoursBlocked: Set<string>
): string[] {
  return recipients.filter((userId) => {
    const outcome = pushOutcome.get(userId)
    if (outcome) return outcome.status === 'failed'
    return !quietHoursBlocked.has(userId)
  })
}

export interface LegacyNotificationPreferences {
  applications_enabled: boolean | null
  acceptances_enabled: boolean | null
  reminders_enabled: boolean | null
}

/**
 * Legacy per-type toggles (notification_preferences). A missing row or a NULL
 * column means allowed. Posters are gated by applications_enabled; hunters
 * (application_expired) by acceptances_enabled -- the toggle for outcomes of
 * their own applications.
 */
export function isLegacyOptedOut(type: string, prefs: LegacyNotificationPreferences | null | undefined): boolean {
  if (!prefs) return false
  if (POSTER_EMAIL_FALLBACK_TYPES.has(type) && prefs.applications_enabled === false) return true
  if (HUNTER_EMAIL_FALLBACK_TYPES.has(type) && prefs.acceptances_enabled === false) return true
  return false
}

/** Title/body for a fallback email of `type`, from the outbox payload. */
export function buildFallbackEmail(
  type: string,
  params: { bountyTitle: string | null; applicantCount: number; data: Record<string, unknown>; replyHandled?: boolean }
): { title: string; body: string } {
  if (POSTER_EMAIL_FALLBACK_TYPES.has(type)) {
    return buildPosterFallbackEmail({
      bountyTitle: params.bountyTitle,
      applicantCount: params.applicantCount,
      replyHandled: params.replyHandled,
    })
  }
  if (type === CLOSURE_DIGEST_TYPE) {
    return buildHunterDigestEmail(params.data)
  }
  return buildHunterClosedEmail({
    bountyTitle: params.bountyTitle,
    reason: typeof params.data.reason === 'string' ? params.data.reason : null,
    bountyClosed: params.data.bountyClosed === true,
  })
}
