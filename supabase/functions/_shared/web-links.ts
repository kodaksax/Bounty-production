// Links from bounty emails into the website's poster dashboard.
//
// Why this exists (incident 2026-10-06, bounty 5e96aaed): a poster who paid on
// the web and never installed the app got five "Someone applied" emails whose
// button pointed at `bountyexpo-workspace://postings/<id>` — the app's custom
// scheme. Without the app that link does nothing (Gmail web strips it), so the
// one action the email asked for could not be taken from the email. Every
// bounty email now links to an HTTPS page that works in any browser:
// https://www.bountyfinder.net/manage/ (Bounty-landing-page, manage/index.html).
//
// What may go in the URL: opaque record ids and analytics tags. Never a token,
// an email address, a name or an address. The page signs the poster in with
// Supabase Auth and the poster-web function re-checks ownership on every call,
// so a forwarded or leaked link shows a stranger a sign-in form and nothing
// else.
//
// Pure and dependency-free so it is unit-tested directly
// (__tests__/unit/web-links.test.ts) and importable from any function.

export const DEFAULT_WEB_MANAGE_BASE = 'https://www.bountyfinder.net/manage/'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export type ManageView = 'bounty' | 'applicant' | 'complete' | 'help' | 'share'

export interface ManageLinkParams {
  bountyId?: string | null
  requestId?: string | null
  view?: ManageView
  /** utm_campaign: which email this came from, e.g. 'applicant_review'. */
  campaign?: string
}

/**
 * Only an https base is honoured; anything else (unset, a custom scheme, a
 * typo) falls back to the default so a misconfigured env var can never put
 * an app-only link back into an email.
 */
export function resolveManageBase(configured: string | null | undefined): string {
  const raw = (configured ?? '').trim()
  if (!raw.startsWith('https://')) return DEFAULT_WEB_MANAGE_BASE
  return raw.endsWith('/') ? raw : `${raw}/`
}

export function webManageLink(base: string | null | undefined, params: ManageLinkParams = {}): string {
  const url = new URL(resolveManageBase(base))
  // Ids that are not UUIDs are dropped rather than encoded: the page would
  // reject them anyway, and nothing free-form belongs in this URL.
  if (isUuid(params.bountyId)) url.searchParams.set('bounty', params.bountyId.toLowerCase())
  if (isUuid(params.requestId)) url.searchParams.set('applicant', params.requestId.toLowerCase())
  if (params.view && params.view !== 'bounty') url.searchParams.set('view', params.view)
  url.searchParams.set('utm_source', 'bounty_email')
  url.searchParams.set('utm_medium', 'email')
  url.searchParams.set('utm_campaign', (params.campaign ?? 'bounty_update').replace(/[^a-z0-9_]/gi, '').slice(0, 60) || 'bounty_update')
  return url.toString()
}

export function webBountyCta(
  base: string | null | undefined,
  data: Record<string, unknown>
): { url: string; label: string } | null {
  const bountyId = data.bountyId ?? data.bounty_id
  if (!isUuid(bountyId)) return null

  // The completed-bounty proof request (fn_request_proof_consent) opens the
  // dashboard's "Share your result" view, where the poster answers.
  if (data.type === 'proof_consent_request') {
    return {
      url: webManageLink(base, { bountyId, view: 'share', campaign: 'proof_consent_request' }),
      label: 'Share your result',
    }
  }

  const requestId = data.requestId ?? data.request_id
  const hasRequest = isUuid(requestId)
  return {
    url: webManageLink(base, {
      bountyId,
      requestId: hasRequest ? requestId : undefined,
      view: hasRequest ? 'applicant' : 'bounty',
      campaign: typeof data.type === 'string' ? data.type : 'bounty_update',
    }),
    label: data.type === 'message' ? 'Reply on bountyfinder.net' : 'Open on bountyfinder.net',
  }
}

export function emailBountyCta(
  base: string | null | undefined,
  data: Record<string, unknown>
): { url: string; label: string } | null {
  const generated = webBountyCta(base, data)
  const label = typeof data.ctaLabel === 'string' && data.ctaLabel.trim() ? data.ctaLabel.trim() : undefined
  if (generated) return { ...generated, label: label ?? generated.label }

  const url = typeof data.ctaUrl === 'string' ? data.ctaUrl.trim() : ''
  return url.startsWith('https://') ? { url, label: label ?? 'Open Bounty' } : null
}
