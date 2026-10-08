// Pure rules for the web-account function: stages, payout states, event-card
// state and the actions each side may take. Dependency-free so they are
// unit-tested (__tests__/unit/web-account-logic.test.ts) and index.ts only
// orchestrates I/O.
//
// Nothing here moves money or decides a fee: the fee percent comes from the
// same PLATFORM_FEE_PERCENT the release endpoints read, and the arithmetic in
// hunterNetCents() mirrors theirs line for line.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

// ─── Fee ──────────────────────────────────────────────────────────────────

/**
 * The platform fee percent, read exactly as bounty-payments and wallet read
 * it (`Number(env ?? '5')`), so the amount shown is the amount released.
 */
export function platformFeePercent(raw: string | undefined | null): number {
  return Number(raw ?? '5')
}

/**
 * What the hunter receives, in cents. Mirrors bounty-payments /release (v2:
 * fee rounded to the cent, then subtracted; v3: the same in integer cents)
 * and wallet /release (v1, same as v2).
 */
export function hunterNetCents(amountDollars: number, feePercent: number): number {
  const amountCents = Math.round(Number(amountDollars || 0) * 100)
  const feeCents = Math.round((amountCents * feePercent) / 100)
  return amountCents - feeCents
}

// ─── Payout state ─────────────────────────────────────────────────────────

/**
 * The web's payout vocabulary. "paid" is used only when a Stripe object
 * confirms the transfer (ADR 0001, _shared/settlement-state.ts):
 *  - v2: bounty_payments.status = 'released' AND stripe_transfer_id, which
 *    only the transfer.created webhook sets;
 *  - v3: bounty_v3_funding.state = 'released' AND stripe_transfer_id;
 *  - v1: the release ledger row's settlement_state = 'stripe_settled'.
 * A v1 credit to the in-app balance is "balance_credited", never "paid".
 */
export type PayoutStage =
  | 'none' //            nothing funded (for honor, or no payment record)
  | 'held' //            funded and held, not released
  | 'waiting_on_hunter' // approved, but the hunter cannot receive a payout yet
  | 'sending' //         transfer requested, Stripe has not confirmed it
  | 'paid' //            Stripe confirmed the transfer
  | 'balance_credited' // v1: added to the hunter's Bounty balance
  | 'failed' //          Stripe rejected the transfer; a retry is possible
  | 'refunding'
  | 'refunded'

export interface V2Payment {
  status: string
  stripe_transfer_id?: string | null
}

export function payoutStageV2(bp: V2Payment | null): PayoutStage {
  if (!bp) return 'none'
  switch (bp.status) {
    case 'authorized':
    case 'captured':
      return 'held'
    case 'release_pending':
      return 'sending'
    case 'released':
      return bp.stripe_transfer_id ? 'paid' : 'sending'
    case 'failed':
      return 'failed'
    case 'refund_pending':
      return 'refunding'
    case 'refunded':
      return 'refunded'
    default:
      return 'held'
  }
}

export interface V3Funding {
  state: string
  stripe_transfer_id?: string | null
}

export function payoutStageV3(f: V3Funding | null): PayoutStage {
  if (!f) return 'none'
  switch (f.state) {
    case 'released':
      return f.stripe_transfer_id ? 'paid' : 'sending'
    case 'capturing':
      return 'sending'
    case 'awaiting_hunter_onboarding':
      return 'waiting_on_hunter'
    case 'capture_failed':
      return 'failed'
    case 'refunded':
      return 'refunded'
    case 'authorized':
      return 'held'
    default:
      // pending_payment, expired, canceled: the card was never charged (a
      // cancelled authorization is released, not refunded).
      return 'none'
  }
}

export interface V1Release {
  status: string
  settlement_state?: string | null
}

/** v1: `release` is the bounty's release ledger row, if any. */
export function payoutStageV1(release: V1Release | null, funded: boolean): PayoutStage {
  if (!release || release.status !== 'completed') return funded ? 'held' : 'none'
  return release.settlement_state === 'stripe_settled' ? 'paid' : 'balance_credited'
}

