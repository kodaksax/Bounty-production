// Pure decision logic for poster-web. No I/O and no imports, so every rule
// here is unit-tested directly (__tests__/unit/poster-web-logic.test.ts) and
// index.ts only does the reading and writing.
//
// Copy is written for someone using Bounty for the first time in a web
// browser: plain words, one next step, no "open the app". Every money
// statement must stay true to the backend:
//   - web-posted bounties are paid up front (funding_mode at_post) and the
//     charge sits in bounty_payments as `captured`;
//   - only the poster can release it (bounty-payments/release checks
//     bp.poster_id === caller, with no admin override);
//   - nothing auto-releases (the 72h review window is reminders and human
//     review only, and is not deployed as of 2026-10-08).

// ── Bounty status ─────────────────────────────────────────────────────────

export interface StatusExplanation {
  label: string
  explanation: string
}

export function explainBountyStatus(
  status: string | null | undefined,
  ctx: { pendingApplicants: number; hasSubmission: boolean }
): StatusExplanation {
  switch (status) {
    case 'open':
      return ctx.pendingApplicants > 0
        ? {
            label: ctx.pendingApplicants === 1 ? '1 person wants this job' : `${ctx.pendingApplicants} people want this job`,
            explanation: 'Look at who applied and choose one. Nobody starts until you accept them.',
          }
        : {
            label: 'Waiting for people to apply',
            explanation: 'Your bounty is posted. We’ll email you as soon as someone offers to do it.',
          }
    case 'in_progress':
      return ctx.hasSubmission
        ? {
            label: 'The job is marked done',
            explanation: 'Your hunter says the work is finished. Check it, then confirm or tell us about a problem.',
          }
        : {
            label: 'Someone is on the job',
            explanation: 'You accepted a hunter. When they finish, they’ll mark it done and we’ll email you to confirm.',
          }
    case 'completed':
      return { label: 'Finished', explanation: 'This job is complete. Thank you for using Bounty.' }
    case 'cancellation_requested':
      return { label: 'Cancellation requested', explanation: 'A cancellation is being reviewed. We’ll email you when it’s settled.' }
    case 'cancelled':
      return { label: 'Cancelled', explanation: 'This bounty was cancelled. Contact us if you have questions about your payment.' }
    case 'archived':
      return { label: 'Closed', explanation: 'This bounty is closed and no longer taking applications.' }
    default:
      return { label: 'Status unavailable', explanation: 'We couldn’t read this bounty’s status. Contact us and we’ll check.' }
  }
}

// ── Payment ───────────────────────────────────────────────────────────────

export interface PaymentExplanation {
  state: 'held' | 'releasing' | 'paid_out' | 'refunding' | 'refunded' | 'not_paid' | 'unknown'
  label: string
  explanation: string
}

export function explainPayment(
  payment: { status?: string | null; amount?: number | string | null } | null,
  bounty: { amount?: number | string | null; funding_mode?: string | null; is_for_honor?: boolean | null }
): PaymentExplanation {
  const amount = formatMoney(payment?.amount ?? bounty.amount)
  if (bounty.is_for_honor) {
    return { state: 'not_paid', label: 'No payment', explanation: 'This bounty is for honor, so no money is involved.' }
  }
  switch (payment?.status) {
    case 'captured':
    case 'authorized':
      return {
        state: 'held',
        label: `${amount} held safely`,
        explanation: `You paid ${amount}. Bounty holds it. Your hunter is paid only after you confirm the job is done.`,
      }
    case 'release_pending':
      return { state: 'releasing', label: 'Payment on its way', explanation: `You confirmed the job. ${amount} is on its way to your hunter.` }
    case 'released':
      return { state: 'paid_out', label: 'Paid to your hunter', explanation: `${amount} was sent to your hunter.` }
    case 'failed':
      return {
        state: 'held',
        label: `${amount} still held`,
        explanation: 'We tried to pay your hunter and it didn’t go through. Your money is still held, and our team will sort it out.',
      }
    case 'refund_pending':
      return { state: 'refunding', label: 'Refund on its way', explanation: `${amount} is being refunded to your card. Banks usually take 5–10 business days.` }
    case 'refunded':
      return { state: 'refunded', label: 'Refunded', explanation: `${amount} was refunded to your card.` }
    case 'pending_payment':
    case 'canceled':
      return { state: 'not_paid', label: 'Not paid', explanation: 'No payment was taken for this bounty.' }
    default:
      return {
        state: 'unknown',
        label: 'Payment details',
        explanation: 'We can’t show the payment for this bounty here. Contact us and a person will check it for you.',
      }
  }
}

