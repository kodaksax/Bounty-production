// Bounty email design v2 — which Resend template renders a notification email,
// and the variables the two universal templates ("notice") need.
//
// Why this exists: every notification email except bounty_posted is rendered
// by the plain inline buildEmail() layout in send-notification-email. The v2
// universal templates give all of them the Bounty design (brand header,
// status stamp, card, footer) while keeping the producer's title/body copy
// and the existing CTA/help/reply-to logic exactly as they are.
//
// On by default: Bounty sends only the v2 templates (the old Resend templates
// were deleted 2026-10-25). EMAIL_DESIGN_V2=off is the kill switch: every email
// falls back to the inline buildEmail() layout, which needs no Resend template
// at all, with no redeploy.
//
// Pure and dependency-free so it is unit-tested directly
// (__tests__/unit/email-design-v2.test.ts) and importable from any function.
//
// Template source of truth: scripts/emails/ (node scripts/emails/build.mjs).

export const V2_TEMPLATES = {
  /** "Bounty v2 · Bounty posted" — drop-in for 386c9e82 (same variables + HELP_LINE/FOOTER_LINE). */
  bountyPosted: '6e95fb9b-14d2-4079-9e57-d4bffd657f93',
  /** "Bounty v2 · Notification (with button)". */
  noticeAction: '21d52deb-990c-4512-b6b2-67a3d14036aa',
  /** "Bounty v2 · Notification (no button)". */
  noticeInfo: '5dc750c9-93a8-43b3-82e2-0b748b3195de',
  /** "Bounty v2 · Team alert (internal)": support cases, admin alerts, contact-support. */
  teamAlert: '6835c482-23d8-42b5-8f8f-7366d0d0874f',
} as const

/** v2 unless the kill switch says otherwise ("off", "false" or "0"). */
export function isDesignV2Enabled(flag: string | null | undefined): boolean {
  return !['off', 'false', '0'].includes((flag ?? '').trim().toLowerCase())
}

export type Tone = 'success' | 'action' | 'alert' | 'neutral'

// Fixed values from the design system. They are injected into style
// attributes, so they must only ever come from this table — never from a
// payload.
export const TONES: Record<Tone, { accent: string; ink: string; tint: string }> = {
  success: { accent: '#18A772', ink: '#0B6A31', tint: '#E7F5EC' },
  action: { accent: '#E39B2D', ink: '#7F4300', tint: '#FFF1DC' },
  alert: { accent: '#D9473B', ink: '#9E2219', tint: '#FCEAE8' },
  neutral: { accent: '#D7CBBD', ink: '#3A403B', tint: '#EFE9E1' },
}

const CATEGORY_LABEL: Record<string, string> = {
  marketplace: 'Marketplace',
  messages: 'Messages',
  payments: 'Payments',
  security: 'Security',
  verification: 'Verification',
  followers: 'Followers',
  marketing: 'Marketing',
}

const CATEGORY_STAMP: Record<string, [string, Tone]> = {
  marketplace: ['Bounty update', 'success'],
  messages: ['New message', 'success'],
  payments: ['Payments', 'neutral'],
  security: ['Security', 'alert'],
  verification: ['Verification', 'neutral'],
  followers: ['New follower', 'success'],
  marketing: ['From Bounty', 'neutral'],
}

// Types from lib/config/notification-taxonomy.ts. Anything not listed falls
// back to its category's stamp. Labels describe state, never promise outcomes.
const TYPE_STAMP: Record<string, [string, Tone]> = {
  message: ['New message', 'success'],
  application: ['Your move', 'action'],
  acceptance: ['Hired', 'success'],
  completion: ['Ready to review', 'success'],
  review_needed: ['Your move', 'action'],
  cancellation_request: ['Action needed', 'action'],
  cancellation_accepted: ['Cancelled', 'neutral'],
  cancellation_rejected: ['Update', 'neutral'],
  application_expired: ['Closed', 'neutral'],
  application_bounty_closed: ['Closed', 'neutral'],
  application_closure_digest: ['Closed', 'neutral'],
  bounty_nearby: ['Nearby', 'success'],
  bounty_expiry: ['Closing soon', 'action'],
  stale_bounty: ['Needs a nudge', 'neutral'],
  bounty_quality_nudge: ['Needs a nudge', 'neutral'],
  bounty_location_nudge: ['Needs a nudge', 'neutral'],
  rating_reminder: ['Quick favor', 'neutral'],
  proof_consent_request: ['Quick favor', 'neutral'],
  payout_paid: ['Paid out', 'success'],
  payout_failed: ['Action needed', 'alert'],
  payout_canceled: ['Action needed', 'alert'],
  withdrawal_reversed: ['Action needed', 'alert'],
  bank_disconnected: ['Action needed', 'alert'],
  payout_method_changed: ['Security', 'alert'],
  payout_setup_required: ['Action needed', 'action'],
  release_waiting_on_hunter: ['Action needed', 'action'],
  dispute_created: ['Dispute', 'action'],
  workflow_dispute_created: ['Dispute', 'action'],
  dispute_escalated: ['Dispute', 'action'],
  dispute_resolved: ['Dispute resolved', 'neutral'],
  account_warning: ['Account notice', 'alert'],
  account_restricted: ['Account notice', 'alert'],
  verification_submitted: ['In review', 'neutral'],
  verification_verified: ['Verified', 'success'],
  verification_rejected: ['Action needed', 'action'],
  verification_canceled: ['Verification', 'neutral'],
  follow: ['New follower', 'success'],
}

