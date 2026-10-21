import {
  cleanDistinctId,
  fingerprintConfidence,
  fingerprintDays,
  isReportable,
  type MatchInput,
  parseHandoffText,
  parseInstallReferrer,
  REPORTABLE_CONFIDENCE,
  resolveInstallMatch,
} from '../../supabase/functions/_shared/install-attribution'

const CLICK = '5f2b8a1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b'
const NOW = new Date('2026-10-21T12:00:00Z')

function input(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    os: 'ios',
    referrer: null,
    handoffClickId: null,
    handoffClickExists: false,
    referrerClickExists: false,
    webUtm: null,
    branch: null,
    fingerprintCandidates: [],
    now: NOW,
    ...overrides,
  }
}

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

describe('parseInstallReferrer', () => {
  test('reads the UTMs and click id app-link puts in the Play referrer', () => {
    const parsed = parseInstallReferrer(
      `utm_source=heycatch&utm_medium=web&utm_campaign=a&utm_content=hero-get-app&click_id=${CLICK.toUpperCase()}`
    )
    expect(parsed).toEqual({
      utm: { source: 'heycatch', medium: 'web', campaign: 'a', content: 'hero-get-app', term: undefined },
      clickId: CLICK,
    })
  })

  test('an organic Play Store install is a real, known source', () => {
    expect(parseInstallReferrer('utm_source=google-play&utm_medium=organic')?.utm.source).toBe(
      'google-play'
    )
  })

  test('nothing usable resolves to null, including Play\'s "(not set)"', () => {
    expect(parseInstallReferrer('')).toBeNull()
    expect(parseInstallReferrer(undefined)).toBeNull()
    expect(parseInstallReferrer('utm_source=(not%20set)&utm_medium=(not%20set)')).toBeNull()
    expect(parseInstallReferrer('click_id=not-a-uuid')).toBeNull()
  })
})

describe('resolveInstallMatch', () => {
  test('Android with a referrer is deterministic, and keeps the click only if it exists', () => {
    const referrer = parseInstallReferrer(`utm_source=website&click_id=${CLICK}`)
    expect(resolveInstallMatch(input({ os: 'android', referrer, referrerClickExists: true }))).toMatchObject({
      method: 'play_referrer',
      confidence: 1,
      clickId: CLICK,
    })
    expect(resolveInstallMatch(input({ os: 'android', referrer })).clickId).toBeNull()
  })

  test('the referrer beats an inference even when a fingerprint candidate exists', () => {
    const match = resolveInstallMatch(
      input({
        os: 'android',
        referrer: parseInstallReferrer('utm_source=google-play&utm_medium=organic'),
        fingerprintCandidates: [{ click_id: CLICK, clicked_at: minutesAgo(5) }],
      })
    )
    expect(match.method).toBe('play_referrer')
    expect(match.utm.source).toBe('google-play')
  })

  test('iOS clipboard handoff counts only for a click that exists', () => {
    expect(
      resolveInstallMatch(input({ handoffClickId: CLICK, handoffClickExists: true }))
    ).toMatchObject({ method: 'clipboard_handoff', confidence: 1, clickId: CLICK })
    expect(resolveInstallMatch(input({ handoffClickId: CLICK })).method).toBe('unattributed')
  })

  test('a web signup in the browser that clicked is deterministic', () => {
    expect(
      resolveInstallMatch(input({ os: 'web', webUtm: { source: 'google' } }))
    ).toMatchObject({ method: 'web_session', confidence: 1 })
  })

  test('IP + OS + time never reaches the reportable bar', () => {
    for (const candidates of [
      [{ click_id: CLICK, clicked_at: minutesAgo(2) }],
      [{ click_id: CLICK, clicked_at: minutesAgo(600) }],
      [
        { click_id: CLICK, clicked_at: minutesAgo(2) },
        { click_id: 'b'.repeat(8) + CLICK.slice(8), clicked_at: minutesAgo(3) },
      ],
    ]) {
      const match = resolveInstallMatch(input({ fingerprintCandidates: candidates }))
      expect(match.method).toBe('fingerprint')
      expect(match.confidence).toBeLessThan(REPORTABLE_CONFIDENCE)
      expect(isReportable(match)).toBe(false)
    }
  })

  test('no evidence is unattributed, and unattributed rows stay reportable as such', () => {
    const match = resolveInstallMatch(input())
    expect(match).toMatchObject({ method: 'unattributed', confidence: 0, clickId: null })
    expect(isReportable(match)).toBe(true)
  })

  test('Branch is deterministic only when Branch says the match is guaranteed', () => {
    const branch = { utm: { source: 'reddit' }, guaranteed: false }
    expect(resolveInstallMatch(input({ branch })).confidence).toBeLessThan(REPORTABLE_CONFIDENCE)
    expect(resolveInstallMatch(input({ branch: { ...branch, guaranteed: true } })).confidence).toBe(1)
  })
})

describe('fingerprintConfidence', () => {
  test('ignores clicks outside the window or in the future', () => {
    expect(fingerprintConfidence([{ click_id: CLICK, clicked_at: minutesAgo(25 * 60) }], NOW)).toBeNull()
    expect(fingerprintConfidence([{ click_id: CLICK, clicked_at: minutesAgo(-5) }], NOW)).toBeNull()
  })

  test('hashes cover today and yesterday so a click just before midnight still matches', () => {
    expect(fingerprintDays(new Date('2026-10-21T00:10:00Z'))).toEqual(['2026-10-21', '2026-10-20'])
  })
})

describe('handoff and distinct ids', () => {
  test('parses only the website\'s own handoff URL', () => {
    expect(parseHandoffText(`https://www.bountyfinder.net/?install=${CLICK}`)).toBe(CLICK)
    expect(parseHandoffText(`https://bountyfinder.net.evil.example/?install=${CLICK}`)).toBeNull()
    expect(parseHandoffText('some copied text')).toBeNull()
  })

  test('distinct ids are limited to a safe character set', () => {
    expect(cleanDistinctId('0192f3a4-5b6c-7d8e-9f01-23456789abcd')).toBe(
      '0192f3a4-5b6c-7d8e-9f01-23456789abcd'
    )
    expect(cleanDistinctId('"},{"event":"x')).toBeUndefined()
  })
})
