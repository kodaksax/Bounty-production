import {
  acceptedCard,
  appliedCard,
  bountyStage,
  type CardContext,
  hunterNetCents,
  interpretPaymentsRelease,
  interpretWalletRelease,
  payoutCard,
  payoutStageLabel,
  payoutStageV1,
  payoutStageV2,
  payoutStageV3,
  platformFeePercent,
  rateLimited,
  releaseMayStart,
  releaseRoute,
  submittedCard,
  validateMessageText,
} from '../../supabase/functions/web-account/logic'

const ctx = (over: Partial<CardContext> = {}): CardContext => ({
  role: 'poster',
  bountyStatus: 'in_progress',
  isForHonor: false,
  hasActiveDispute: false,
  payoutStage: 'held',
  hunterPayoutReady: true,
  hunterNetCents: 9500,
  ...over,
})

describe('fee', () => {
  it('reads PLATFORM_FEE_PERCENT with the release endpoints’ default', () => {
    expect(platformFeePercent(undefined)).toBe(5)
    expect(platformFeePercent('10')).toBe(10)
  })

  it('mirrors the release arithmetic (fee rounded to the cent, then subtracted)', () => {
    expect(hunterNetCents(100, 5)).toBe(9500)
    expect(hunterNetCents(15, 10)).toBe(1350)
    // bounty-payments v2: fee = round(33.33 * 5) / 100 = 1.67 -> 31.66
    expect(hunterNetCents(33.33, 5)).toBe(3166)
    expect(hunterNetCents(0, 5)).toBe(0)
  })
})

describe('payout stages', () => {
  it('says paid for v2 only when the transfer.created webhook confirmed it', () => {
    expect(payoutStageV2({ status: 'captured' })).toBe('held')
    expect(payoutStageV2({ status: 'release_pending', stripe_transfer_id: 'tr_1' })).toBe('sending')
    expect(payoutStageV2({ status: 'released', stripe_transfer_id: null })).toBe('sending')
    expect(payoutStageV2({ status: 'released', stripe_transfer_id: 'tr_1' })).toBe('paid')
    expect(payoutStageV2({ status: 'failed' })).toBe('failed')
    expect(payoutStageV2({ status: 'refunded' })).toBe('refunded')
    expect(payoutStageV2(null)).toBe('none')
  })

  it('maps v3 funding states, never calling an uncharged authorization refunded', () => {
    expect(payoutStageV3({ state: 'authorized' })).toBe('held')
    expect(payoutStageV3({ state: 'awaiting_hunter_onboarding' })).toBe('waiting_on_hunter')
    expect(payoutStageV3({ state: 'capturing', stripe_transfer_id: 'tr' })).toBe('sending')
    expect(payoutStageV3({ state: 'released', stripe_transfer_id: 'tr' })).toBe('paid')
    expect(payoutStageV3({ state: 'capture_failed' })).toBe('failed')
    expect(payoutStageV3({ state: 'canceled' })).toBe('none')
    expect(payoutStageV3({ state: 'pending_payment' })).toBe('none')
  })

  it('describes a v1 ledger credit as a balance credit, not as paid', () => {
    expect(payoutStageV1(null, true)).toBe('held')
    expect(payoutStageV1({ status: 'completed', settlement_state: 'ledger_only' }, true)).toBe('balance_credited')
    expect(payoutStageV1({ status: 'completed', settlement_state: 'stripe_settled' }, true)).toBe('paid')
    expect(payoutStageV1({ status: 'pending' }, true)).toBe('held')
  })

  it('uses the word Paid only for the paid stage', () => {
    const stages = ['none', 'held', 'waiting_on_hunter', 'sending', 'paid', 'balance_credited', 'failed', 'refunding', 'refunded'] as const
    for (const s of stages) {
      for (const role of ['poster', 'hunter'] as const) {
        expect(/\bpaid\b/i.test(payoutStageLabel(s, role))).toBe(s === 'paid')
      }
    }
  })

  it('allows starting a release only from held, failed or waiting', () => {
    expect(releaseMayStart('held')).toBe(true)
    expect(releaseMayStart('failed')).toBe(true)
    expect(releaseMayStart('waiting_on_hunter')).toBe(true)
    expect(releaseMayStart('sending')).toBe(false)
    expect(releaseMayStart('paid')).toBe(false)
    expect(releaseMayStart('balance_credited')).toBe(false)
  })
})