export function stampFor(type: string, category: string): { label: string; tone: Tone } {
  const [label, tone] = TYPE_STAMP[type] ?? CATEGORY_STAMP[category] ?? ['Update', 'success']
  return { label, tone }
}

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/** Trim to `max` characters at a word boundary, with an ellipsis. */
export function clip(text: string, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  // Prefer a word boundary unless it would throw away more than half the text.
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`
}

/**
 * Inbox preview line: the whole body when it fits (a message preview should
 * read as the message, not "Hey!"), otherwise its first sentence.
 */
export function preheaderFrom(body: string): string {
  const t = String(body ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= 110) return t
  const first = t.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? t
  return clip(first, 110)
}

export interface NoticeInput {
  type: string
  category: string
  title: string
  body: string
  cta: { url: string; label: string } | null
  helpUrl: string | null
  postal?: string
}

export interface NoticeSend {
  id: string
  subject: string
  variables: Record<string, string>
}

const FALLBACK_SUBJECT: Record<string, string> = {
  marketplace: 'Bounty: bounty update',
  messages: 'Bounty: new message',
  payments: 'Bounty: payment update',
  security: 'Bounty: security alert',
  verification: 'Bounty: identity verification update',
  followers: 'Bounty: new follower',
}

/**
 * Variables for the universal notice templates. Every user-influenced value
 * (title, body, URLs) is HTML-escaped here because Resend inserts {{{VAR}}}
 * unescaped. Empty values are dropped so the template's fallback applies.
 * Only variables the chosen template declares are passed.
 */
export function buildNoticeSend(input: NoticeInput): NoticeSend {
  const { type, category, title, body, cta, helpUrl, postal } = input
  const stamp = stampFor(type, category)
  const tone = TONES[stamp.tone]
  const label = CATEGORY_LABEL[category]
  const subject = clip(title || FALLBACK_SUBJECT[category] || 'Bounty', 120)
  const headline = clip(title || FALLBACK_SUBJECT[category] || 'There’s an update on Bounty', 90)

  const raw: Record<string, string> = {
    STAMP_LABEL: escapeHtml(stamp.label),
    TONE_ACCENT: tone.accent,
    TONE_INK: tone.ink,
    TONE_TINT: tone.tint,
    PREHEADER: escapeHtml(preheaderFrom(body)),
    HEADLINE: escapeHtml(headline),
    BODY: escapeHtml(body),
    // Plain-text part: the same copy unescaped (entities would show literally).
    HEADLINE_TEXT: headline,
    BODY_TEXT: String(body ?? '').trim(),
    HELP_URL: helpUrl && helpUrl.startsWith('https://') ? escapeHtml(helpUrl) : '',
    REASON_LINE: label
      ? `You're getting this because of your ${label} notification settings in Bounty. Change them anytime under Settings › Notifications.`
      : '',
    // Plain characters (not entities) so the plain-text part reads cleanly too.
    POSTAL_LINE: postal ? `Bounty · ${escapeHtml(postal)}` : '',
  }
  if (cta) {
    raw.CTA_LABEL = escapeHtml(cta.label)
    raw.CTA_URL = escapeHtml(cta.url)
  }
  return { id: cta ? V2_TEMPLATES.noticeAction : V2_TEMPLATES.noticeInfo, subject, variables: compact(raw) }
}

/** Drop empty values so the template's declared fallback applies instead. */
function compact(raw: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v.trim() !== ''))
}