export function payoutStageLabel(stage: PayoutStage, role: Role): string {
  const poster: Record<PayoutStage, string> = {
    none: 'No payment',
    held: 'Payment held',
    waiting_on_hunter: 'Waiting on the hunter’s payout setup',
    sending: 'Sent — waiting for Stripe to confirm',
    paid: 'Paid',
    balance_credited: 'Added to the hunter’s Bounty balance',
    failed: 'Transfer failed — payment still held',
    refunding: 'Refund in progress',
    refunded: 'Refunded',
  }
  const hunter: Record<PayoutStage, string> = {
    none: 'No payment',
    held: 'Payment held until the work is approved',
    waiting_on_hunter: 'Approved — set up payouts to receive your money',
    sending: 'On its way — waiting for Stripe to confirm',
    paid: 'Paid',
    balance_credited: 'Added to your Bounty balance',
    failed: 'Transfer failed — your payment is still held',
    refunding: 'Refunded to the poster',
    refunded: 'Refunded to the poster',
  }
  return (role === 'poster' ? poster : hunter)[stage]
}

/** Payout states from which the poster may (re)start a release. */
export function releaseMayStart(stage: PayoutStage): boolean {
  return stage === 'held' || stage === 'failed' || stage === 'waiting_on_hunter'
}

// ─── Release responses ────────────────────────────────────────────────────

export type ReleaseOutcome =
  | { ok: true; state: 'paid' | 'sending' | 'balance_credited'; transferId: string | null; transactionId: string | null }
  | { ok: false; waitingOnHunter: boolean; code: string; message: string; httpStatus: number }

/** Codes a release returns when the hunter cannot receive a payout yet (v2 and v3 differ). */
export const HUNTER_PAYOUT_SETUP_CODES = ['hunter_not_onboarded', 'hunter_payouts_disabled', 'payouts_disabled']

/** Reads a bounty-payments /release response (v2 and v3). */
export function interpretPaymentsRelease(httpStatus: number, body: any): ReleaseOutcome {
  const status = typeof body?.status === 'string' ? body.status : null
  const transferId = typeof body?.transferId === 'string' && body.transferId ? body.transferId : null

  if (status === 'released' && transferId) {
    return { ok: true, state: 'paid', transferId, transactionId: null }
  }
  // 200 for a new request; 409 when the same transfer was already requested.
  if (status === 'release_pending' && transferId && (httpStatus === 200 || httpStatus === 409)) {
    return { ok: true, state: 'sending', transferId, transactionId: null }
  }
  return releaseFailure(httpStatus, body)
}

/** Reads a wallet /release response (v1). */
export function interpretWalletRelease(httpStatus: number, body: any): ReleaseOutcome {
  if (httpStatus === 200 && body?.success === true) {
    return {
      ok: true,
      state: 'balance_credited',
      transferId: null,
      transactionId: typeof body.transactionId === 'string' ? body.transactionId : null,
    }
  }
  // Already released earlier: the ledger row exists and is completed.
  if (
    body?.code === 'duplicate_transaction' &&
    body?.settlementType === 'release' &&
    body?.settlementStatus === 'completed'
  ) {
    return { ok: true, state: 'balance_credited', transferId: null, transactionId: null }
  }
  return releaseFailure(httpStatus, body)
}

function releaseFailure(httpStatus: number, body: any): ReleaseOutcome {
  const code = typeof body?.code === 'string' ? body.code : `http_${httpStatus}`
  const waitingOnHunter = HUNTER_PAYOUT_SETUP_CODES.includes(code)
  const serverMessage = typeof body?.error === 'string' ? body.error.trim() : ''
  return {
    ok: false,
    waitingOnHunter,
    code,
    message: waitingOnHunter
      ? 'The hunter needs to finish their payout setup before they can be paid. We’ve let them know. Your payment stays held until then.'
      : serverMessage || 'We couldn’t release the payment. Nothing was sent. Please try again.',
    httpStatus: httpStatus >= 400 && httpStatus < 600 ? httpStatus : 502,
  }
}

/** Which release endpoint a bounty uses, by bounties.payment_architecture_version. */
export function releaseRoute(version: number | null | undefined): 'wallet' | 'bounty-payments' | null {
  const v = Number(version)
  if (v === 1) return 'wallet'
  if (v === 2 || v === 3) return 'bounty-payments'
  return null
}

// ─── Event cards ──────────────────────────────────────────────────────────

export type Role = 'poster' | 'hunter'
export type EventType = 'applied' | 'accepted' | 'submitted' | 'payout'
export const EVENT_TYPES: EventType[] = ['applied', 'accepted', 'submitted', 'payout']