export function formatMoney(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!isFinite(n)) return 'Your payment'
  return n % 1 === 0 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`
}

// ── Accept ────────────────────────────────────────────────────────────────

export type DecisionOutcome =
  | 'accepted'
  | 'already_accepted'
  | 'declined'
  | 'already_declined'
  | 'assigned_to_other'
  | 'bounty_closed'
  | 'request_closed'
  | 'not_funded'
  | 'not_found'
  | 'retry'

export interface DecisionResult {
  ok: boolean
  outcome: DecisionOutcome
  httpStatus: number
  message: string
}

const MESSAGES: Record<DecisionOutcome, { ok: boolean; httpStatus: number; message: string }> = {
  accepted: { ok: true, httpStatus: 200, message: 'Done — you accepted this hunter. We’ve let them know, and we emailed you a confirmation.' },
  already_accepted: { ok: true, httpStatus: 200, message: 'You already accepted this hunter. Nothing else to do right now.' },
  declined: { ok: true, httpStatus: 200, message: 'Declined. We’ll let them know kindly. Your bounty stays open for others.' },
  already_declined: { ok: true, httpStatus: 200, message: 'This application was already declined or closed.' },
  assigned_to_other: { ok: false, httpStatus: 409, message: 'You already chose a different hunter for this bounty, so this one can’t be accepted.' },
  bounty_closed: { ok: false, httpStatus: 409, message: 'This bounty is no longer open (it may have been cancelled or finished), so nobody new can be accepted.' },
  request_closed: { ok: false, httpStatus: 409, message: 'This application is no longer open — the hunter may have withdrawn or it expired.' },
  not_funded: { ok: false, httpStatus: 402, message: 'We couldn’t accept yet because this bounty’s payment isn’t in place. Nothing was charged. Contact us and we’ll help.' },
  not_found: { ok: false, httpStatus: 404, message: 'We couldn’t find that application on your bounty.' },
  retry: { ok: false, httpStatus: 503, message: 'Something went wrong on our side. Nothing changed — please try again in a moment.' },
}

export function decisionResult(outcome: DecisionOutcome): DecisionResult {
  return { outcome, ...MESSAGES[outcome] }
}

export interface DecisionState {
  request: { id: string; status: string | null; hunter_id: string | null } | null
  bounty: { id: string; status: string | null; accepted_request_id: string | null } | null
}

/**
 * Classifies an accept attempt from the state read AFTER the RPC ran (or
 * failed). Reading state afterwards — rather than parsing error text alone —
 * is what makes the endpoint idempotent and race-safe:
 *
 *   double click / email + web at once  -> second call sees its own request
 *                                          accepted: already_accepted (200)
 *   two different applicants at once    -> loser sees another request on the
 *                                          bounty: assigned_to_other (409)
 *   cancellation racing acceptance      -> bounty not open: bounty_closed
 *   deadlock between those two (40P01)  -> state unchanged: retry (503)
 */
export function classifyAccept(state: DecisionState, rpcError: string | null): DecisionResult {
  const { request, bounty } = state
  if (!request || !bounty) return decisionResult('not_found')

  if (request.status === 'accepted' && bounty.accepted_request_id === request.id) {
    return decisionResult(rpcError ? 'already_accepted' : 'accepted')
  }
  if (bounty.accepted_request_id && bounty.accepted_request_id !== request.id) {
    return decisionResult('assigned_to_other')
  }
  if (bounty.status !== 'open') return decisionResult('bounty_closed')
  if (request.status !== 'pending') return decisionResult('request_closed')

  if (rpcError) {
    if (/insufficient_funds_for_escrow|bounty_not_funded|_locked_by_|funding_mode/i.test(rpcError)) {
      return decisionResult('not_funded')
    }
    return decisionResult('retry')
  }
  // RPC reported success but state doesn't show it: never claim success.
  return decisionResult('retry')
}

/** Decline is a plain conditional update; this classifies its result. */
export function classifyDecline(state: DecisionState, updatedRows: number): DecisionResult {
  const { request, bounty } = state
  if (!request || !bounty) return decisionResult('not_found')
  if (updatedRows > 0) return decisionResult('declined')
  if (request.status === 'rejected') return decisionResult('already_declined')
  if (request.status === 'accepted') {
    return {
      ok: false,
      outcome: 'request_closed',
      httpStatus: 409,
      message: 'You already accepted this hunter. If something’s wrong, contact us and a person will help.',
    }
  }
  return decisionResult('request_closed')
}

// ── Completion ────────────────────────────────────────────────────────────

export type CompletionOutcome =
  | 'paid'
  | 'payment_on_its_way'
  | 'needs_hunter_payout_setup'
  | 'support_will_finish'
  | 'no_submission'
  | 'not_in_progress'
  | 'retry'

export interface CompletionResult {
  ok: boolean
  outcome: CompletionOutcome
  httpStatus: number
  message: string
  /** True when a person must step in; index.ts opens a support case. */
  needsSupport: boolean
}

/**
 * Maps the unchanged bounty-payments/release response to what the poster is
 * told. Their confirmation is recorded either way; only the payout differs.
 */
export function classifyRelease(httpStatus: number, body: Record<string, unknown> | null): CompletionResult {
  const code = typeof body?.code === 'string' ? body.code : ''
  const status = typeof body?.status === 'string' ? body.status : ''
  if (httpStatus === 200 && body?.released === true) {
    return { ok: true, outcome: 'paid', httpStatus: 200, needsSupport: false, message: 'Thank you — you confirmed the job and your hunter has been paid.' }
  }
  if ((httpStatus === 200 || httpStatus === 409) && status === 'release_pending') {
    return { ok: true, outcome: 'payment_on_its_way', httpStatus: 200, needsSupport: false, message: 'Thank you — you confirmed the job. Payment to your hunter is on its way.' }
  }
  if (code === 'hunter_not_onboarded' || code === 'hunter_payouts_disabled') {
    return {
      ok: true,
      outcome: 'needs_hunter_payout_setup',
      httpStatus: 200,
      needsSupport: true,
      message: 'Thank you — you confirmed the job. Your hunter still needs to finish setting up payouts, so your money stays held until they do. Our team will help them finish it. You don’t need to do anything else.',
    }
  }
  if (httpStatus >= 500 || httpStatus === 0) {
    return {
      ok: false,
      outcome: 'retry',
      httpStatus: 503,
      needsSupport: false,
      message: 'You confirmed the job, but we couldn’t start the payment just now. Your money is still held. Please try again in a moment.',
    }
  }
  return {
    ok: true,
    outcome: 'support_will_finish',
    httpStatus: 200,
    needsSupport: true,
    message: 'Thank you — you confirmed the job. A person on our team will finish paying your hunter. Your money stays held until then.',
  }
}

// ── Hunter profile shown to the poster ────────────────────────────────────

export interface HunterSummary {
  id: string
  name: string
  avatar_url: string | null
  member_since: string | null
  id_verified: boolean
  phone_verified: boolean
  rating_average: number | null
  rating_count: number
  completed_jobs: number
  recent_reviews: Array<{ rating: number; comment: string | null; created_at: string }>
}

/**
 * Builds what a poster sees about an applicant from an explicit allowlist.
 * Never copies the profile through: no email, phone, address, coordinates,
 * Stripe or risk fields, even though the service-role read can see them.
 */
export function summarizeHunter(
  profile: Record<string, unknown> | null,
  stats: { rating_avg?: number | string | null; rating_count?: number; hunter_completed?: number } | null,
  reviews: Array<{ rating: number; comment?: string | null; created_at: string }>
): HunterSummary | null {
  if (!profile || typeof profile.id !== 'string') return null
  const avg = stats?.rating_avg == null ? null : Number(stats.rating_avg)
  const ratingAverage = avg !== null && Number.isFinite(avg) ? Math.round(avg * 10) / 10 : null
  const name =
    pickString(profile.display_name) ||
    firstName(pickString(profile.full_name)) ||
    pickString(profile.username) ||
    'Bounty hunter'
  const avatar = pickString(profile.avatar)
  return {
    id: profile.id,
    name,
    avatar_url: avatar && avatar.startsWith('https://') ? avatar : null,
    member_since: pickString(profile.created_at) || null,
    id_verified: profile.id_verification_status === 'verified' || profile.stripe_identity_status === 'verified',
    phone_verified: profile.phone_verified === true,
    rating_average: ratingAverage,
    rating_count: Math.max(0, Math.floor(Number(stats?.rating_count) || 0)),
    completed_jobs: Math.max(0, Math.floor(Number(stats?.hunter_completed) || 0)),
    recent_reviews: reviews
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 3)
      .map((r) => ({ rating: r.rating, comment: r.comment ? String(r.comment).slice(0, 400) : null, created_at: r.created_at })),
  }
}

function pickString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** "Jordan Maglalang" -> "Jordan M." — enough to recognise, not to look up. */
function firstName(full: string): string {
  if (!full) return ''
  const parts = full.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

// ── Support messages ──────────────────────────────────────────────────────

export const SUPPORT_REASONS = ['general', 'not_done', 'quality', 'no_show', 'safety', 'payment', 'other'] as const
export type SupportReason = (typeof SUPPORT_REASONS)[number]

export function normalizeSupportInput(body: Record<string, unknown> | null): {
  reason: SupportReason
  message: string
  phone: string | null
  error?: string
} {
  const reasonRaw = typeof body?.reason === 'string' ? body.reason : 'general'
  const reason = (SUPPORT_REASONS as readonly string[]).includes(reasonRaw) ? (reasonRaw as SupportReason) : 'other'
  const message = typeof body?.message === 'string' ? body.message.replace(/[<>]/g, '').trim().slice(0, 2000) : ''
  // Optional call-back number, offered for people who would rather talk. It
  // goes on the support case only — never into analytics or logs.
  const phoneRaw = typeof body?.phone === 'string' ? body.phone.replace(/[^\d+()\-\s.]/g, '').trim() : ''
  const phone = phoneRaw.replace(/\D/g, '').length >= 7 ? phoneRaw.slice(0, 30) : null
  if (message.length < 3 && !phone) {
    return { reason, message, phone, error: 'Tell us a little about what you need, or leave a number for us to call.' }
  }
  return { reason, message, phone }
}

// A quote is plain text. Anything shaped like a tag (< then a letter, / or !)
// goes whole, a space in its place, so "<p>Great</p><p>job</p>" reads "Great
// job"; then any stray bracket ("under <$50" keeps its words); then runs of
// whitespace. proof_poster_set_consent applies the same rule, and a CHECK on
// bounty_proofs.testimonial holds it for every writer.
export function stripMarkup(s: string): string {
  return s.replace(/<\/?[A-Za-z!][^<>]*>/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()
}

// The "Share your result" form (manage.js, view=share). Shapes the answer for
// proof_poster_set_consent, which re-checks every rule; this only makes the
// common mistakes answerable with a sentence instead of a database error.
// Saying no to the page says no to everything on it.
export function normalizeProofConsentInput(body: Record<string, unknown> | null): {
  shareTask: boolean
  sharePhotos: boolean
  shareTestimonial: boolean
  testimonial: string | null
  attribution: 'anonymous' | 'first_name'
  firstName: string | null
  error?: string
} {
  const shareTask = body?.share_task === true
  const testimonialRaw = typeof body?.testimonial === 'string' ? stripMarkup(body.testimonial) : ''
  const testimonial = shareTask && testimonialRaw ? testimonialRaw : null
  const sharePhotos = shareTask && body?.share_photos === true
  const shareTestimonial = shareTask && body?.share_testimonial === true && testimonial !== null
  const firstNameRaw = typeof body?.first_name === 'string' ? body.first_name.trim() : ''
  const attribution = shareTask && body?.attribution === 'first_name' ? 'first_name' : 'anonymous'
  const firstName = attribution === 'first_name' ? firstNameRaw : null
  const out = { shareTask, sharePhotos, shareTestimonial, testimonial, attribution, firstName } as const

  if (typeof body?.share_task !== 'boolean') return { ...out, error: 'Choose whether we can share this job.' }
  if (testimonial && testimonial.length > 600) return { ...out, error: 'Please keep your words under 600 characters.' }
  if (attribution === 'first_name' && !/^[\p{L}][\p{L}'’ -]{0,29}$/u.test(firstName ?? '')) {
    return { ...out, error: 'Use just a first name (letters only), or choose to stay anonymous.' }
  }
  return out
}
