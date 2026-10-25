// Bounty email design v2 — which Resend template renders a notification email,
// and the variables the two universal templates ("notice") need.
//
// Why this exists: every notification email except bounty_posted is rendered
// by the plain inline buildEmail() layout in send-notification-email. The v2
// universal templates give all of them the Bounty design (brand header,
// status stamp, card, footer) while keeping the producer's title/body copy
// and the existing CTA/help/reply-to logic exactly as they are.
//
// Off unless EMAIL_DESIGN_V2=on, so deploying this changes nothing until the
// flag is set; unsetting it is the rollback.
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
} as const

export function isDesignV2Enabled(flag: string | null | undefined): boolean {
  return (flag ?? '').trim().toLowerCase() === 'on'
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

  const raw: Record<string, string> = {
    STAMP_LABEL: escapeHtml(stamp.label),
    TONE_ACCENT: tone.accent,
    TONE_INK: tone.ink,
    TONE_TINT: tone.tint,
    PREHEADER: escapeHtml(preheaderFrom(body)),
    HEADLINE: escapeHtml(clip(title || FALLBACK_SUBJECT[category] || 'There’s an update on Bounty', 90)),
    BODY: escapeHtml(body),
    HELP_URL: helpUrl && helpUrl.startsWith('https://') ? escapeHtml(helpUrl) : '',
    REASON_LINE: label
      ? `You're getting this because of your ${label} notification settings in Bounty. Change them anytime under Settings &rsaquo; Notifications.`
      : '',
    POSTAL_LINE: postal ? `Bounty &middot; ${escapeHtml(postal)}` : '',
  }
  if (cta) {
    raw.CTA_LABEL = escapeHtml(cta.label)
    raw.CTA_URL = escapeHtml(cta.url)
  }
  const variables = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''))
  return { id: cta ? V2_TEMPLATES.noticeAction : V2_TEMPLATES.noticeInfo, subject, variables }
}
