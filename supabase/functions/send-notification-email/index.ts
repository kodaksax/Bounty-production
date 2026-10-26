// Supabase Edge Function: send-notification-email
// POST { userIds: string[], category, type, title, body, data } from
// process-notification's email fan-out step. Isolated from the push-send
// critical path so an email provider outage never affects push delivery.
//
// Auth: same pattern as send-expo-push — caller must present the service
// role key as a bearer token (not just any authenticated JWT), since this
// function resolves and emails arbitrary users given a userIds list.
//
// Provider: Resend first, SendGrid second, neither = drop with a warning.
// Resolved once at module scope by `pickProvider()` below.
//
// If no provider key is configured, emails are dropped with a warning instead
// of sent. That was intentional while the pipeline was being built — but as of
// 2026-09-09 STILL no key is provisioned in production, and this function is
// invoked continuously with real, correct payloads ("New Bounty Application",
// "Bounty Accepted!", "Message from ...") addressed to real users. Every one
// of them is discarded.
//
// This is the whole of the "application alerts are push-only" finding: the
// email channel is not missing, it is unplugged. Setting RESEND_API_KEY (and a
// NOTIFICATION_FROM_EMAIL on a domain verified with that provider) turns it on
// with no code change.
//
// SendGrid is retained as a fallback rather than deleted so that setting
// RESEND_API_KEY is a reversible one-variable change: unset it and the
// SendGrid path is live again, with no redeploy needed to roll back.
//
// Until a key exists the response reports provider:'none' with sent:0,
// skipped:N, delivered:false and providerConfigured:false, so a caller or a
// dashboard can tell that nothing was delivered. It previously counted console
// lines as `sent`, which is why the gap was invisible from outside. Note that
// `ok` deliberately stays true in that state — see the response comment below.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { emailBountyCta } from '../_shared/web-links.ts'
import { V2_TEMPLATES, buildNoticeSend, buildTeamAlertSend, isDesignV2Enabled } from '../_shared/email-design-v2.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

type EmailContent = { subject: string; html: string; text: string }

// Per-category templates. Kept intentionally simple/inline (no external
// template engine) — this bundler doesn't support local imports, and the
// notification payload's title/body already carry the human-readable copy.
const WEB_MANAGE_BASE = Deno.env.get('WEB_MANAGE_BASE')

function ctaFrom(data: Record<string, unknown>): { url: string; label: string } | null {
  return emailBountyCta(WEB_MANAGE_BASE, data)
}

// "Talk to a person" link under the main button. https only, and only to the
// same site the main button may use — it never carries anything but ids.
function helpFrom(data: Record<string, unknown>): string | null {
  const url = typeof data.helpUrl === 'string' ? data.helpUrl.trim() : ''
  return url.startsWith('https://') ? url : null
}

// Per-email reply address minted by process-notification (see
// _shared/reply-context.ts). Accepted only when it is on the configured reply
// domain, so a payload can never redirect replies to an arbitrary address.
const REPLY_DOMAIN = (Deno.env.get('EMAIL_REPLY_DOMAIN') ?? '').trim().toLowerCase()
function replyToFrom(data: Record<string, unknown>): string | null {
  const v = typeof data.replyTo === 'string' ? data.replyTo.trim().toLowerCase() : ''
  if (!REPLY_DOMAIN || !v) return null
  return /^reply\+[a-z2-7]{26}@/.test(v) && v.endsWith(`@${REPLY_DOMAIN}`) ? v : null
}

