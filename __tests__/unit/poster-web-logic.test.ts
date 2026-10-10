import {
  classifyAccept,
  classifyDecline,
  classifyRelease,
  explainBountyStatus,
  explainPayment,
  formatMoney,
  normalizeSupportInput,
  summarizeHunter,
  type DecisionState,
} from '../../supabase/functions/poster-web/logic'

const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'

const state = (reqStatus: string, bountyStatus: string, acceptedRequestId: string | null, reqId = R1): DecisionState => ({
  request: { id: reqId, status: reqStatus, hunter_id: 'h1' },
  bounty: { id: B, status: bountyStatus, accepted_request_id: acceptedRequestId },
})

describe('classifyAccept — atomic, idempotent, race-safe outcomes', () => {
  test('a clean accept', () => {
    const r = classifyAccept(state('accepted', 'in_progress', R1), null)
    expect(r).toMatchObject({ ok: true, outcome: 'accepted', httpStatus: 200 })
  })

  // Double click, or the email link and the web page used at once: the second
  // call's RPC fails (request_not_pending) but its own request is the accepted one.
  test('a duplicate accept is a calm success, not an error', () => {
    const r = classifyAccept(state('accepted', 'in_progress', R1), 'request_not_pending')
    expect(r).toMatchObject({ ok: true, outcome: 'already_accepted', httpStatus: 200 })
  })

  // Only one hunter per bounty.
  test('accepting a second applicant after one is chosen is refused', () => {
    const r = classifyAccept(state('rejected', 'in_progress', R2), 'request_not_pending')
    expect(r).toMatchObject({ ok: false, outcome: 'assigned_to_other', httpStatus: 409 })
  })

  test('cancellation winning the race against acceptance', () => {
    const r = classifyAccept(state('rejected', 'cancelled', null), 'bounty_not_open')
    expect(r).toMatchObject({ ok: false, outcome: 'bounty_closed', httpStatus: 409 })
    expect(r.message).toMatch(/no longer open/)
  })

  test('accepting on a completed or archived bounty', () => {
    expect(classifyAccept(state('pending', 'completed', null), 'bounty_not_open').outcome).toBe('bounty_closed')
    expect(classifyAccept(state('pending', 'archived', null), 'bounty_not_open').outcome).toBe('bounty_closed')
  })

  test('the hunter withdrew or the request expired', () => {
    expect(classifyAccept(state('rejected', 'open', null), 'request_not_pending').outcome).toBe('request_closed')
  })

  // A deadlock (40P01) between accept and a concurrent close rolls back
  // everything; state is unchanged, so the honest answer is "try again".
  test('a rolled-back transaction leaves state unchanged and asks for a retry', () => {
    const r = classifyAccept(state('pending', 'open', null), 'deadlock detected')
    expect(r).toMatchObject({ ok: false, outcome: 'retry', httpStatus: 503 })
    expect(r.message).toMatch(/Nothing changed/)
  })

  test('pay-at-accept funding failures say nothing was charged', () => {
    const r = classifyAccept(state('pending', 'open', null), 'insufficient_funds_for_escrow')
    expect(r).toMatchObject({ ok: false, outcome: 'not_funded', httpStatus: 402 })
    expect(r.message).toMatch(/Nothing was charged/)
  })

  test('never claims success the database does not show', () => {
    expect(classifyAccept(state('pending', 'open', null), null).outcome).toBe('retry')
  })

  test('unknown request or bounty', () => {
    expect(classifyAccept({ request: null, bounty: null }, 'request_not_found').httpStatus).toBe(404)
  })
})

describe('classifyDecline', () => {
  test('declined', () => {
    expect(classifyDecline(state('rejected', 'open', null), 1)).toMatchObject({ ok: true, outcome: 'declined' })
  })
  test('a repeat decline is a no-op success', () => {
    expect(classifyDecline(state('rejected', 'open', null), 0)).toMatchObject({ ok: true, outcome: 'already_declined' })
  })
  test('cannot decline someone already accepted', () => {
    const r = classifyDecline(state('accepted', 'in_progress', R1), 0)
    expect(r).toMatchObject({ ok: false, httpStatus: 409 })
    expect(r.message).toMatch(/already accepted/)
  })
})

describe('classifyRelease — what the poster is told after confirming', () => {
  test('paid', () => {
    expect(classifyRelease(200, { released: true, status: 'released' })).toMatchObject({ outcome: 'paid', needsSupport: false })
  })
  test('transfer requested, awaiting Stripe (the 409 reuse response too)', () => {
    expect(classifyRelease(200, { released: false, status: 'release_pending' }).outcome).toBe('payment_on_its_way')
    expect(classifyRelease(409, { status: 'release_pending', reused: true }).outcome).toBe('payment_on_its_way')
  })
  // Most hunters have not finished Connect onboarding (2026-10-08).
  test('hunter not payout-ready: confirmation stands, money held, a person follows up', () => {
    for (const code of ['hunter_not_onboarded', 'hunter_payouts_disabled']) {
      const r = classifyRelease(400, { code })
      expect(r).toMatchObject({ ok: true, outcome: 'needs_hunter_payout_setup', needsSupport: true })
      expect(r.message).toMatch(/money stays held/)
    }
  })
  test('server or network trouble asks for a retry and says money is held', () => {
    for (const status of [0, 500, 503]) {
      const r = classifyRelease(status, null)
      expect(r).toMatchObject({ ok: false, outcome: 'retry' })
      expect(r.message).toMatch(/still held/)
    }
  })
  test('any other refusal is handed to a person, never shown as paid', () => {
    const r = classifyRelease(409, { code: 'invalid_status', status: 'refunded' })
    expect(r).toMatchObject({ outcome: 'support_will_finish', needsSupport: true })
  })
})

