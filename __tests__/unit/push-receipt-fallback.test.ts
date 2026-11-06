import {
  groupKey,
  groupVerdict,
  parseReceipts,
  planTicketUpdates,
  RECEIPT_GIVE_UP_HOURS,
  RECEIPT_RETRY_MINUTES,
  tokensToPrune,
  type DueTicket,
} from '../../supabase/functions/process-notification/receipt-fallback'

const NOW = new Date('2026-11-06T12:00:00.000Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

const ticket = (id: string, ageMinutes: number, attempts = 0): DueTicket => ({
  ticket_id: id,
  status: 'pending',
  created_at: minutesAgo(ageMinutes),
  attempts,
})

describe('parseReceipts', () => {
  test('reads ok and error receipts keyed by ticket id', () => {
    const map = parseReceipts({
      data: {
        a: { status: 'ok' },
        b: {
          status: 'error',
          message: 'The device cannot receive push notifications anymore',
          details: { error: 'DeviceNotRegistered' },
        },
      },
    })
    expect(map.get('a')).toEqual({ status: 'ok' })
    expect(map.get('b')).toEqual({
      status: 'error',
      code: 'DeviceNotRegistered',
      message: 'The device cannot receive push notifications anymore',
    })
  })

  test('an error with no details is still an error, code unknown', () => {
    expect(parseReceipts({ data: { a: { status: 'error' } } }).get('a')).toEqual({
      status: 'error',
      code: 'unknown',
      message: null,
    })
  })

  test('ids Expo has no receipt for are simply absent', () => {
    expect(parseReceipts({ data: { a: { status: 'ok' } } }).has('missing')).toBe(false)
  })

  test.each([null, undefined, {}, { data: null }, { data: [] }, { data: 'x' }, { data: { a: null } }, { data: { a: { status: 'weird' } } }])(
    'malformed body %j yields nothing, never a false failure',
    (body) => {
      expect(parseReceipts(body).size).toBe(0)
    }
  )

  test('long provider messages are truncated', () => {
    const long = 'x'.repeat(1000)
    const r = parseReceipts({ data: { a: { status: 'error', message: long, details: { error: 'MessageRateExceeded' } } } }).get('a')
    expect(r && r.status === 'error' && r.message?.length).toBe(300)
  })
})

describe('planTicketUpdates', () => {
  test('maps ok and error receipts', () => {
    const receipts = parseReceipts({
      data: { a: { status: 'ok' }, b: { status: 'error', details: { error: 'DeviceNotRegistered' } } },
    })
    const updates = planTicketUpdates([ticket('a', 20), ticket('b', 20)], receipts, NOW)
    expect(updates).toEqual([
      { ticketId: 'a', status: 'ok' },
      { ticketId: 'b', status: 'error', code: 'DeviceNotRegistered', message: null },
    ])
  })

  test('a receipt Expo has not produced yet is retried later, not failed', () => {
    const [u] = planTicketUpdates([ticket('a', 16, 1)], new Map(), NOW)
    expect(u).toEqual({
      ticketId: 'a',
      status: 'pending',
      attempts: 2,
      checkAfter: new Date(NOW.getTime() + RECEIPT_RETRY_MINUTES * 60_000).toISOString(),
    })
  })

  test('a ticket with no receipt after the give-up window expires (unknown, not a failure)', () => {
    const [u] = planTicketUpdates([ticket('a', RECEIPT_GIVE_UP_HOURS * 60 + 1, 30)], new Map(), NOW)
    expect(u).toEqual({ ticketId: 'a', status: 'expired', attempts: 31 })
  })

  test('a receipt that arrives late still counts even past the give-up window', () => {
    const receipts = parseReceipts({ data: { a: { status: 'ok' } } })
    const [u] = planTicketUpdates([ticket('a', RECEIPT_GIVE_UP_HOURS * 60 + 60)], receipts, NOW)
    expect(u.status).toBe('ok')
  })
})

describe('groupVerdict (one recipient, possibly several devices)', () => {
  test('every device failed -> send the email', () => {
    expect(groupVerdict(['error'])).toBe('failed')
    expect(groupVerdict(['error', 'error'])).toBe('failed')
  })

  test('any device delivered -> no email, even if another device failed', () => {
    expect(groupVerdict(['ok'])).toBe('delivered')
    expect(groupVerdict(['error', 'ok'])).toBe('delivered')
    expect(groupVerdict(['ok', 'pending', 'error'])).toBe('delivered')
  })

  test('a device still pending might yet succeed -> wait', () => {
    expect(groupVerdict(['error', 'pending'])).toBe('wait')
  })

  test('a failed device plus an expired one is still a failure', () => {
    expect(groupVerdict(['error', 'expired'])).toBe('failed')
  })

  test('only unknowns -> do not email on a guess', () => {
    expect(groupVerdict(['expired'])).toBe('unknown')
    expect(groupVerdict(['expired', 'expired'])).toBe('unknown')
    expect(groupVerdict([])).toBe('unknown')
  })
})

describe('tokensToPrune', () => {
  const tokens = new Map([
    ['t1', 'ExponentPushToken[a]'],
    ['t2', 'ExponentPushToken[b]'],
    ['t3', 'ExponentPushToken[c]'],
  ])

  test('prunes only DeviceNotRegistered', () => {
    const pruned = tokensToPrune(
      [
        { ticketId: 't1', status: 'error', code: 'DeviceNotRegistered', message: null },
        { ticketId: 't2', status: 'error', code: 'MessageRateExceeded', message: null },
        { ticketId: 't3', status: 'ok' },
      ],
      tokens
    )
    expect(pruned).toEqual(['ExponentPushToken[a]'])
  })

  // 2026-09-25: Expo had no FCM credentials, so EVERY Android push failed with a
  // credentials error. Pruning on it would have deleted every Android token.
  test('credential errors never prune a token', () => {
    const pruned = tokensToPrune(
      [
        { ticketId: 't1', status: 'error', code: 'InvalidCredentials', message: null },
        { ticketId: 't2', status: 'error', code: 'MismatchSenderId', message: null },
      ],
      tokens
    )
    expect(pruned).toEqual([])
  })

  test('a token shared by two tickets is returned once', () => {
    const shared = new Map([
      ['t1', 'ExponentPushToken[a]'],
      ['t2', 'ExponentPushToken[a]'],
    ])
    expect(
      tokensToPrune(
        [
          { ticketId: 't1', status: 'error', code: 'DeviceNotRegistered', message: null },
          { ticketId: 't2', status: 'error', code: 'DeviceNotRegistered', message: null },
        ],
        shared
      )
    ).toEqual(['ExponentPushToken[a]'])
  })
})

test('groupKey separates outbox rows and recipients', () => {
  expect(groupKey('o1', 'u1')).not.toBe(groupKey('o1', 'u2'))
  expect(groupKey('o1', 'u1')).not.toBe(groupKey('o2', 'u1'))
})