describe('release routing and responses', () => {
  it('routes by payment_architecture_version', () => {
    expect(releaseRoute(1)).toBe('wallet')
    expect(releaseRoute(2)).toBe('bounty-payments')
    expect(releaseRoute(3)).toBe('bounty-payments')
    expect(releaseRoute(null)).toBeNull()
  })

  it('treats a requested or repeated transfer as sending, a confirmed one as paid', () => {
    expect(interpretPaymentsRelease(200, { status: 'release_pending', transferId: 'tr_1' })).toMatchObject({ ok: true, state: 'sending' })
    expect(interpretPaymentsRelease(409, { status: 'release_pending', transferId: 'tr_1' })).toMatchObject({ ok: true, state: 'sending' })
    expect(interpretPaymentsRelease(200, { status: 'released', transferId: 'tr_1', reused: true })).toMatchObject({ ok: true, state: 'paid' })
  })

  it('recognises every "hunter cannot be paid yet" code, v2 and v3', () => {
    for (const [status, code] of [[400, 'hunter_not_onboarded'], [400, 'hunter_payouts_disabled'], [409, 'payouts_disabled']] as const) {
      expect(interpretPaymentsRelease(status, { code })).toMatchObject({ ok: false, waitingOnHunter: true })
    }
    expect(interpretPaymentsRelease(502, { code: 'transfer_failed', error: 'held safely' })).toMatchObject({
      ok: false,
      waitingOnHunter: false,
      message: 'held safely',
    })
  })

  it('reads wallet releases, including an earlier completed one', () => {
    expect(interpretWalletRelease(200, { success: true, transactionId: 'tx' })).toMatchObject({ ok: true, state: 'balance_credited', transactionId: 'tx' })
    expect(
      interpretWalletRelease(409, { code: 'duplicate_transaction', settlementType: 'release', settlementStatus: 'completed' })
    ).toMatchObject({ ok: true })
    expect(
      interpretWalletRelease(409, { code: 'duplicate_transaction', settlementType: 'refund', settlementStatus: 'completed' })
    ).toMatchObject({ ok: false })
  })
})

describe('cards', () => {
  it('applied: poster accepts or declines, hunter can withdraw, only while open', () => {
    expect(appliedCard({ status: 'pending' }, ctx({ bountyStatus: 'open' })).actions).toEqual(['accept', 'decline'])
    expect(appliedCard({ status: 'pending' }, ctx({ role: 'hunter', bountyStatus: 'open' })).actions).toEqual(['withdraw'])
    expect(appliedCard({ status: 'pending' }, ctx({ role: 'hunter', bountyStatus: 'open' })).label).toMatch(/Pending/)
    expect(appliedCard({ status: 'pending' }, ctx({ bountyStatus: 'in_progress' })).actions).toEqual([])
    expect(appliedCard(null, ctx()).state).toBe('withdrawn')
  })

  it('accepted: the hunter sees the net amount and a payout prompt only when not ready', () => {
    const notReady = acceptedCard(ctx({ role: 'hunter', hunterPayoutReady: false }))
    expect(notReady.actions).toEqual(['setup_payouts'])
    expect(notReady.detail).toMatchObject({ hunter_net_cents: 9500 })
    expect(acceptedCard(ctx({ role: 'hunter', hunterPayoutReady: true })).actions).toEqual([])
    expect(acceptedCard(ctx({ role: 'hunter', hunterPayoutReady: false, isForHonor: true })).actions).toEqual([])
    expect(acceptedCard(ctx()).detail).toMatchObject({ payment: 'held' })
  })

  it('submitted: approve & release plus report while in review', () => {
    const c = submittedCard({ status: 'pending' }, ctx())
    expect(c.state).toBe('in_review')
    expect(c.actions).toEqual(['approve_release', 'report_problem'])
    expect(submittedCard({ status: 'pending' }, ctx({ role: 'hunter' })).actions).toEqual([])
    expect(submittedCard({ status: 'pending' }, ctx({ hasActiveDispute: true })).actions).toEqual([])
  })

  it('submitted: has an approved-not-released state with a release retry', () => {
    const c = submittedCard({ status: 'approved' }, ctx({ payoutStage: 'held' }))
    expect(c.state).toBe('approved_not_released')
    expect(c.actions).toContain('release')
    expect(submittedCard({ status: 'approved' }, ctx({ payoutStage: 'failed' })).state).toBe('approved_not_released')
  })

  it('submitted: shows the poster "waiting on the hunter" when they cannot be paid', () => {
    const poster = submittedCard({ status: 'approved' }, ctx({ hunterPayoutReady: false }))
    expect(poster.state).toBe('approved_waiting_on_hunter')
    expect(poster.label).toMatch(/waiting on the hunter/i)
    expect(poster.actions).toEqual([])
    const hunter = submittedCard({ status: 'approved' }, ctx({ role: 'hunter', payoutStage: 'waiting_on_hunter' }))
    expect(hunter.actions).toEqual(['setup_payouts'])
  })

  it('submitted: done once paid or credited', () => {
    expect(submittedCard({ status: 'approved' }, ctx({ payoutStage: 'paid' })).state).toBe('approved_done')
    expect(submittedCard({ status: 'approved' }, ctx({ payoutStage: 'sending' })).state).toBe('approved_sending')
  })

  it('payout: poster gets the receipt, hunter only their amount and status', () => {
    const receipt = { amount_cents: 10000, fee_cents: 500, hunter_net_cents: 9500 }
    expect(payoutCard(ctx({ payoutStage: 'paid' }), receipt).detail).toEqual(receipt)
    const h = payoutCard(ctx({ role: 'hunter', payoutStage: 'sending' }), receipt)
    expect(h.detail).toEqual({ hunter_net_cents: 9500 })
    expect(h.label).toMatch(/On its way/)
  })
})

