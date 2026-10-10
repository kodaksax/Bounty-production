// Supabase Edge Function: contact-support
// POST { subject, message, appVersion?, platform? } from the in-app Contact
// Support form (Settings > Feedback & Support). Emails the support inbox via
// Resend so the user never has to leave the app or have a mail app set up.
//
// Auth: any signed-in user. The sender's account email becomes reply_to, so
// support can answer by replying to the message. The caller cannot choose the
// recipient — it is fixed server-side.
//
// Uses the same RESEND_API_KEY / NOTIFICATION_FROM_EMAIL secrets as
// send-notification-email, so no new secrets are needed.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

const SUPPORT_TO_EMAIL = Deno.env.get('SUPPORT_TO_EMAIL') || 'support@bountyfinder.app'
const fromEmail = Deno.env.get('NOTIFICATION_FROM_EMAIL') || 'Bounty <notifications@bountyfinder.app>'

const MAX_SUBJECT_LENGTH = 200
const MAX_MESSAGE_LENGTH = 5000

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Invalid method' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!supabaseUrl || !serviceRoleKey || !resendKey) {
    console.error('[contact-support] Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or RESEND_API_KEY')
    return jsonResponse({ error: 'Support messaging is temporarily unavailable.' }, 500)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Please sign in to contact support.' }, 401)
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.substring(7))
  if (authError || !user) {
    return jsonResponse({ error: 'Please sign in to contact support.' }, 401)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400)
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!subject) return jsonResponse({ error: 'Subject is required' }, 400)
  if (!message) return jsonResponse({ error: 'Message is required' }, 400)
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return jsonResponse({ error: `Subject must be ${MAX_SUBJECT_LENGTH} characters or fewer` }, 400)
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` }, 400)
  }
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.slice(0, 50) : 'unknown'
  const platform = typeof body.platform === 'string' ? body.platform.slice(0, 20) : 'unknown'

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()
  const username = (profile as { username?: string } | null)?.username || ''
  const userEmail = user.email || ''

  const meta = [
    ['User ID', user.id],
    ['Username', username || '(none)'],
    ['Account email', userEmail || '(none)'],
    ['App version', appVersion],
    ['Platform', platform],
  ]
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 600px; padding: 16px;">
      <h2 style="margin: 0 0 12px; font-size: 18px; color: #111827;">${escapeHtml(subject)}</h2>
      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.5; color: #374151; white-space: pre-wrap;">${escapeHtml(message)}</p>
      <table style="font-size: 12px; color: #6B7280; border-collapse: collapse;">
        ${meta.map(([k, v]) => `<tr><td style="padding: 2px 12px 2px 0;">${k}</td><td>${escapeHtml(v)}</td></tr>`).join('')}
      </table>
    </div>`
  const text = `${subject}\n\n${message}\n\n${meta.map(([k, v]) => `${k}: ${v}`).join('\n')}`

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromEmail,
      to: [SUPPORT_TO_EMAIL],
      subject: `[Support] ${subject}`,
      html,
      text,
      // Replying to the support email goes straight to the user.
      ...(userEmail ? { reply_to: userEmail } : {}),
    }),
  })

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '')
    console.error('[contact-support] Resend error', resp.status, errBody.slice(0, 300))
    return jsonResponse({ error: 'Could not send your message. Please try again.' }, 502)
  }

  const result = await resp.json().catch(() => ({}))
  console.log('[contact-support] sent', { userId: user.id, emailId: (result as { id?: string }).id })
  return jsonResponse({ success: true, id: (result as { id?: string }).id })
})
