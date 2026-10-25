import * as fs from 'fs'
import * as path from 'path'
import {
  V2_TEMPLATES,
  TONES,
  buildNoticeSend,
  buildTeamAlertSend,
  clip,
  detailRowsHtml,
  isDesignV2Enabled,
  preheaderFrom,
  stampFor,
} from '../../supabase/functions/_shared/email-design-v2'

const CTA = { url: 'https://www.bountyfinder.net/manage/?bounty=5e96aaed-93bd-4ade-ae39-93b073d9daff', label: 'Open on bountyfinder.net' }

// Declared variables of the Resend templates (scripts/emails/templates.mjs).
// Passing a variable a template does not declare is avoided on purpose.
const ACTION_VARS = ['STAMP_LABEL', 'TONE_ACCENT', 'TONE_INK', 'TONE_TINT', 'PREHEADER', 'HEADLINE', 'HEADLINE_TEXT', 'BODY', 'BODY_TEXT', 'CTA_LABEL', 'CTA_URL', 'HELP_URL', 'REASON_LINE', 'POSTAL_LINE']
const INFO_VARS = ACTION_VARS.filter((k) => k !== 'CTA_LABEL' && k !== 'CTA_URL')
const TEAM_VARS = ['STAMP_LABEL', 'TONE_ACCENT', 'TONE_INK', 'TONE_TINT', 'PREHEADER', 'KICKER', 'HEADLINE', 'HEADLINE_TEXT', 'BODY', 'BODY_TEXT', 'DETAILS', 'DETAILS_TEXT', 'REASON_LINE']

describe('email design v2 switch', () => {
  test('is on by default; only an explicit off/false/0 turns it off', () => {
    expect(isDesignV2Enabled(undefined)).toBe(true)
    expect(isDesignV2Enabled(null)).toBe(true)
    expect(isDesignV2Enabled('')).toBe(true)
    expect(isDesignV2Enabled('on')).toBe(true)
    expect(isDesignV2Enabled(' OFF ')).toBe(false)
    expect(isDesignV2Enabled('false')).toBe(false)
    expect(isDesignV2Enabled('0')).toBe(false)
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
    // The plain-text part gets the same copy unescaped.
    expect(s.variables.BODY_TEXT).toBe("<script>alert('x')</script>")
    expect(s.variables.HEADLINE_TEXT).toBe('Someone applied to "<b>Move & lift</b>"')
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
    expect(s.variables.POSTAL_LINE).toBe('Bounty · 1 Main St &lt;Suite 2&gt;')
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

describe('team alert (internal)', () => {
  test('admin alerts take their tone from severity and list type + severity', () => {
    const s = buildTeamAlertSend({ kind: 'admin', title: 'Payout failures spiking', body: '3 failed\nin an hour', severity: 'HIGH', alertType: 'payout_failure_spike' })
    expect(s.id).toBe(V2_TEMPLATES.teamAlert)
    for (const k of Object.keys(s.variables)) expect(TEAM_VARS).toContain(k)
    expect(s.variables.TONE_ACCENT).toBe(TONES.alert.accent)
    expect(s.variables.STAMP_LABEL).toBe('Admin alert · high')
    expect(s.variables.BODY).toBe('3 failed<br>in an hour')
    expect(s.variables.BODY_TEXT).toBe('3 failed\nin an hour')
    expect(s.variables.DETAILS).toContain('payout_failure_spike')
    expect(s.variables.DETAILS_TEXT).toBe('Alert type: payout_failure_spike\nSeverity: high')
    expect(s.subject).toBe('Payout failures spiking')
  })

  test('unknown severity never reads as all-clear', () => {
    const s = buildTeamAlertSend({ kind: 'admin', title: 't', body: 'b', severity: 'weird' })
    expect(s.variables.TONE_ACCENT).toBe(TONES.action.accent)
  })

  test('contact-support keeps the [Support] subject, escapes the message and every detail', () => {
    const s = buildTeamAlertSend({
      kind: 'contact', title: "Can't <withdraw>", body: 'Help & <b>now</b>', source: 'ios 2.4.0',
      details: [['Username', '<img src=x>'], ['App version', ''], ['Platform', 'ios']], subjectPrefix: '[Support] ',
    })
    expect(s.subject).toBe("[Support] Can't <withdraw>")
    expect(s.variables.HEADLINE).toBe('Can&#39;t &lt;withdraw&gt;')
    expect(s.variables.BODY).toBe('Help &amp; &lt;b&gt;now&lt;/b&gt;')
    expect(s.variables.KICKER).toBe('In-app message · ios 2.4.0')
    expect(s.variables.DETAILS).not.toContain('<img')
    expect(s.variables.DETAILS).toContain('&lt;img src=x&gt;')
    // Empty rows are left out of both parts.
    expect(s.variables.DETAILS).not.toContain('App version')
    expect(s.variables.DETAILS_TEXT).toBe('Username: <img src=x>\nPlatform: ios')
  })

  test('support alerts with no details drop DETAILS so the fallback applies', () => {
    const s = buildTeamAlertSend({ kind: 'support', title: 'Support case: geocode failed', body: 'x' })
    expect(s.variables.DETAILS).toBeUndefined()
    expect(s.variables.STAMP_LABEL).toBe('Support case')
    expect(detailRowsHtml([['a', '']])).toBe('')
  })
})

describe('contract with the Resend templates (emails/manifest.json)', () => {
  const manifest: Array<{ alias: string; resendId: string; variables: Array<{ key: string }> }> = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../emails/manifest.json'), 'utf8')
  )
  const declared = (alias: string) => manifest.find((t) => t.alias === alias)!.variables.map((v) => v.key)

  test('template IDs in code match the built manifest', () => {
    const id = (alias: string) => manifest.find((t) => t.alias === alias)!.resendId
    expect(V2_TEMPLATES.bountyPosted).toBe(id('bounty-v2-posted'))
    expect(V2_TEMPLATES.noticeAction).toBe(id('bounty-v2-notice-action'))
    expect(V2_TEMPLATES.noticeInfo).toBe(id('bounty-v2-notice-info'))
    expect(V2_TEMPLATES.teamAlert).toBe(id('bounty-v2-team-alert'))
  })

  test('every variable a sender passes is declared by its template', () => {
    const full = { type: 'message', category: 'messages', title: 't', body: 'b', helpUrl: 'https://www.bountyfinder.net/', postal: 'x' }
    for (const k of Object.keys(buildNoticeSend({ ...full, cta: CTA }).variables)) expect(declared('bounty-v2-notice-action')).toContain(k)
    for (const k of Object.keys(buildNoticeSend({ ...full, cta: null }).variables)) expect(declared('bounty-v2-notice-info')).toContain(k)
    const team = buildTeamAlertSend({ kind: 'admin', title: 't', body: 'b', severity: 'high', alertType: 'x', details: [['k', 'v']] })
    for (const k of Object.keys(team.variables)) expect(declared('bounty-v2-team-alert')).toContain(k)
  })
})