describe('stages for My posts / My work', () => {
  const base = {
    role: 'poster' as const,
    bountyStatus: 'open',
    requestStatus: null,
    isAcceptedHunter: false,
    pendingApplications: 0,
    submissionStatus: null,
    hasActiveDispute: false,
    payoutStage: 'held' as const,
    hunterPayoutReady: true,
    isForHonor: false,
  }

  it('poster', () => {
    expect(bountyStage(base).stage).toBe('open')
    expect(bountyStage({ ...base, pendingApplications: 2 }).label).toBe('2 applicants')
    expect(bountyStage({ ...base, bountyStatus: 'in_progress' }).stage).toBe('in_progress')
    expect(bountyStage({ ...base, bountyStatus: 'in_progress', submissionStatus: 'pending' }).stage).toBe('in_review')
    expect(bountyStage({ ...base, bountyStatus: 'in_progress', submissionStatus: 'approved', payoutStage: 'paid' }).label).toBe('Paid')
    expect(bountyStage({ ...base, bountyStatus: 'in_progress', hasActiveDispute: true }).stage).toBe('problem_reported')
  })

  it('hunter', () => {
    const h = { ...base, role: 'hunter' as const }
    expect(bountyStage({ ...h, requestStatus: 'pending' }).stage).toBe('applied')
    expect(bountyStage({ ...h, requestStatus: 'rejected' }).stage).toBe('not_selected')
    expect(bountyStage({ ...h, bountyStatus: 'in_progress', requestStatus: 'pending' }).stage).toBe('closed')
    expect(bountyStage({ ...h, bountyStatus: 'in_progress', isAcceptedHunter: true }).label).toBe('Working on it')
    expect(
      bountyStage({ ...h, bountyStatus: 'in_progress', isAcceptedHunter: true, submissionStatus: 'approved', payoutStage: 'balance_credited' }).label
    ).toBe('Added to your Bounty balance')
  })
})

describe('messages', () => {
  it('validates text', () => {
    expect(validateMessageText('  hi  ')).toEqual({ ok: true, text: 'hi' })
    expect(validateMessageText('   ').ok).toBe(false)
    expect(validateMessageText('x'.repeat(2001)).ok).toBe(false)
    expect(validateMessageText(42).ok).toBe(false)
  })

  it('rate-limits per minute and per hour', () => {
    expect(rateLimited(9, 50)).toBe(false)
    expect(rateLimited(10, 50)).toBe(true)
    expect(rateLimited(0, 120)).toBe(true)
  })
})
