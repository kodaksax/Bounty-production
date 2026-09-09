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
function buildEmail(category: string, title: string, body: string, _data: Record<string, unknown>): EmailContent {
  const appName = 'Bounty'
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
      <h2 style="margin: 0 0 12px; font-size: 18px; color: #111827;">${escapeHtml(subject)}</h2>
      <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.5; color: #374151;">${escapeHtml(body)}</p>
      <p style="margin: 24px 0 0; font-size: 12px; color: #9CA3AF;">You're receiving this because of your ${escapeHtml(category)} notification preferences in ${appName}. You can change this anytime in Settings &rsaquo; Notifications.</p>
    </div>`
  const text = `${subject}\n\n${body}\n\nManage this in Settings > Notifications.`
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

async function sendViaResend(apiKey: string, toEmail: string, content: EmailContent, fromEmail: string): Promise<boolean> {
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
      ...(replyToEmail ? { reply_to: replyToEmail } : {}),
    }),
  })
  if (!resp.ok) return providerError('Resend', resp)
  return true
}

async function sendViaSendGrid(apiKey: string, toEmail: string, content: EmailContent, fromEmail: string): Promise<boolean> {
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
      ...(replyToEmail ? { reply_to: { email: bareAddress(replyToEmail) } } : {}),
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
  const title: string = typeof payload.title === 'string' ? payload.title : ''
  const body: string = typeof payload.body === 'string' ? payload.body : ''
  const data: Record<string, unknown> = (payload.data && typeof payload.data === 'object') ? payload.data : {}

  if (userIds.length === 0) return jsonResponse({ message: 'No recipients' })

  // Cap per-invocation fan-out so a very large bundled recipient list can't
  // turn one outbox row into hundreds of sequential admin API calls; the
  // outbox retry path will pick up the remainder on the next attempt if this
  // ever matters in practice (not expected at current scale).
  const MAX_RECIPIENTS = 100
  const targetIds = userIds.slice(0, MAX_RECIPIENTS)

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const content = buildEmail(category, title, body, data)

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
      if (PROVIDER.name === 'resend' && PROVIDER.key) {
        const ok = await sendViaResend(PROVIDER.key, email, content, fromEmail)
        if (ok) sent++; else failed++
      } else if (PROVIDER.name === 'sendgrid' && PROVIDER.key) {
        const ok = await sendViaSendGrid(PROVIDER.key, email, content, fromEmail)
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
