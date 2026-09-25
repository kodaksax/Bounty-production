import {
  applicantListLink,
  buildFallbackEmail,
  buildHunterClosedEmail,
  buildPosterFallbackEmail,
  describeTicketError,
  fallbackDedupeKey,
  isEmailFallbackType,
  isLegacyOptedOut,
  isPosterFallbackType,
  selectFallbackCandidates,
  type FallbackPushOutcome,
  truncateMessage,
} from '../../supabase/functions/process-notification/email-fallback'

describe('isPosterFallbackType', () => {
  test('only the two poster-facing application types fall back to email', () => {
    expect(isPosterFallbackType('application')).toBe(true)
    expect(isPosterFallbackType('application_pending_reminder')).toBe(true)
    expect(isPosterFallbackType('bounty_nearby')).toBe(false)
    expect(isPosterFallbackType('message')).toBe(false)
    expect(isPosterFallbackType('application_expired')).toBe(false)
  })
})

describe('isEmailFallbackType', () => {
  test('covers the poster types plus the hunter closure notice', () => {
    expect(isEmailFallbackType('application')).toBe(true)
    expect(isEmailFallbackType('application_pending_reminder')).toBe(true)
    expect(isEmailFallbackType('application_expired')).toBe(true)
    expect(isEmailFallbackType('application_bounty_closed')).toBe(false)
    expect(isEmailFallbackType('bounty_nearby')).toBe(false)
  })
})

describe('fallbackDedupeKey for the hunter closure', () => {
  test('never collides with the poster email for the same application', () => {
    const poster = fallbackDedupeKey({ request_id: 'r1' }, 'o1', 'application')
    const hunter = fallbackDedupeKey({ requestId: 'r1' }, 'o2', 'application_expired')
    expect(poster).toBe('request:r1')
    expect(hunter).toBe('closed:r1')
  })

  test('accepts the legacy applicationId payload key', () => {
    expect(fallbackDedupeKey({ applicationId: 'r2' }, 'o3', 'application_expired')).toBe('closed:r2')
  })
})

