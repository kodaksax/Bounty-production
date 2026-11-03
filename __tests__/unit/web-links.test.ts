import {
  DEFAULT_WEB_MANAGE_BASE,
  emailBountyCta,
  isUuid,
  resolveManageBase,
  webBountyCta,
  webManageLink,
} from '../../supabase/functions/_shared/web-links'

const BOUNTY = '5e96aaed-93bd-4ade-ae39-93b073d9daff'
const REQUEST = '0b1c2d3e-4f50-4617-8899-aabbccddeeff'

describe('webManageLink — bounty emails open the website, not the app', () => {
  test('links straight to one applicant on the right bounty', () => {
    const url = new URL(webManageLink(undefined, { bountyId: BOUNTY, requestId: REQUEST, view: 'applicant', campaign: 'applicant_review' }))
    expect(url.origin + url.pathname).toBe('https://www.bountyfinder.net/manage/')
    expect(url.searchParams.get('bounty')).toBe(BOUNTY)
    expect(url.searchParams.get('applicant')).toBe(REQUEST)
    expect(url.searchParams.get('view')).toBe('applicant')
    expect(url.searchParams.get('utm_source')).toBe('bounty_email')
    expect(url.searchParams.get('utm_medium')).toBe('email')
    expect(url.searchParams.get('utm_campaign')).toBe('applicant_review')
  })

  describe('webBountyCta', () => {
    test('builds the shared manage link for bounty and applicant CTAs', () => {
      const cta = webBountyCta(undefined, {
        bounty_id: BOUNTY,
        request_id: REQUEST,
        type: 'new_application',
      })
      expect(cta).toEqual({
        url: expect.stringContaining('/manage/?bounty='),
        label: 'Open on bountyfinder.net',
      })
      const url = new URL(cta!.url)
      expect(url.searchParams.get('bounty')).toBe(BOUNTY)
      expect(url.searchParams.get('applicant')).toBe(REQUEST)
      expect(url.searchParams.get('view')).toBe('applicant')
    })

    describe('emailBountyCta', () => {
      test('uses the shared manage URL for valid bounty payloads and retains the supplied label', () => {
        const cta = emailBountyCta(undefined, {
          bountyId: BOUNTY,
          ctaUrl: `https://www.bountyfinder.net/bounty?id=${BOUNTY}`,
          ctaLabel: 'Review applicant',
        })
        expect(cta).toEqual({
          url: expect.stringContaining(`/manage/?bounty=${BOUNTY}`),
          label: 'Review applicant',
        })
      })

      test('preserves an explicit HTTPS URL only when no shared bounty CTA can be generated', () => {
        expect(emailBountyCta(undefined, { ctaUrl: 'https://example.com/help', ctaLabel: 'Help' })).toEqual({
          url: 'https://example.com/help',
          label: 'Help',
        })
        expect(emailBountyCta(undefined, { ctaUrl: 'bountyexpo://help' })).toBeNull()
      })
    })

    test('drops invalid bounty identifiers instead of creating a CTA', () => {
      expect(webBountyCta(undefined, { bountyId: 'not-a-uuid' })).toBeNull()
    })
  })

  // The incident link was bountyexpo-workspace://postings/<id>.
  test('is never the app custom scheme, whatever the env says', () => {
    for (const base of [undefined, '', 'bountyexpo-workspace://', 'http://insecure.example/', 'javascript:alert(1)']) {
      expect(webManageLink(base, { bountyId: BOUNTY }).startsWith('https://')).toBe(true)
    }
    expect(resolveManageBase('bountyexpo-workspace://')).toBe(DEFAULT_WEB_MANAGE_BASE)
  })

  test('honours an https override and normalises the trailing slash', () => {
    expect(webManageLink('https://staging.bountyfinder.net/manage', { bountyId: BOUNTY })).toMatch(
      /^https:\/\/staging\.bountyfinder\.net\/manage\/\?bounty=/
    )
  })

  test('carries ids only — free text and non-uuids are dropped, never encoded', () => {
    const url = new URL(webManageLink(undefined, { bountyId: 'jane@example.com', requestId: '1 Main St' }))
    expect(url.searchParams.has('bounty')).toBe(false)
    expect(url.searchParams.has('applicant')).toBe(false)
    expect(url.toString()).not.toMatch(/example\.com|Main/)
  })

  test('the bounty view omits the view param; campaign is sanitised', () => {
    const url = new URL(webManageLink(undefined, { bountyId: BOUNTY, view: 'bounty', campaign: 'x y<z>' }))
    expect(url.searchParams.has('view')).toBe(false)
    expect(url.searchParams.get('utm_campaign')).toBe('xyz')
  })

  test('isUuid', () => {
    expect(isUuid(BOUNTY)).toBe(true)
    expect(isUuid(BOUNTY.toUpperCase())).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(null)).toBe(false)
  })
})

describe('proof consent request links', () => {
  const { webBountyCta } = require('../../supabase/functions/_shared/web-links')
  const BOUNTY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

  test('opens the share view, never an applicant', () => {
    const cta = webBountyCta(undefined, { type: 'proof_consent_request', bountyId: BOUNTY_ID, requestId: '11111111-1111-4111-8111-111111111111' })
    expect(cta.label).toBe('Share your result')
    const url = new URL(cta.url)
    expect(url.pathname).toBe('/manage/')
    expect(url.searchParams.get('bounty')).toBe(BOUNTY_ID)
    expect(url.searchParams.get('view')).toBe('share')
    expect(url.searchParams.has('applicant')).toBe(false)
    expect(url.searchParams.get('utm_campaign')).toBe('proof_consent_request')
  })
})