export type CardAction =
  | 'accept'
  | 'decline'
  | 'withdraw'
  | 'setup_payouts'
  | 'approve_release' // approve the submitted work and release
  | 'release' //         already approved; (re)start the release
  | 'report_problem'

export interface CardContext {
  role: Role
  bountyStatus: string
  isForHonor: boolean
  hasActiveDispute: boolean
  payoutStage: PayoutStage
  hunterPayoutReady: boolean | null
  hunterNetCents: number
}

export interface Card {
  event: EventType
  state: string
  label: string
  actions: CardAction[]
  detail?: Record<string, unknown>
}

/** Applied: `request` is null once the hunter withdrew (the row is deleted). */
export function appliedCard(request: { status: string } | null, ctx: CardContext): Card {
  const state = request ? request.status : 'withdrawn'
  const actions: CardAction[] = []
  if (state === 'pending' && ctx.bountyStatus === 'open') {
    if (ctx.role === 'poster') actions.push('accept', 'decline')
    else actions.push('withdraw')
  }
  const labels: Record<string, [string, string]> = {
    pending: ['Wants this job', 'Pending — waiting on the poster'],
    accepted: ['Accepted', 'Accepted'],
    rejected: ['Declined', 'Not selected'],
    withdrawn: ['Withdrew their application', 'You withdrew'],
  }
  const pair = labels[state] ?? [state, state]
  return { event: 'applied', state, label: ctx.role === 'poster' ? pair[0] : pair[1], actions }
}

export function acceptedCard(ctx: CardContext): Card {
  if (ctx.role === 'hunter') {
    const actions: CardAction[] =
      !ctx.isForHonor && ctx.hunterPayoutReady === false ? ['setup_payouts'] : []
    return {
      event: 'accepted',
      state: 'accepted',
      label: ctx.isForHonor ? 'You got the job' : 'You got the job — you’ll receive',
      actions,
      detail: ctx.isForHonor ? {} : { hunter_net_cents: ctx.hunterNetCents, payouts_ready: ctx.hunterPayoutReady },
    }
  }
  return {
    event: 'accepted',
    state: 'accepted',
    label: 'You accepted this hunter',
    actions: [],
    detail: { payment: ctx.isForHonor ? 'none' : ctx.payoutStage, payment_label: payoutStageLabel(ctx.payoutStage, 'poster') },
  }
}

export type SubmittedState =
  | 'in_review'
  | 'changes_requested'
  | 'rejected'
  | 'approved_not_released'
  | 'approved_waiting_on_hunter'
  | 'approved_sending'
  | 'approved_done'

export function submittedState(submissionStatus: string, ctx: CardContext): SubmittedState {
  if (submissionStatus === 'pending') return 'in_review'
  if (submissionStatus === 'revision_requested') return 'changes_requested'
  if (submissionStatus !== 'approved') return 'rejected'
  if (ctx.isForHonor) return 'approved_done'
  switch (ctx.payoutStage) {
    case 'paid':
    case 'balance_credited':
    case 'refunding':
    case 'refunded':
      return 'approved_done'
    case 'sending':
      return 'approved_sending'
    case 'waiting_on_hunter':
      return 'approved_waiting_on_hunter'
    default:
      // held / failed / none: approved, nothing released yet. If the hunter
      // still cannot receive a payout, say so instead of offering a retry
      // that would only fail again.
      return ctx.hunterPayoutReady === false ? 'approved_waiting_on_hunter' : 'approved_not_released'
  }
}

