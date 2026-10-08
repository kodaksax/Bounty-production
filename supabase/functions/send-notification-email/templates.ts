// Published Resend templates for send-notification-email.
//
// Pure and dependency-free so the template mapping and every variable are
// unit-tested (__tests__/unit/notification-email-templates.test.ts) and
// index.ts only does I/O: it loads TemplateFacts from the database and sends.
//
// A notification listed here is rendered by a PUBLISHED Resend template
// instead of the generic buildEmail() layout. Everything else is untouched.
//
// Reference templates by ID, not alias: an alias has already been renamed once
// (bounty-posted-copy -> bounty-posted-final-copy) and an ID survives that.
//
// Resend inserts {{{VAR}}} UNESCAPED. Every value that is or contains user
// text (titles, names) goes through escapeHtml here; the fixed sentences are
// ours. Empty values are dropped so the template's declared fallback applies.

export const TEMPLATE_IDS = {
  bounty_posted: '386c9e82-f564-40e0-ae4c-83dac4db318d', // "Bounty Posted (Final Copy)"
  new_applicants: '8ea157bb-a4ed-4838-ad30-18d147211add', // "Someone wants this job (Final Copy)", e01
  work_submitted: 'a33f5f57-b748-4689-90ef-11dc5eb6f325', // "Ready for review (Final Copy)", e03
  hired: '31e736fe-190e-43a0-904e-f66c8a8055a7', // "Bounty Approval (Final Copy)", e05
} as const

export type TemplateKey = keyof typeof TEMPLATE_IDS

// Only these schemes may be rendered as a button: the app's own custom scheme
// and https. Anything else in data.ctaUrl is ignored rather than linked.
const ALLOWED_CTA_PREFIXES = ['https://', 'bountyexpo-workspace://']

export function ctaFrom(data: Record<string, unknown>): { url: string; label: string } | null {
  const url = typeof data.ctaUrl === 'string' ? data.ctaUrl.trim() : ''
  if (!url || !ALLOWED_CTA_PREFIXES.some((p) => url.startsWith(p))) return null
  const label = typeof data.ctaLabel === 'string' && data.ctaLabel.trim() ? data.ctaLabel.trim() : 'Open Bounty'
  return { url, label }
}

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function bountyIdOf(data: Record<string, unknown>): string {
  return str(data.bountyId) || str(data.bounty_id)
}

/**
 * Which template renders this notification, or null for the generic layout.
 * review_needed covers the submission and its 24h/48h reminders, but not the
 * 72h "support is reviewing" notice (subtype review_escalated), whose message
 * the "Review the work" template would contradict.
 */
export function templateKeyFor(type: string, data: Record<string, unknown>): TemplateKey | null {
  if (type === 'bounty_posted') return 'bounty_posted'
  if (type === 'application' || type === 'application_pending_reminder') return 'new_applicants'
  if (type === 'review_needed') return str(data.subtype) === 'review_escalated' ? null : 'work_submitted'
  if (type === 'update' && str(data.subtype) === 'work_in_progress') return 'hired'
  return null
}

/** "$40", "$12.50", or "For honor". */
export function rewardDisplay(amount: unknown, isForHonor: unknown): string {
  if (isForHonor === true) return 'For honor'
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) return ''
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}

export interface ApplicantFact {
  name: string
  idVerified: boolean
  rating: number | null
  ratingCount: number
  jobsCompleted: number
}

/** What index.ts loads from the database for a template send. All optional. */
export interface TemplateFacts {
  bountyTitle?: string
  reward?: string
  hunterName?: string
  hunterIdVerified?: boolean
  /** Newest first, already capped by the caller. */
  applicants?: ApplicantFact[]
  /** All pending applicants, which may exceed applicants.length. */
  applicantCount?: number
}

export interface TemplateEnv {
  preferencesUrl: string
  postalAddress: string
}

export interface TemplateSend {
  id: string
  variables: Record<string, string>
  idempotencyKey: string | null
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** One applicant as a <tr> for e01's APPLICANT_ROWS, styled like the template. */
export function applicantRow(a: ApplicantFact): string {
  const facts: string[] = []
  facts.push(
    a.rating !== null && a.ratingCount > 0
      ? `&#9733; ${a.rating.toFixed(1)} (${a.ratingCount})`
      : 'New to Bounty'
  )
  facts.push(`${a.jobsCompleted} job${a.jobsCompleted === 1 ? '' : 's'} done`)
  const badge = a.idVerified
    ? ` <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;background-color:#ECFDF5;color:#065F46;font-size:12px;line-height:16px;font-weight:700;">ID verified</span>`
    : ''
  return (
    `<tr><td style="padding:14px 0;border-bottom:1px solid #E7E0D1;font-family:${FONT};">` +
    `<p style="margin:0;font-size:16px;line-height:22px;color:#18181B;font-weight:700;">${escapeHtml(a.name)}${badge}</p>` +
    `<p style="margin:4px 0 0;font-size:14px;line-height:20px;color:#5F5F67;">${facts.join(' &middot; ')}</p>` +
    `</td></tr>`
  )
}

function compact(raw: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''))
}

