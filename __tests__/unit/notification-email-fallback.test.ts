import {
  applicantListLink,
  buildPosterFallbackEmail,
  describeTicketError,
  fallbackDedupeKey,
  isPosterFallbackType,
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