export function submittedCard(submission: { status: string } | null, ctx: CardContext): Card {
  if (!submission) return { event: 'submitted', state: 'missing', label: 'Submission removed', actions: [] }
  const state = submittedState(submission.status, ctx)
  const actions: CardAction[] = []
  if (ctx.role === 'poster' && !ctx.hasActiveDispute) {
    if (state === 'in_review') actions.push('approve_release', 'report_problem')
    else if (state === 'approved_not_released') actions.push('release', 'report_problem')
  }
  if (ctx.role === 'hunter' && state === 'approved_waiting_on_hunter') actions.push('setup_payouts')

  const poster: Record<SubmittedState, string> = {
    in_review: 'Ready for your review',
    changes_requested: 'You asked for changes',
    rejected: 'Not approved',
    approved_not_released: 'Approved — payment not released yet',
    approved_waiting_on_hunter: 'Approved — waiting on the hunter',
    approved_sending: 'Approved — payment sent',
    approved_done: 'Approved',
  }
  const hunter: Record<SubmittedState, string> = {
    in_review: 'In review',
    changes_requested: 'Changes requested',
    rejected: 'Not approved',
    approved_not_released: 'Approved — payment being released',
    approved_waiting_on_hunter: 'Approved — set up payouts to receive your money',
    approved_sending: 'Approved — payment on its way',
    approved_done: 'Approved',
  }
  return {
    event: 'submitted',
    state,
    label: (ctx.role === 'poster' ? poster : hunter)[state],
    actions,
    detail: ctx.hasActiveDispute ? { dispute: true } : {},
  }
}

export function payoutCard(ctx: CardContext, receipt: Record<string, unknown>): Card {
  return {
    event: 'payout',
    state: ctx.payoutStage,
    label: payoutStageLabel(ctx.payoutStage, ctx.role),
    actions: [],
    // Poster: a receipt. Hunter: what they receive and its status.
    detail: ctx.role === 'poster' ? receipt : { hunter_net_cents: receipt.hunter_net_cents },
  }
}

// ─── Stages for My posts / My work ────────────────────────────────────────

export interface StageInput {
  role: Role
  bountyStatus: string
  requestStatus: string | null // hunter: my application, if any
  isAcceptedHunter: boolean // hunter: bounties.accepted_by = me
  pendingApplications: number // poster
  submissionStatus: string | null // latest submission for the accepted hunter
  hasActiveDispute: boolean
  payoutStage: PayoutStage
  hunterPayoutReady: boolean | null
  isForHonor: boolean
}

export function bountyStage(i: StageInput): { stage: string; label: string } {
  const S = (stage: string, label: string) => ({ stage, label })
  if (i.role === 'hunter' && !i.isAcceptedHunter) {
    if (i.requestStatus === 'rejected') return S('not_selected', 'Not selected')
    if (i.bountyStatus !== 'open') return S('closed', 'Closed')
    return S('applied', 'Applied')
  }
  if (['cancelled', 'archived', 'deleted', 'cancellation_requested'].includes(i.bountyStatus)) {
    return S('closed', i.bountyStatus === 'cancellation_requested' ? 'Cancellation requested' : 'Closed')
  }
  if (i.hasActiveDispute) return S('problem_reported', 'Problem reported')
  if (i.bountyStatus === 'open') {
    return i.pendingApplications > 0
      ? S('applications', i.pendingApplications === 1 ? '1 applicant' : `${i.pendingApplications} applicants`)
      : S('open', 'Taking applications')
  }
  const ctx: CardContext = {
    role: i.role,
    bountyStatus: i.bountyStatus,
    isForHonor: i.isForHonor,
    hasActiveDispute: i.hasActiveDispute,
    payoutStage: i.payoutStage,
    hunterPayoutReady: i.hunterPayoutReady,
    hunterNetCents: 0,
  }
  if (i.submissionStatus) {
    const st = submittedState(i.submissionStatus, ctx)
    if (st === 'approved_done') {
      if (i.isForHonor) return S('done', 'Done')
      return S(i.payoutStage, payoutStageLabel(i.payoutStage, i.role))
    }
    const card = submittedCard({ status: i.submissionStatus }, ctx)
    return S(st, card.label)
  }
  if (i.bountyStatus === 'completed') return S('done', 'Done')
  return S('in_progress', i.role === 'poster' ? 'Work in progress' : 'Working on it')
}

// ─── Messages ─────────────────────────────────────────────────────────────

export const MAX_MESSAGE_LENGTH = 2000
export const RATE_LIMIT_PER_MINUTE = 10
export const RATE_LIMIT_PER_HOUR = 120

export function validateMessageText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { ok: false, error: 'Write a message first.' }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Messages can be up to ${MAX_MESSAGE_LENGTH} characters.` }
  }
  return { ok: true, text }
}

export function rateLimited(lastMinute: number, lastHour: number): boolean {
  return lastMinute >= RATE_LIMIT_PER_MINUTE || lastHour >= RATE_LIMIT_PER_HOUR
}
