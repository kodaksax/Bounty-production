// Supabase Edge Function: send-notification-email
// POST { userIds: string[], category, type, title, body, data } from
// process-notification's email fan-out step. Isolated from the push-send
// critical path so an email provider outage never affects push delivery.
//
// Auth: same pattern as send-expo-push — caller must present the service
// role key as a bearer token (not just any authenticated JWT), since this
// function resolves and emails arbitrary users given a userIds list.
//
// SendGrid: if SENDGRID_API_KEY is not configured (true in every environment
// as of 2026-07-25 — no key has been provisioned yet), emails are logged to
// the function's console instead of sent. This is intentional so the pipeline
// is fully wired and testable before a real provider key exists.

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

async function sendViaSendGrid(apiKey: string, toEmail: string, content: EmailContent, fromEmail: string): Promise<boolean> {
  const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: fromEmail },
      subject: content.subject,
      content: [
        { type: 'text/plain', value: content.text },
        { type: 'text/html', value: content.html },
      ],
    }),
  })
  if (!resp.ok) {
    console.error('[send-notification-email] SendGrid error', resp.status, await resp.text().catch(() => ''))
    return false
  }
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
  const sendGridKey = Deno.env.get('SENDGRID_API_KEY')
  const fromEmail = Deno.env.get('NOTIFICATION_FROM_EMAIL') || 'notifications@bountyapp.com'

  let sent = 0
  let failed = 0
  await Promise.all(targetIds.map(async (userId) => {
    try {
      const { data: userResp, error } = await supabaseAdmin.auth.admin.getUserById(userId)
      const email = userResp?.user?.email
      if (error || !email) {
        console.error('[send-notification-email] could not resolve email for user', userId, error)
        failed++
        return
      }
      if (sendGridKey) {
        const ok = await sendViaSendGrid(sendGridKey, email, content, fromEmail)
        if (ok) sent++; else failed++
      } else {
        // No provider configured — log instead of silently no-op-ing so the
        // pipeline is visibly exercised end-to-end during testing.
        console.log('[send-notification-email] (console fallback, no SENDGRID_API_KEY)', { to: email, subject: content.subject })
        sent++
      }
    } catch (e) {
      console.error('[send-notification-email] send failed for user', userId, e)
      failed++
    }
  }))

  return jsonResponse({ ok: failed === 0, sent, failed, provider: sendGridKey ? 'sendgrid' : 'console' })
})