describe('buildHunterClosedEmail', () => {
  test('is worded as a closure, not a poster decision', () => {
    for (const reason of ['no_response', 'poster_absent', null]) {
      const { title, body } = buildHunterClosedEmail({ bountyTitle: 'Walk my dog', reason })
      expect(title).toBe('Your application to "Walk my dog" closed')
      expect(body).toMatch(/wasn't a rejection/)
      expect(body).not.toMatch(/declined|rejected you|chose/i)
    }
    expect(buildHunterClosedEmail({ bountyTitle: 'X', reason: 'poster_absent' }).body).toMatch(/hasn't been active/)
    expect(buildHunterClosedEmail({ bountyTitle: 'X', reason: 'no_response' }).body).toMatch(/didn't respond in time/)
  })

  // The sweep leaves funded bounties open (flagged stale), so the copy may only
  // claim the bounty closed when data.bountyClosed says it was archived.
  test('only claims the bounty closed when it actually was', () => {
    const archived = buildHunterClosedEmail({ bountyTitle: 'X', reason: 'poster_absent', bountyClosed: true }).body
    const flagged = buildHunterClosedEmail({ bountyTitle: 'X', reason: 'poster_absent', bountyClosed: false }).body
    const unknown = buildHunterClosedEmail({ bountyTitle: 'X', reason: 'poster_absent' }).body
    expect(archived).toMatch(/closed the bounty/)
    expect(flagged).not.toMatch(/closed the bounty/)
    expect(flagged).toMatch(/closed your application/)
    expect(unknown).not.toMatch(/closed the bounty/)
  })
})

describe('selectFallbackCandidates', () => {
  const outcomes = new Map<string, FallbackPushOutcome>([
    ['pushed', { status: 'sent' }],
    ['failed', { status: 'failed', reason: 'push_send_error' }],
    ['no_token', { status: 'failed', reason: 'no_deliverable_token' }],
  ])

  test('push failures and never-attempted push fall back; delivered and quiet hours do not', () => {
    const got = selectFallbackCandidates(
      ['pushed', 'failed', 'no_token', 'push_off', 'quiet'],
      outcomes,
      new Set(['quiet'])
    )
    expect(got).toEqual(['failed', 'no_token', 'push_off'])
  })

  test('a failure outranks quiet hours (push was attempted and failed)', () => {
    expect(selectFallbackCandidates(['failed'], outcomes, new Set(['failed']))).toEqual(['failed'])
  })
})

describe('isLegacyOptedOut', () => {
  const allOn = { applications_enabled: true, acceptances_enabled: true, reminders_enabled: true }

  test('missing preferences row or NULL columns means allowed', () => {
    expect(isLegacyOptedOut('application_expired', null)).toBe(false)
    expect(isLegacyOptedOut('application', { applications_enabled: null, acceptances_enabled: null, reminders_enabled: null })).toBe(false)
  })

  test('hunters are gated by acceptances_enabled, not the poster toggle', () => {
    expect(isLegacyOptedOut('application_expired', { ...allOn, acceptances_enabled: false })).toBe(true)
    expect(isLegacyOptedOut('application_expired', { ...allOn, applications_enabled: false })).toBe(false)
  })

  test('posters are gated by applications_enabled; reminders also by reminders_enabled', () => {
    expect(isLegacyOptedOut('application', { ...allOn, applications_enabled: false })).toBe(true)
    expect(isLegacyOptedOut('application', { ...allOn, acceptances_enabled: false })).toBe(false)
    expect(isLegacyOptedOut('application', { ...allOn, reminders_enabled: false })).toBe(false)
    expect(isLegacyOptedOut('application_pending_reminder', { ...allOn, reminders_enabled: false })).toBe(true)
  })

  test('types outside the fallback never opt out through this path', () => {
    expect(isLegacyOptedOut('bounty_nearby', { applications_enabled: false, acceptances_enabled: false, reminders_enabled: false })).toBe(false)
  })
})

describe('buildFallbackEmail', () => {
  test('routes poster types to the applicant email and the hunter type to the closure email', () => {
    expect(buildFallbackEmail('application', { bountyTitle: 'X', applicantCount: 3, data: {} }).title)
      .toBe('3 applicants are waiting on "X"')
    const closed = buildFallbackEmail('application_expired', {
      bountyTitle: 'X',
      applicantCount: 1,
      data: { reason: 'poster_absent', bountyClosed: true },
    })
    expect(closed.title).toBe('Your application to "X" closed')
    expect(closed.body).toMatch(/closed the bounty/)
  })
})

describe('describeTicketError', () => {
  test('extracts the Expo code and message', () => {
    const ticket = {
      status: 'error',
      message: 'Unable to retrieve the FCM server key for the recipient\'s app.',
      details: { error: 'InvalidCredentials' },
    }
    expect(describeTicketError(ticket)).toEqual({
      code: 'InvalidCredentials',
      message: "Unable to retrieve the FCM server key for the recipient's app.",
    })
  })

  test('falls back to unknown when details are missing', () => {
    expect(describeTicketError({ status: 'error' })).toEqual({ code: 'unknown', message: null })
    expect(describeTicketError(null)).toEqual({ code: 'unknown', message: null })
  })

  test('truncates very long provider messages', () => {
    const long = 'x'.repeat(1000)
    const { message } = describeTicketError({ status: 'error', message: long, details: { error: 'E' } })
    expect(message!.length).toBeLessThanOrEqual(301)
    expect(truncateMessage('')).toBeNull()
  })
})

describe('fallbackDedupeKey', () => {
  test('application trigger payload (snake_case request_id)', () => {
    expect(fallbackDedupeKey({ request_id: 'r1' }, 'o1')).toBe('request:r1')
  })

  test('reminder payload (camelCase requestId) dedupes against the same request', () => {
    expect(fallbackDedupeKey({ requestId: 'r1', request_id: 'r1' }, 'o2')).toBe('request:r1')
  })

  test('no request id falls back to the outbox row', () => {
    expect(fallbackDedupeKey({}, 'o3')).toBe('outbox:o3')
  })
})

describe('applicantListLink', () => {
  test('points at the poster applicant-management route', () => {
    expect(applicantListLink('bountyexpo-workspace://', 'b1')).toBe('bountyexpo-workspace://postings/b1')
    expect(applicantListLink('https://example.com/app', 'b1')).toBe('https://example.com/app/postings/b1')
  })
})

describe('buildPosterFallbackEmail', () => {
  test('single applicant', () => {
    const { title, body } = buildPosterFallbackEmail({ bountyTitle: 'Walk my dog', applicantCount: 1 })
    expect(title).toBe('Someone applied to "Walk my dog"')
    expect(body).toContain('A hunter applied')
  })

  test('includes the applicant count when more than one is waiting', () => {
    const { title, body } = buildPosterFallbackEmail({ bountyTitle: 'Walk my dog', applicantCount: 4 })
    expect(title).toBe('4 applicants are waiting on "Walk my dog"')
    expect(body).toContain('4 hunters applied')
  })

  test('tolerates a missing title or count', () => {
    const { title } = buildPosterFallbackEmail({ bountyTitle: null, applicantCount: 0 })
    expect(title).toBe('Someone applied to "your bounty"')
  })
})