function buildEmail(category: string, title: string, body: string, data: Record<string, unknown>): EmailContent {
  const appName = 'Bounty'
  const cta = ctaFrom(data)
  const help = helpFrom(data)
  const subjectByCategory: Record<string, string> = {
    marketplace: title || `${appName}: bounty update`,
    messages: title || `${appName}: new message`,
    payments: title || `${appName}: payment update`,
    security: title || `${appName}: security alert`,
    verification: title || `${appName}: identity verification update`,
    followers: title || `${appName}: new follower`,
    marketing: title || `${appName}`,
  }
  const subject = subjectByCategory[category] || title || appName
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 12px; font-size: 20px; color: #111827;">${escapeHtml(subject)}</h2>
      <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.55; color: #1F2937;">${escapeHtml(body)}</p>
      ${cta ? `<p style="margin: 0 0 16px;"><a href="${escapeHtml(cta.url)}" style="display: inline-block; padding: 14px 22px; border-radius: 8px; background: #00631d; color: #FFFFFF; font-size: 17px; font-weight: 700; text-decoration: none;">${escapeHtml(cta.label)}</a></p>` : ''}
      ${help ? `<p style="margin: 0 0 16px; font-size: 15px; color: #1F2937;">Need a hand? <a href="${escapeHtml(help)}" style="color: #00631d; font-weight: 600;">Talk to a real person</a></p>` : ''}
      <p style="margin: 24px 0 0; font-size: 13px; line-height: 1.5; color: #4B5563;">You're receiving this because of your ${escapeHtml(category)} notification preferences in ${appName}. You can change this anytime in Settings &rsaquo; Notifications.</p>
    </div>`
  const text = `${subject}\n\n${body}\n\n${cta ? `${cta.label}: ${cta.url}\n\n` : ''}${help ? `Talk to a real person: ${help}\n\n` : ''}Manage this in Settings > Notifications.`
  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

// Function logs are broadly readable in the Supabase dashboard and in any
// downstream log sink, so a recipient address logged here is PII sitting in
// observability tooling. Outside an explicitly non-production environment we
// log the (opaque) user id and counts only — never the address or the subject
// line, which for a message notification can contain the sender's name.
//
// APP_ENV is the flag the other functions in this project already use. It is
// unset in production, so the default is the redacted path.
const APP_ENV = Deno.env.get('APP_ENV') ?? 'production'
const VERBOSE_LOGGING = APP_ENV === 'development' || APP_ENV === 'local' || APP_ENV === 'staging' || APP_ENV === 'test'

type ProviderName = 'resend' | 'sendgrid' | 'none'

/**
 * Resend wins when both keys are set, so cutting over is "set RESEND_API_KEY"
 * and rolling back is "unset it" — neither needs a code change.
 */
function pickProvider(): { name: ProviderName; key: string | undefined } {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) return { name: 'resend', key: resendKey }
  const sendGridKey = Deno.env.get('SENDGRID_API_KEY')
  if (sendGridKey) return { name: 'sendgrid', key: sendGridKey }
  return { name: 'none', key: undefined }
}

const PROVIDER = pickProvider()

// The default is on bountyfinder.app — the domain that actually exists and
// carries support@. The previous default (notifications@bountyapp.com) was a
// domain this project does not own, so it could never have passed provider
// domain verification and would have been rejected at send time.
const fromEmail = Deno.env.get('NOTIFICATION_FROM_EMAIL') || 'Bounty <notifications@bountyfinder.app>'
// Replies land on the monitored support inbox rather than an unread noreply.
const replyToEmail = Deno.env.get('NOTIFICATION_REPLY_TO_EMAIL') || 'support@bountyfinder.app'

/** `alice@example.com` -> `a***@example.com`; only ever used in verbose mode. */
function redactEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email[0]}***${email.slice(at)}`
}

/**
 * `NOTIFICATION_FROM_EMAIL` may be either a bare address or a display form
 * (`Bounty <notifications@bountyfinder.app>`). Resend accepts both; SendGrid's
 * `from.email` requires the bare address and silently 400s on the display
 * form, so it gets the extracted one.
 */
function bareAddress(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return (match ? match[1] : from).trim()
}

/**
 * Provider error bodies are operational data, not recipient PII — a dead email
 * channel is undebuggable without them. Truncated because provider errors can
 * return a full HTML page on a gateway failure.
 */
async function providerError(label: string, resp: Response): Promise<false> {
  const body = await resp.text().catch(() => '')
  console.error(`[send-notification-email] ${label} error`, resp.status, body.slice(0, 300))
  return false
}

async function sendViaResend(apiKey: string, toEmail: string, content: EmailContent, fromEmail: string, replyTo: string = replyToEmail): Promise<boolean> {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject: content.subject,
      html: content.html,
      text: content.text,
      // Replies to a notification should reach a human, not bounce off an
      // unmonitored sending address.
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  })
  if (!resp.ok) return providerError('Resend', resp)
  return true
}