describe('explainPayment — accurate, plain English', () => {
  test('a web-posted bounty: paid up front and held until the poster confirms', () => {
    const p = explainPayment({ status: 'captured', amount: '35.00' }, { amount: 35, funding_mode: 'at_post' })
    expect(p.state).toBe('held')
    expect(p.label).toBe('$35 held safely')
    expect(p.explanation).toMatch(/paid only after you confirm/)
  })
  test('refunds, releases and unknowns', () => {
    expect(explainPayment({ status: 'refunded', amount: 35 }, {}).state).toBe('refunded')
    expect(explainPayment({ status: 'release_pending', amount: 35 }, {}).state).toBe('releasing')
    expect(explainPayment({ status: 'released', amount: 35 }, {}).state).toBe('paid_out')
    // App-wallet bounties have no bounty_payments row: never invent a story.
    const unknown = explainPayment(null, { amount: 20, funding_mode: 'at_accept' })
    expect(unknown.state).toBe('unknown')
    expect(unknown.explanation).toMatch(/Contact us/)
  })
  test('never tells a web customer to open the app', () => {
    for (const status of ['captured', 'release_pending', 'released', 'failed', 'refund_pending', 'refunded', null]) {
      expect(explainPayment({ status, amount: 35 }, {}).explanation).not.toMatch(/\bapp\b/i)
    }
  })
  test('formatMoney', () => {
    expect(formatMoney('35.00')).toBe('$35')
    expect(formatMoney(12.5)).toBe('$12.50')
    expect(formatMoney('x')).toBe('Your payment')
  })
})

describe('explainBountyStatus', () => {
  test('open with and without applicants', () => {
    expect(explainBountyStatus('open', { pendingApplicants: 0, hasSubmission: false }).label).toMatch(/Waiting/)
    expect(explainBountyStatus('open', { pendingApplicants: 1, hasSubmission: false }).label).toBe('1 person wants this job')
    expect(explainBountyStatus('open', { pendingApplicants: 4, hasSubmission: false }).label).toBe('4 people want this job')
  })
  test('in progress, before and after the hunter marks it done', () => {
    expect(explainBountyStatus('in_progress', { pendingApplicants: 0, hasSubmission: false }).label).toMatch(/on the job/)
    expect(explainBountyStatus('in_progress', { pendingApplicants: 0, hasSubmission: true }).label).toMatch(/marked done/)
  })
  test('every status has words, and none sends people to the app', () => {
    for (const s of ['open', 'in_progress', 'completed', 'cancelled', 'cancellation_requested', 'archived', 'weird', null]) {
      const e = explainBountyStatus(s, { pendingApplicants: 0, hasSubmission: false })
      expect(e.label.length).toBeGreaterThan(0)
      expect(e.explanation).not.toMatch(/\bapp\b/i)
    }
  })
})

describe('summarizeHunter — only what a poster should see', () => {
  const profile = {
    id: 'h1',
    full_name: 'Jordan Maglalang',
    username: 'jm',
    email: 'jordan@example.com',
    phone: '555-0100',
    latitude: 38.8,
    longitude: -77.1,
    stripe_connect_account_id: 'acct_123',
    risk_score: 80,
    avatar: 'https://cdn.example/a.png',
    created_at: '2026-01-01T00:00:00Z',
    id_verification_status: 'verified',
    phone_verified: true,
  }
  const ratings = [
    { rating: 5, comment: 'Great', created_at: '2026-09-01T00:00:00Z' },
    { rating: 4, comment: null, created_at: '2026-09-10T00:00:00Z' },
    { rating: 1, comment: 'hidden spam', created_at: '2026-09-11T00:00:00Z', hidden_at: '2026-09-12T00:00:00Z' },
  ]

  test('allowlisted fields, with verification and reviews', () => {
    const h = summarizeHunter(profile, ratings, 7)!
    expect(h.name).toBe('Jordan M.')
    expect(h.id_verified).toBe(true)
    expect(h.phone_verified).toBe(true)
    expect(h.rating_average).toBe(4.5)
    expect(h.rating_count).toBe(2)
    expect(h.completed_jobs).toBe(7)
    expect(h.recent_reviews[0].created_at).toBe('2026-09-10T00:00:00Z')
  })

  test('no contact, location, payment or risk data ever leaves', () => {
    const json = JSON.stringify(summarizeHunter(profile, ratings, 7))
    for (const leaked of ['jordan@example.com', '555-0100', '38.8', '-77.1', 'acct_123', 'risk', 'Maglalang', 'hidden spam']) {
      expect(json).not.toContain(leaked)
    }
  })

  test('a non-https avatar is dropped; a missing profile is null', () => {
    expect(summarizeHunter({ ...profile, avatar: 'javascript:alert(1)' }, [], 0)!.avatar_url).toBeNull()
    expect(summarizeHunter(null, [], 0)).toBeNull()
  })
})

describe('normalizeSupportInput', () => {
  test('a message, or just a call-back number, is enough', () => {
    expect(normalizeSupportInput({ reason: 'not_done', message: 'They never came' }).error).toBeUndefined()
    expect(normalizeSupportInput({ phone: '(703) 555-0100' })).toMatchObject({ phone: '(703) 555-0100' })
  })
  test('empty input asks for something, unknown reasons become other', () => {
    expect(normalizeSupportInput({ message: '' }).error).toBeTruthy()
    expect(normalizeSupportInput({ reason: 'drop table', message: 'hello' }).reason).toBe('other')
  })
  test('markup is stripped and length capped', () => {
    const r = normalizeSupportInput({ message: '<script>x</script>' + 'a'.repeat(5000) })
    expect(r.message).not.toMatch(/[<>]/)
    expect(r.message.length).toBeLessThanOrEqual(2000)
  })
})