// ---------------------------------------------------------------- team alert
// Internal email to the Bounty team. Three producers:
//   support  — send-notification-email { supportAlert: true } (support cases)
//   admin    — fn_notify_admins via send-notification-email (data.adminAlert)
//   contact  — contact-support (a user's in-app message; reply-to is the user)

export type TeamAlertKind = 'support' | 'admin' | 'contact'

const FONT = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/**
 * Label/value rows for the DETAILS variable. Mirrors detailRows() in
 * scripts/emails/templates.mjs. Every key and value is escaped here.
 */
export function detailRowsHtml(rows: Array<[string, string]>): string {
  const tr = rows
    .filter(([, v]) => String(v ?? '').trim() !== '')
    .map(([k, v]) =>
      `<tr><td valign="top" width="128" class="c-line c-muted" style="padding:10px 12px 10px 0;border-bottom:1px solid #E6DCCF;font-family:${FONT};font-size:13px;line-height:19px;color:#5C615A;">${escapeHtml(k)}</td>` +
      `<td valign="top" class="c-line c-ink" style="padding:10px 0;border-bottom:1px solid #E6DCCF;font-family:${FONT};font-size:13px;line-height:19px;color:#121A15;font-weight:600;word-break:break-all;">${escapeHtml(v)}</td></tr>`
    )
    .join('')
  return tr
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="c-line" style="margin:0 0 22px;border-top:1px solid #E6DCCF;">${tr}</table>`
    : ''
}

/** Severity → tone. Unknown severities read as "action", never as all-clear. */
function severityTone(severity: string): Tone {
  const s = severity.trim().toLowerCase()
  if (s === 'critical' || s === 'high') return 'alert'
  if (s === 'low' || s === 'info') return 'neutral'
  return 'action'
}

export interface TeamAlertInput {
  kind: TeamAlertKind
  title: string
  body: string
  /** admin alerts: data.severity / data.type */
  severity?: string
  alertType?: string
  /** contact-support: platform + app version, shown in the kicker */
  source?: string
  /** Extra label/value rows (ids, versions). Escaped here. */
  details?: Array<[string, string]>
  /** Prefix kept from the existing subject, e.g. "[Support] ". */
  subjectPrefix?: string
}

export function buildTeamAlertSend(input: TeamAlertInput): NoticeSend {
  const { kind, title, body, severity = '', alertType = '', source = '', details = [], subjectPrefix = '' } = input
  const sev = String(severity ?? '').trim().toLowerCase()
  const tone: Tone = kind === 'admin' ? severityTone(sev) : 'action'
  const t = TONES[tone]
  const stamp = kind === 'admin' ? (sev ? `Admin alert · ${sev}` : 'Admin alert') : kind === 'contact' ? 'Contact support' : 'Support case'
  const kicker =
    kind === 'admin'
      ? `Admin alert${sev ? ` · severity ${sev}` : ''}`
      : kind === 'contact'
        ? `In-app message${source ? ` · ${source}` : ''}`
        : 'Support case'
  const headline = clip(title || (kind === 'contact' ? 'Contact support message' : 'Bounty team alert'), 90)
  const bodyText = String(body ?? '').trim()
  const rows: Array<[string, string]> = [
    ...(kind === 'admin' && alertType ? [['Alert type', alertType] as [string, string]] : []),
    ...(kind === 'admin' && sev ? [['Severity', sev] as [string, string]] : []),
    ...details,
  ].filter(([, v]) => String(v ?? '').trim() !== '')

  const raw: Record<string, string> = {
    STAMP_LABEL: escapeHtml(stamp),
    TONE_ACCENT: t.accent,
    TONE_INK: t.ink,
    TONE_TINT: t.tint,
    PREHEADER: escapeHtml(preheaderFrom(bodyText)),
    KICKER: escapeHtml(kicker),
    HEADLINE: escapeHtml(headline),
    HEADLINE_TEXT: headline,
    // Line breaks are meaningful in alert bodies (case summaries, lists).
    BODY: escapeHtml(bodyText).replace(/\r?\n/g, '<br>'),
    BODY_TEXT: bodyText,
    DETAILS: detailRowsHtml(rows),
    DETAILS_TEXT: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
  }
  return {
    id: V2_TEMPLATES.teamAlert,
    // Long enough for contact-support's 200-character subjects plus the prefix.
    subject: clip(`${subjectPrefix}${title || 'Bounty team alert'}`, 220),
    variables: compact(raw),
  }
}