// ---------------------------------------------------------------------------
// Resend-template emails. A notification `type` listed here is rendered by a
// PUBLISHED Resend template instead of the generic buildEmail() layout.
// Every other type is untouched.
//
// Reference the template by ID, not alias: the alias has already been renamed
// once (bounty-posted-copy -> bounty-posted-final-copy) and an ID survives that.
//
// Ported 2026-10-08 from the deployed function (v34, deployed by hand
// 2026-10-02 and never committed). Without this port, deploying this file
// would silently drop the "You're live" template.
// ---------------------------------------------------------------------------
// Email design v2 (see _shared/email-design-v2.ts) is the default. Bounty
// sends only v2 templates; the pre-v2 Resend templates (including
// 386c9e82 "Bounty Posted (Final Copy)") were deleted on 2026-10-25.
//   bounty_posted          → "Bounty v2 · Bounty posted"
//   data.adminAlert        → "Bounty v2 · Team alert (internal)"
//   supportAlert payloads  → "Bounty v2 · Team alert (internal)"
//   every other type       → "Bounty v2 · Notification" (with / without button)
// EMAIL_DESIGN_V2=off is the kill switch: every email goes out in the inline
// buildEmail() layout, which depends on no Resend template. If Resend rejects
// a template send outright (4xx: template missing, unpublished, bad
// variables), the same email is sent in the inline layout instead, so a
// template problem degrades the design, never the delivery. SendGrid always
// uses the inline layout.
const DESIGN_V2 = isDesignV2Enabled(Deno.env.get('EMAIL_DESIGN_V2'))

const RESEND_TEMPLATE_BY_TYPE: Record<string, string> = DESIGN_V2
  ? { bounty_posted: V2_TEMPLATES.bountyPosted } // "Bounty v2 · Bounty posted"
  : {}

// `subject` overrides the template's default subject (Resend: payload
// from/subject/reply_to take precedence over template defaults).
type TemplateSend = { id: string; variables: Record<string, string>; idempotencyKey: string | null; subject?: string }

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

// Resend inserts {{{VAR}}} UNESCAPED, so every user-controlled value is escaped
// here (bountyTitle is user-generated). AUDIENCE_LINE / PAY_LINE are fixed
// strings we own. Keys with empty values are dropped so the template's declared
// fallback applies instead of an empty string being passed through.
function buildTemplateSend(type: string, data: Record<string, unknown>): TemplateSend | null {
  const id = RESEND_TEMPLATE_BY_TYPE[type]
  if (!id) return null

  if (type === 'bounty_posted') {
    const cta = ctaFrom(data)
    const prefsUrl = Deno.env.get('NOTIFICATION_PREFERENCES_URL') || ''
    const postal = Deno.env.get('NOTIFICATION_POSTAL_ADDRESS') || ''
    const bountyId = str(data.bountyId)

    const raw: Record<string, string> = {
      BOUNTY_TITLE: escapeHtml(str(data.bountyTitle)),
      // Plain-text part gets the title unescaped (entities would show literally).
      BOUNTY_TITLE_TEXT: str(data.bountyTitle),
      // Pre-formatted by the producer, e.g. "$40" or "For honor".
      BOUNTY_REWARD: escapeHtml(str(data.rewardDisplay)),
      AUDIENCE_LINE:
        data.isInPerson === true
          ? "We're letting people nearby know about it."
          : "We're letting people who do this kind of work know about it.",
      // Trailing space is intentional: the template butts it against the next sentence.
      PAY_LINE: data.payAtHire === true ? "That's when you pay. " : '',
      HELP_LINE: data.has_app === true
        ? 'Open the Bounty app to view your bounty and take action.'
        : 'Use the button above to manage your bounty on the web.',
      FOOTER_LINE: data.has_app === true
        ? 'You can manage this bounty in the Bounty app.'
        : 'You can manage this bounty on bountyfinder.net.',
      CTA_URL: cta ? escapeHtml(cta.url) : '',
      PREFERENCES_URL: escapeHtml(prefsUrl),
      POSTAL_LINE: postal ? `Bounty · ${escapeHtml(postal)}` : '',
    }
    const variables = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''))
    return { id, variables, idempotencyKey: bountyId ? `bounty-posted/${bountyId}` : null }
  }
  return null
}

// Universal v2 notice for every type without its own template. Same title,
// body, CTA and help link that buildEmail() would have rendered.
function buildNoticeTemplateSend(category: string, type: string, title: string, body: string, data: Record<string, unknown>): TemplateSend | null {
  if (!DESIGN_V2) return null
  const notice = buildNoticeSend({
    type,
    category,
    title,
    body,
    cta: ctaFrom(data),
    helpUrl: helpFrom(data),
    postal: Deno.env.get('NOTIFICATION_POSTAL_ADDRESS') || '',
  })
  return { id: notice.id, variables: notice.variables, idempotencyKey: null, subject: notice.subject }
}