function footer(env: TemplateEnv): Record<string, string> {
  return {
    PREFERENCES_URL: escapeHtml(env.preferencesUrl),
    POSTAL_LINE: env.postalAddress ? `Bounty &middot; ${escapeHtml(env.postalAddress)}` : '',
  }
}

/**
 * The Resend template send for a notification, or null when it renders with
 * the generic layout. `data` is the notification payload; `facts` fill what
 * the payload doesn't carry. Payload values win where both exist.
 */
export function buildTemplateSend(
  type: string,
  data: Record<string, unknown>,
  facts: TemplateFacts,
  env: TemplateEnv
): TemplateSend | null {
  const key = templateKeyFor(type, data)
  if (!key) return null
  const id = TEMPLATE_IDS[key]
  const cta = ctaFrom(data)
  const bountyId = bountyIdOf(data)
  const title = escapeHtml(str(data.bountyTitle) || facts.bountyTitle || '')
  const reward = escapeHtml(str(data.rewardDisplay) || facts.reward || '')
  const hunter = escapeHtml(str(data.hunter_name) || facts.hunterName || '')

  if (key === 'bounty_posted') {
    return {
      id,
      variables: compact({
        BOUNTY_TITLE: title,
        BOUNTY_REWARD: reward,
        AUDIENCE_LINE:
          data.isInPerson === true
            ? "We're letting people nearby know about it."
            : "We're letting people who do this kind of work know about it.",
        // Trailing space is intentional: the template butts it against the next sentence.
        PAY_LINE: data.payAtHire === true ? "That's when you pay. " : '',
        CTA_URL: cta ? escapeHtml(cta.url) : '',
        ...footer(env),
      }),
      idempotencyKey: bountyId ? `bounty-posted/${bountyId}` : null,
    }
  }

  if (key === 'new_applicants') {
    const shown = facts.applicants ?? []
    const total = Math.max(facts.applicantCount ?? shown.length, shown.length)
    const more = total - shown.length
    const requestId = str(data.request_id) || str(data.requestId)
    return {
      id,
      variables: compact({
        HEADLINE: total === 1 ? 'Someone wants this job.' : total > 1 ? `${total} people want this job.` : '',
        BOUNTY_TITLE: title,
        BOUNTY_REWARD: reward,
        COUNT_NOTE: more > 0 ? ` (and ${more} more)` : '',
        APPLICANT_ROWS: shown.map(applicantRow).join(''),
        CTA_URL: cta ? escapeHtml(cta.url) : '',
        ...footer(env),
      }),
      // One email per application, matching the fallback's dedupe.
      idempotencyKey: requestId ? `new-applicants/${requestId}/${type}` : null,
    }
  }

  if (key === 'work_submitted') {
    const subtype = str(data.subtype)
    const stage = str(data.stage)
    const isRevision = data.is_revision === true
    const who = hunter || 'Your hunter'
    let headline = isRevision ? 'The changes are ready.' : ''
    let preheader = ''
    if (subtype === 'review_reminder') {
      headline = stage === 'final' ? 'Last day to review.' : `${who} is waiting on your review.`
      preheader = 'Check the work, then release payment.'
    }
    const submissionId = str(data.submission_id)
    return {
      id,
      variables: compact({
        PREHEADER: preheader,
        HEADLINE: headline,
        BOUNTY_TITLE: title,
        HUNTER_NAME: hunter,
        BOUNTY_REWARD: reward,
        INTRO_HTML: isRevision
          ? `${who} made the changes you asked for and sent the work back for your review.`
          : `${who} finished the job and sent it over for your review.`,
        CTA_URL: cta ? escapeHtml(cta.url) : '',
        ...footer(env),
      }),
      idempotencyKey: submissionId
        ? `work-submitted/${submissionId}/${subtype || 'submitted'}${stage ? `/${stage}` : ''}`
        : null,
    }
  }

  // key === 'hired'
  return {
    id,
    variables: compact({
      BOUNTY_TITLE: title,
      BOUNTY_REWARD: reward,
      HUNTER_NAME: hunter,
      VERIFIED_BADGE: facts.hunterIdVerified ? ' &middot; ID verified' : '',
      CTA_URL: cta ? escapeHtml(cta.url) : '',
      CTA_LABEL: cta ? escapeHtml(cta.label) : '',
      ...footer(env),
    }),
    idempotencyKey: bountyId ? `hired/${bountyId}` : null,
  }
}
