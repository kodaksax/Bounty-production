import {
  V2_TEMPLATES,
  TONES,
  buildNoticeSend,
  clip,
  isDesignV2Enabled,
  preheaderFrom,
  stampFor,
} from '../../supabase/functions/_shared/email-design-v2'

const CTA = { url: 'https://www.bountyfinder.net/manage/?bounty=5e96aaed-93bd-4ade-ae39-93b073d9daff', label: 'Open on bountyfinder.net' }

// Declared variables of the Resend templates (scripts/emails/templates.mjs).
// Passing a variable a template does not declare is avoided on purpose.
const ACTION_VARS = ['STAMP_LABEL', 'TONE_ACCENT', 'TONE_INK', 'TONE_TINT', 'PREHEADER', 'HEADLINE', 'BODY', 'CTA_LABEL', 'CTA_URL', 'HELP_URL', 'REASON_LINE', 'POSTAL_LINE']
const INFO_VARS = ACTION_VARS.filter((k) => k !== 'CTA_LABEL' && k !== 'CTA_URL')

describe('email design v2 flag', () => {
  test('is off unless explicitly "on"', () => {
    expect(isDesignV2Enabled(undefined)).toBe(false)
    expect(isDesignV2Enabled('')).toBe(false)
    expect(isDesignV2Enabled('true')).toBe(false)
    expect(isDesignV2Enabled(' ON ')).toBe(true)
  })
})

describe('buildNoticeSend', () => {
  test('a notification with a button uses the action template and only its variables', () => {
    const s = buildNoticeSend({ type: 'message', category: 'messages', title: 'Message from Jordan', body: 'Hey! I can come by around 4.', cta: CTA, helpUrl: null })
    expect(s.id).toBe(V2_TEMPLATES.noticeAction)
    expect(s.subject).toBe('Message from Jordan')
    for (const k of Object.keys(s.variables)) expect(ACTION_VARS).toContain(k)
    expect(s.variables.STAMP_LABEL).toBe('New message')
    expect(s.variables.CTA_URL).toBe(CTA.url)
  })

  test('without a button it uses the info template and never passes CTA variables', () => {
    const s = buildNoticeSend({ type: 'verification_verified', category: 'verification', title: 'Identity Verified', body: 'Your identity check is complete.', cta: null, helpUrl: null })
    expect(s.id).toBe(V2_TEMPLATES.noticeInfo)
    for (const k of Object.keys(s.variables)) expect(INFO_VARS).toContain(k)
    expect(s.variables.CTA_URL).toBeUndefined()
    expect(s.variables.STAMP_LABEL).toBe('Verified')
  })

  test('escapes user-controlled text (Resend inserts variables unescaped)', () => {
    const s = buildNoticeSend({ type: 'application', category: 'marketplace', title: 'Someone applied to "<b>Move & lift</b>"', body: "<script>alert('x')</script>", cta: CTA, helpUrl: null })
    expect(s.variables.HEADLINE).not.toMatch(/<b>|<script>/)
    expect(s.variables.HEADLINE).toContain('&lt;b&gt;')
    expect(s.variables.BODY).toBe('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;')
    // The subject is a plain-text header, so it is clipped but not escaped.
    expect(s.subject).toContain('"<b>Move & lift</b>"')
  })

  test('tone colours only ever come from the fixed table', () => {
    const s = buildNoticeSend({ type: 'payout_failed', category: 'payments', title: 'Payout failed', body: 'x', cta: null, helpUrl: null })
    expect(s.variables.TONE_ACCENT).toBe(TONES.alert.accent)
    expect(s.variables.STAMP_LABEL).toBe('Action needed')
  })

  test('drops empty values so template fallbacks apply, and ignores non-https help links', () => {
    const s = buildNoticeSend({ type: 'unknown_type', category: 'nope', title: '', body: '', cta: null, helpUrl: 'javascript:alert(1)' })
    expect(s.variables.BODY).toBeUndefined()
    expect(s.variables.HELP_URL).toBeUndefined()
    expect(s.variables.REASON_LINE).toBeUndefined()
    expect(s.subject).toBe('Bounty')
    expect(stampFor('unknown_type', 'nope')).toEqual({ label: 'Update', tone: 'success' })
  })

  test('long titles are clipped for the headline and subject', () => {
    const long = 'Your application to "' + 'Help me move a sectional and two bookcases up four flights '.repeat(3) + '" closed'
    const s = buildNoticeSend({ type: 'application_expired', category: 'marketplace', title: long, body: 'x', cta: null, helpUrl: null })
    expect(s.variables.HEADLINE.length).toBeLessThanOrEqual(90 + 10)
    expect(s.subject.length).toBeLessThanOrEqual(120)
    expect(s.variables.HEADLINE.endsWith('…')).toBe(true)
  })

  test('postal line is escaped and prefixed', () => {
    const s = buildNoticeSend({ type: 'message', category: 'messages', title: 't', body: 'b', cta: CTA, helpUrl: 'https://www.bountyfinder.net/manage/?view=help', postal: '1 Main St <Suite 2>' })
    expect(s.variables.POSTAL_LINE).toBe('Bounty &middot; 1 Main St &lt;Suite 2&gt;')
    expect(s.variables.HELP_URL).toBe('https://www.bountyfinder.net/manage/?view=help')
  })
})

describe('text helpers', () => {
  test('clip trims at a word boundary', () => {
    expect(clip('short', 10)).toBe('short')
    expect(clip('one two three four five', 12)).toBe('one two…')
  })
  test('preheaderFrom uses a short body whole and a long body’s first sentence', () => {
    expect(preheaderFrom('Hey! Can I come by at 4?')).toBe('Hey! Can I come by at 4?')
    const long = 'A hunter applied to "Deliver me food" and is waiting for your answer. ' + 'Use the button below to see who applied and accept or decline in your browser.'
    expect(preheaderFrom(long)).toBe('A hunter applied to "Deliver me food" and is waiting for your answer.')
    expect(preheaderFrom('No punctuation here')).toBe('No punctuation here')
  })
})