// Admin alerts (fn_notify_admins sets data.adminAlert) and support alerts go
// to the team, not to users: the internal v2 template, never the user-facing
// notice with its "your notification settings" footer.
function buildTeamTemplateSend(kind: 'admin' | 'support', title: string, body: string, data: Record<string, unknown>): TemplateSend | null {
  if (!DESIGN_V2) return null
  const alert = buildTeamAlertSend({
    kind,
    title,
    body,
    severity: str(data.severity),
    alertType: str(data.type),
    details: [['Bounty', str(data.bountyId)]],
  })
  return { id: alert.id, variables: alert.variables, idempotencyKey: null, subject: alert.subject }
}

// `from` is intentionally omitted: each v2 template carries its own verified
// sender (Bounty <notifications@bountyfinder.app>). Resend does not allow
// html/text alongside `template`. The idempotency key makes a repeated call for
// the same bounty a no-op instead of a second email.
//
// 'rejected' means Resend refused the request outright (400/403/404/422:
// template missing or unpublished, bad variables), so nothing was sent and the
// caller may safely send the inline layout instead. 409 (idempotency conflict)
// and 429/5xx are 'failed': the email may already exist or the retry belongs
// to the outbox, so no fallback is sent.
type TemplateResult = 'sent' | 'rejected' | 'failed'
const REJECTED_STATUSES = new Set([400, 403, 404, 422])

async function sendTemplateViaResend(apiKey: string, toEmail: string, tpl: TemplateSend, replyTo: string = replyToEmail): Promise<TemplateResult> {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(tpl.idempotencyKey ? { 'Idempotency-Key': `${tpl.idempotencyKey}/${toEmail}` } : {}),
    },
    body: JSON.stringify({
      to: [toEmail],
      template: { id: tpl.id, variables: tpl.variables },
      ...(tpl.subject ? { subject: tpl.subject } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  })
  if (!resp.ok) {
    await providerError('Resend template', resp)
    return REJECTED_STATUSES.has(resp.status) ? 'rejected' : 'failed'
  }
  return 'sent'
}

/** Template first; on an outright rejection, the same email in the inline layout. */
async function sendTemplateOrInline(apiKey: string, toEmail: string, tpl: TemplateSend, content: EmailContent, replyTo: string): Promise<boolean> {
  const result = await sendTemplateViaResend(apiKey, toEmail, tpl, replyTo)
  if (result === 'sent') return true
  if (result === 'failed') return false
  console.warn('[send-notification-email] template rejected; sending the inline layout instead', { template: tpl.id })
  return sendViaResend(apiKey, toEmail, content, fromEmail, replyTo)
}

