import {
  deriveStage,
  hunterPayout,
  interpretReleaseResponse,
  isHunterPayoutSetupFailure,
  isUuid,
  parseProofItems,
  reviewDeadline,
  validateDisputeInput,
} from '../../supabase/functions/poster-web/logic'

const SUPABASE_URL = 'https://proj.supabase.co'
const PUBLIC = `${SUPABASE_URL}/storage/v1/object/public/bounty-attachments`

describe('deriveStage', () => {
  const base = { hasActiveDispute: false, latestSubmissionStatus: null }
  test('maps bounty status and submission to the poster-facing stage', () => {
    expect(deriveStage({ ...base, bountyStatus: 'open' })).toBe('open')
    expect(deriveStage({ ...base, bountyStatus: 'in_progress' })).toBe('in_progress')
    expect(deriveStage({ ...base, bountyStatus: 'in_progress', latestSubmissionStatus: 'pending' })).toBe('review')
    expect(deriveStage({ ...base, bountyStatus: 'in_progress', latestSubmissionStatus: 'revision_requested' })).toBe(
      'in_progress'
    )
    expect(deriveStage({ ...base, bountyStatus: 'completed' })).toBe('completed')
    expect(deriveStage({ ...base, bountyStatus: 'cancelled' })).toBe('closed')
  })
  test('an active dispute wins over review, but not over completed', () => {
    expect(
      deriveStage({ bountyStatus: 'in_progress', hasActiveDispute: true, latestSubmissionStatus: 'pending' })
    ).toBe('disputed')
    expect(deriveStage({ bountyStatus: 'completed', hasActiveDispute: true, latestSubmissionStatus: null })).toBe(
      'completed'
    )
  })
})

describe('interpretReleaseResponse', () => {
  test('a new v2 transfer (200 release_pending with a transfer id) is a success', () => {
    expect(interpretReleaseResponse(200, { released: false, transferId: 'tr_1', status: 'release_pending' })).toEqual({
      ok: true,
      status: 'release_pending',
      transferId: 'tr_1',
    })
  })
  test('a retry after a lost write (409 release_pending, same transfer) is a success', () => {
    const out = interpretReleaseResponse(409, { transferId: 'tr_1', status: 'release_pending', reused: true })
    expect(out.ok).toBe(true)
  })
  test('already released is a success', () => {
    expect(interpretReleaseResponse(200, { released: true, transferId: 'tr_1', status: 'released' }).ok).toBe(true)
  })
  test('release_pending without a transfer id is not trusted', () => {
    expect(interpretReleaseResponse(200, { status: 'release_pending' }).ok).toBe(false)
  })
  test('a hunter without payout setup gets the setup message', () => {
    const out = interpretReleaseResponse(400, { code: 'hunter_not_onboarded', error: 'raw' })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('hunter_not_onboarded')
      expect(out.message).toMatch(/payout setup/)
      expect(isHunterPayoutSetupFailure(out.code)).toBe(true)
    }
  })
  test('other failures keep the server message and status', () => {
    const out = interpretReleaseResponse(409, { code: 'invalid_status', error: 'Cannot release in status "refunded".' })
    expect(out).toEqual({
      ok: false,
      code: 'invalid_status',
      message: 'Cannot release in status "refunded".',
      httpStatus: 409,
    })
  })
  test('an unreadable body is a failure', () => {
    const out = interpretReleaseResponse(502, null)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('http_502')
  })
})

describe('parseProofItems', () => {
  test('reads the stringified array the app stores and keeps only public project files', () => {
    const raw = JSON.stringify([
      { id: 'a', type: 'image', name: 'IMG_1.png', remoteUri: `${PUBLIC}/x/1.png`, uri: 'file:///var/1.png' },
      { id: 'b', type: 'file', name: 'notes.pdf', url: `${PUBLIC}/x/notes.pdf` },
      { id: 'c', type: 'image', name: 'local.png', uri: 'file:///var/local.png' },
      { id: 'd', type: 'image', name: 'elsewhere.png', remoteUri: 'https://evil.example/x.png' },
    ])
    expect(parseProofItems(raw, SUPABASE_URL)).toEqual([
      { name: 'IMG_1.png', type: 'image', url: `${PUBLIC}/x/1.png` },
      { name: 'notes.pdf', type: 'file', url: `${PUBLIC}/x/notes.pdf` },
    ])
  })
  test('accepts a real array and tolerates junk', () => {
    expect(parseProofItems([{ type: 'image', remoteUri: `${PUBLIC}/y.png` }], `${SUPABASE_URL}/`)).toEqual([
      { name: 'Attachment', type: 'image', url: `${PUBLIC}/y.png` },
    ])
    expect(parseProofItems('not json', SUPABASE_URL)).toEqual([])
    expect(parseProofItems(null, SUPABASE_URL)).toEqual([])
    expect(parseProofItems('{"a":1}', SUPABASE_URL)).toEqual([])
  })
})

describe('validateDisputeInput', () => {
  test('requires a reason of at least 10 characters', () => {
    expect(validateDisputeInput({ reason: 'bad' }).ok).toBe(false)
    expect(validateDisputeInput({}).ok).toBe(false)
  })
  test('accepts a known reason code and strips angle brackets', () => {
    expect(validateDisputeInput({ reason: ' <b>Never showed up</b> ', reason_code: 'hunter_unresponsive' })).toEqual({
      ok: true,
      reason: 'bNever showed up/b',
      reasonCode: 'hunter_unresponsive',
    })
  })
  test('rejects an unknown reason code', () => {
    expect(validateDisputeInput({ reason: 'Something went wrong', reason_code: 'poster_unresponsive' }).ok).toBe(false)
  })
})

describe('reviewDeadline', () => {
  test('adds the window to submitted_at', () => {
    expect(reviewDeadline('2026-10-01T12:00:00.000Z', 72)).toBe('2026-10-04T12:00:00.000Z')
  })
  test('null without a usable timestamp', () => {
    expect(reviewDeadline(null, 72)).toBeNull()
    expect(reviewDeadline('nope', 72)).toBeNull()
  })
})

describe('hunterPayout', () => {
  test('matches bounty-payments v2 rounding', () => {
    expect(hunterPayout(100, 10)).toBe(90)
    expect(hunterPayout(5, 10)).toBe(4.5)
    expect(hunterPayout(33.33, 10)).toBe(30)
    expect(hunterPayout(50, 5)).toBe(47.5)
  })
})

describe('isUuid', () => {
  test('accepts uuids only', () => {
    expect(isUuid('6ff9f45a-2f32-432c-b419-815084e551c0')).toBe(true)
    expect(isUuid('6ff9f45a')).toBe(false)
    expect(isUuid(undefined)).toBe(false)
  })
})
