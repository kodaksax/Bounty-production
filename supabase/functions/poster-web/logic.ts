// Pure rules for the poster-web function. Dependency-free so they are
// unit-tested (__tests__/unit/poster-web-logic.test.ts) and index.ts only
// orchestrates I/O, the same split as process-notification/email-fallback.ts.

// bounty_disputes.status values that still block the bounty. Everything else
// (resolved_*, closed, cancelled) is a decided dispute.
export const ACTIVE_DISPUTE_STATUSES = ['open', 'under_review', 'stripe_dispute']

// bounty_disputes.reason_code (20261002120100_review_window_and_recourse_queue).
export const DISPUTE_REASON_CODES = [
  'hunter_unresponsive',
  'work_quality',
  'scope_disagreement',
  'missed_deadline',
  'communication',
  'other',
] as const
export type DisputeReasonCode = (typeof DISPUTE_REASON_CODES)[number]

export const MIN_DISPUTE_REASON_LENGTH = 10
export const MAX_DISPUTE_REASON_LENGTH = 2000

// completion_review_policy.window_hours default, for databases where that
// table does not exist yet.
export const DEFAULT_REVIEW_WINDOW_HOURS = 72

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export type Stage =
  | 'open' // taking applications
  | 'in_progress' // a hunter is working
  | 'review' // the hunter submitted work; waiting on the poster
  | 'disputed'
  | 'completed'
  | 'closed' // cancelled, expired, deleted, ...

/** Where the bounty is, from the poster's point of view. */
export function deriveStage(input: {
  bountyStatus: string
  hasActiveDispute: boolean
  latestSubmissionStatus: string | null
}): Stage {
  const { bountyStatus, hasActiveDispute, latestSubmissionStatus } = input
  if (bountyStatus === 'completed') return 'completed'
  if (hasActiveDispute) return 'disputed'
  if (bountyStatus === 'open') return 'open'
  if (bountyStatus === 'in_progress') {
    return latestSubmissionStatus === 'pending' ? 'review' : 'in_progress'
  }
  return 'closed'
}

export type ReleaseOutcome =
  | { ok: true; status: 'released' | 'release_pending'; transferId: string | null }
  | { ok: false; code: string; message: string; httpStatus: number }

/**
 * Reads a bounty-payments /release response. A transfer Stripe has accepted
 * counts as released, including the 409 that /release returns when the same
 * transfer was already requested: that is how a retry after a partial failure
 * (transfer made, approval write lost) finishes instead of sticking.
 */
export function interpretReleaseResponse(httpStatus: number, body: any): ReleaseOutcome {
  const status = typeof body?.status === 'string' ? body.status : null
  const transferId = typeof body?.transferId === 'string' && body.transferId ? body.transferId : null

  if (status === 'released' && (httpStatus === 200 || transferId)) {
    return { ok: true, status: 'released', transferId }
  }
  if (status === 'release_pending' && transferId && (httpStatus === 200 || httpStatus === 409)) {
    return { ok: true, status: 'release_pending', transferId }
  }

  const code = typeof body?.code === 'string' ? body.code : `http_${httpStatus}`
  return {
    ok: false,
    code,
    message: releaseFailureMessage(code, body?.error ?? body?.message),
    httpStatus: httpStatus >= 400 && httpStatus < 600 ? httpStatus : 502,
  }
}

function releaseFailureMessage(code: string, serverMessage: unknown): string {
  if (code === 'hunter_not_onboarded' || code === 'hunter_payouts_disabled') {
    return 'The hunter needs to finish their payout setup before they can be paid. We have reminded them. Your payment stays held until then.'
  }
  if (typeof serverMessage === 'string' && serverMessage.trim()) return serverMessage.trim()
  return 'We could not release the payment. Nothing was sent. Please try again.'
}

/** Whether a release failure means the hunter must finish payout setup. */
export function isHunterPayoutSetupFailure(code: string): boolean {
  return code === 'hunter_not_onboarded' || code === 'hunter_payouts_disabled'
}

export interface ProofItem {
  name: string
  type: 'image' | 'file'
  url: string
}

/**
 * The hunter's proof attachments that are safe to show on the website: only
 * files in this project's public storage. proof_items is a JSON string on most
 * rows (the app stringifies it) and an array on some; device-local file://
 * paths are dropped.
 */
export function parseProofItems(raw: unknown, supabaseUrl: string): ProofItem[] {
  let items: unknown = raw
  if (typeof raw === 'string') {
    try {
      items = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(items)) return []

  const publicPrefix = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/`
  const out: ProofItem[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const url = [it.remoteUri, it.url].find(
      (u): u is string => typeof u === 'string' && u.startsWith(publicPrefix)
    )
    if (!url) continue
    out.push({
      name: typeof it.name === 'string' && it.name.trim() ? it.name.trim().slice(0, 200) : 'Attachment',
      type: it.type === 'image' ? 'image' : 'file',
      url,
    })
  }
  return out
}

export type DisputeInput =
  | { ok: true; reason: string; reasonCode: DisputeReasonCode | null }
  | { ok: false; error: string; code: string }

export function validateDisputeInput(body: any): DisputeInput {
  const reason = typeof body?.reason === 'string' ? body.reason.replace(/[<>]/g, '').trim() : ''
  if (reason.length < MIN_DISPUTE_REASON_LENGTH) {
    return {
      ok: false,
      error: `Tell us what went wrong in at least ${MIN_DISPUTE_REASON_LENGTH} characters.`,
      code: 'invalid_reason',
    }
  }
  const rawCode = body?.reason_code ?? body?.reasonCode
  if (rawCode != null && !(DISPUTE_REASON_CODES as readonly string[]).includes(rawCode)) {
    return { ok: false, error: 'Unknown problem type.', code: 'invalid_reason_code' }
  }
  return {
    ok: true,
    reason: reason.slice(0, MAX_DISPUTE_REASON_LENGTH),
    reasonCode: (rawCode as DisputeReasonCode | undefined) ?? null,
  }
}

/** The submission's review deadline, or null when it has no submitted_at. */
export function reviewDeadline(submittedAt: string | null, windowHours: number): string | null {
  if (!submittedAt) return null
  const t = Date.parse(submittedAt)
  if (Number.isNaN(t)) return null
  return new Date(t + windowHours * 3600 * 1000).toISOString()
}

/** What the hunter receives after the platform fee, in dollars. */
export function hunterPayout(amount: number, feePercent: number): number {
  const fee = Math.round(((amount * feePercent) / 100) * 100) / 100
  return Math.round((amount - fee) * 100) / 100
}