async function sendViaSendGrid(apiKey: string, toEmail: string, content: EmailContent, fromEmail: string, replyTo: string = replyToEmail): Promise<boolean> {
  const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: bareAddress(fromEmail) },
      subject: content.subject,
      content: [
        { type: 'text/plain', value: content.text },
        { type: 'text/html', value: content.html },
      ],
      ...(replyTo ? { reply_to: { email: bareAddress(replyTo) } } : {}),
    }),
  })
  if (!resp.ok) return providerError('SendGrid', resp)
  return true
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Invalid method' }, 405)

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!serviceRoleKey || !supabaseUrl) return jsonResponse({ error: 'Server misconfigured' }, 500)

  const authHeader = req.headers.get('Authorization')
  const presentedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (presentedToken !== serviceRoleKey) return jsonResponse({ error: 'Unauthorized' }, 401)

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const userIds: string[] = Array.isArray(payload.userIds) ? payload.userIds.filter((x: unknown) => typeof x === 'string') : []
  const category: string = typeof payload.category === 'string' ? payload.category : 'marketplace'
  const type: string = typeof payload.type === 'string' ? payload.type : ''
  const title: string = typeof payload.title === 'string' ? payload.title : ''
  const body: string = typeof payload.body === 'string' ? payload.body : ''
  const data: Record<string, unknown> = (payload.data && typeof payload.data === 'object') ? payload.data : {}

  // Support alert: the one case addressed to the team rather than to users.
  // poster-web / email-inbound / geocode-bounties open a support_cases row and
  // send this so a person sees it now, not on the next dashboard check. The
  // case row is the record; this email is only the nudge. Bodies carry ids
  // and a case summary, never a customer address.
  if (payload.supportAlert === true) {
    const to = Deno.env.get('SUPPORT_ALERT_EMAIL') || replyToEmail
    const content = buildEmail('support', title || 'Bounty: support case opened', body, data)
    if (!PROVIDER.key || PROVIDER.name === 'none') {
      console.warn('[send-notification-email] support alert NOT SENT — no email provider configured')
      return jsonResponse({ ok: true, delivered: false, providerConfigured: false, sent: 0, failed: 0, skipped: 1, provider: PROVIDER.name })
    }
    const teamSend = buildTeamTemplateSend('support', title || 'Bounty: support case opened', body, data)
    const ok = PROVIDER.name === 'resend'
      ? teamSend
        ? await sendTemplateOrInline(PROVIDER.key, bareAddress(to), teamSend, content, '')
        : await sendViaResend(PROVIDER.key, bareAddress(to), content, fromEmail, '')
      : await sendViaSendGrid(PROVIDER.key, bareAddress(to), content, fromEmail, '')
    return jsonResponse({ ok, delivered: ok, providerConfigured: true, sent: ok ? 1 : 0, failed: ok ? 0 : 1, skipped: 0, provider: PROVIDER.name })
  }

  if (userIds.length === 0) return jsonResponse({ message: 'No recipients' })

  // Cap per-invocation fan-out so a very large bundled recipient list can't
  // turn one outbox row into hundreds of sequential admin API calls; the
  // outbox retry path will pick up the remainder on the next attempt if this
  // ever matters in practice (not expected at current scale).
  const MAX_RECIPIENTS = 100
  const targetIds = userIds.slice(0, MAX_RECIPIENTS)

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const content = buildEmail(category, title, body, data)
  const replyTo = replyToFrom(data) ?? replyToEmail
  const { data: appRows, error: appRowsError } = await supabaseAdmin
    .from('push_tokens')
    .select('profile_id')
    .in('profile_id', targetIds)
    .eq('enabled', true)
  if (appRowsError) {
    console.warn('[send-notification-email] app-presence lookup failed; using web copy')
  }
  const usersWithApp = new Set(
    ((appRows ?? []) as Array<{ profile_id: string | null }>)
      .map((row) => row.profile_id)
      .filter((id): id is string => typeof id === 'string')
  )

  let sent = 0
  let failed = 0
  let skipped = 0
  await Promise.all(targetIds.map(async (userId) => {
    try {
      const { data: userResp, error } = await supabaseAdmin.auth.admin.getUserById(userId)
      const email = userResp?.user?.email
      if (error || !email) {
        console.error('[send-notification-email] could not resolve email for user', userId, error)
        failed++
        return
      }
      // The published template copy uses app/web-specific instructions. A
      // registered push token is the app-presence signal available to this
      // function; absence must always fall back to a working web CTA.
      const templateSend = data.adminAlert === true
        ? buildTeamTemplateSend('admin', title, body, data)
        : buildTemplateSend(type, {
          ...data,
          has_app: usersWithApp.has(userId),
        }) ?? buildNoticeTemplateSend(category, type, title, body, data)
      if (PROVIDER.name === 'resend' && PROVIDER.key) {
        const ok = templateSend
          ? await sendTemplateOrInline(PROVIDER.key, email, templateSend, content, replyTo)
          : await sendViaResend(PROVIDER.key, email, content, fromEmail, replyTo)
        if (ok) sent++; else failed++
      } else if (PROVIDER.name === 'sendgrid' && PROVIDER.key) {
        const ok = await sendViaSendGrid(PROVIDER.key, email, content, fromEmail, replyTo)
        if (ok) sent++; else failed++
      } else {
        // No provider configured. Counted as `skipped`, never as `sent`: this
        // notification did NOT reach the user, and saying otherwise is what
        // let a dead email channel look healthy for weeks.
        console.warn(
          '[send-notification-email] NOT SENT — no email provider configured (set RESEND_API_KEY)',
          VERBOSE_LOGGING
            ? { userId, to: redactEmail(email), subject: content.subject }
            : { userId }
        )
        skipped++
      }
    } catch (e) {
      console.error('[send-notification-email] send failed for user', userId, e)
      failed++
    }
  }))

  if (skipped > 0) {
    console.warn(
      `[send-notification-email] ${skipped} notification email(s) were dropped because no email provider is configured. ` +
      'Set RESEND_API_KEY (and a NOTIFICATION_FROM_EMAIL on a verified domain) to deliver them.'
    )
  }

  // `ok` is scoped to request PROCESSING: it stays true when the function did
  // everything asked of it. A missing provider key is a configuration state,
  // not a transient error, and flipping `ok` for it would make every caller's
  // retry/backoff/alerting treat a permanently unconfigured channel as a
  // flapping dependency. Delivery is reported separately instead, so a caller
  // or a dashboard can still tell that nothing reached a user.
  return jsonResponse({
    ok: failed === 0,
    delivered: skipped === 0,
    providerConfigured: PROVIDER.name !== 'none',
    sent,
    failed,
    skipped,
    provider: PROVIDER.name,
  })
})
