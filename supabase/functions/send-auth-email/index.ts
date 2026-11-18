// Supabase Edge Function: send-auth-email
//
// Supabase Auth "Send Email" hook. Once the hook is enabled, Supabase stops
// sending auth emails over SMTP and calls this function for every one of them
// (sign-in code / magic link, password reset, signup confirm, invite, email
// change, reauthentication). This function sends them through the Resend API.
//
//   magiclink / email  -> Resend template "Sign In Code" (alias sign-in-code)
//   everything else    -> inline Bounty-styled email with the same code + link
//
// Where the button goes depends on where the code was requested:
//
//   In the app (redirect_to is bountyexpo-workspace://…):
//     https://<project>.supabase.co/functions/v1/open-app?token_hash=…&type=…
//     An https link, so Gmail keeps it (Gmail strips custom-scheme links). On
//     a phone it forwards to the app, which verifies the token itself
//     (verifyOtp). Nothing spends the token until the app does, so mail link
//     scanners cannot use it up. See supabase/functions/open-app.
//
//   On the website (redirect_to is https://…):
//     Supabase's own /auth/v1/verify link, exactly as before this hook.
//
// Auth: Standard Webhooks signature with SEND_EMAIL_HOOK_SECRET (the
// "v1,whsec_..." value generated when the hook is created). Deploy with
// verify_jwt = false; the signature check below is the authentication.

import { Webhook } from 'npm:standardwebhooks@1.0.0'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const HOOK_SECRET = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').replace('v1,whsec_', '')
const FROM = Deno.env.get('AUTH_FROM_EMAIL') || 'Bounty <notifications@bountyfinder.app>'
const REPLY_TO = 'support@bountyfinder.app'
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
const APP_SCHEME = 'bountyexpo-workspace://'
const SIGN_IN_TEMPLATE_ID = 'd8b727d3-9f33-46e4-9ce2-2c6e8d85a726' // "Sign In Code"

type EmailData = {
  token: string
  token_hash: string
  redirect_to: string
  email_action_type: string
  site_url: string
  token_new?: string
  token_hash_new?: string
}
type HookUser = { email?: string; new_email?: string }

// Hook action type -> GoTrue /verify type.
const VERIFY_TYPE: Record<string, string> = {
  magiclink: 'magiclink',
  email: 'magiclink',
  signup: 'signup',
  invite: 'invite',
  recovery: 'recovery',
  email_change: 'email_change',
}

type EmailLink = { url: string; opensApp: boolean }

function emailLink(tokenHash: string, actionType: string, redirectTo: string, siteUrl: string): EmailLink | null {
  const type = VERIFY_TYPE[actionType]
  if (!type || !tokenHash || !SUPABASE_URL) return null
  const redirect = (redirectTo || siteUrl || '').trim()

  if (redirect.startsWith(APP_SCHEME)) {
    const url = new URL(`${SUPABASE_URL}/functions/v1/open-app`)
    url.searchParams.set('token_hash', tokenHash)
    url.searchParams.set('type', type)
    return { url: url.toString(), opensApp: true }
  }

  const url = new URL(`${SUPABASE_URL}/auth/v1/verify`)
  url.searchParams.set('token', tokenHash)
  url.searchParams.set('type', type)
  if (redirect) url.searchParams.set('redirect_to', redirect)
  return { url: url.toString(), opensApp: false }
}

// Button copy for the sign-in template. Fixed strings only (inserted
// unescaped by Resend), never anything from the payload.
const SIGN_IN_BUTTON = {
  app: {
    label: 'Open in the Bounty app',
    hint: 'On your phone? Tap the button to open Bounty and sign in. On a computer? Type the code into Bounty.',
  },
  web: {
    label: 'Sign in to Bounty',
    hint: 'On a computer instead? Use the button to sign in.',
  },
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

const COPY: Record<string, { subject: string; headline: string; lead: string; button: string }> = {
  signup: {
    subject: 'Confirm your Bounty email',
    headline: 'Confirm your email.',
    lead: 'Enter this code in Bounty to confirm your email address.',
    button: 'Confirm email',
  },
  invite: {
    subject: "You're invited to Bounty",
    headline: "You're invited to Bounty.",
    lead: 'Use the button to accept your invite and set up your account.',
    button: 'Accept invite',
  },
  recovery: {
    subject: 'Reset your Bounty password',
    headline: 'Reset your password.',
    lead: 'Enter this code in Bounty, or use the button, to choose a new password.',
    button: 'Reset password',
  },
  email_change: {
    subject: 'Confirm your new Bounty email',
    headline: 'Confirm your email change.',
    lead: 'Enter this code in Bounty, or use the button, to confirm this email change.',
    button: 'Confirm change',
  },
  reauthentication: {
    subject: 'Your Bounty confirmation code',
    headline: 'Confirm it’s you.',
    lead: 'Enter this code in Bounty to continue.',
    button: '',
  },
}

const FONT = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

function inlineEmail(actionType: string, code: string, link: string | null) {
  const c = COPY[actionType] ?? {
    subject: 'Your Bounty code',
    headline: 'Here’s your code.',
    lead: 'Enter this code in Bounty to continue.',
    button: 'Continue',
  }
  const btn = link && c.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px;"><tr><td align="center" bgcolor="#00742A" style="border-radius:12px;background-color:#00742A;"><a href="${escapeHtml(link)}" target="_blank" style="display:inline-block;padding:16px 30px;font-family:${FONT};font-size:17px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:12px;">${escapeHtml(c.button)}&nbsp;&rarr;</a></td></tr></table>`
    : ''
  const codeBlock = code
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 22px;background-color:#FAF7F2;border:1px solid #E6DCCF;border-radius:14px;"><tr><td align="center" style="padding:18px 16px 20px;"><p style="margin:0 0 6px;font-family:${FONT};font-size:11px;line-height:16px;color:#5C615A;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">Your code</p><p style="margin:0;font-family:'SF Mono',Menlo,Consolas,'Courier New',monospace;font-size:34px;line-height:42px;font-weight:700;letter-spacing:8px;color:#121A15;">${escapeHtml(code)}</p></td></tr></table>`
    : ''
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>${escapeHtml(c.subject)}</title></head>
<body style="margin:0;padding:0;background-color:#F3EEE7;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#F3EEE7" style="background-color:#F3EEE7;"><tr><td align="center" style="padding:26px 10px 36px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;">
<tr><td style="padding:0 8px 16px;font-family:'Archivo Black','Arial Black',Arial,sans-serif;font-size:15px;line-height:20px;font-weight:900;letter-spacing:3px;color:#121A15;">BOUNTY</td></tr>
<tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E6DCCF;border-radius:20px;padding:34px 40px 10px;">
<h1 style="margin:0 0 14px;font-family:Archivo,'Helvetica Neue',Arial,sans-serif;font-size:29px;line-height:35px;font-weight:800;color:#121A15;">${escapeHtml(c.headline)}</h1>
<p style="margin:0 0 22px;font-family:${FONT};font-size:17px;line-height:27px;color:#3A403B;">${escapeHtml(c.lead)}</p>
${codeBlock}${btn}
<p style="margin:0 0 24px;font-family:${FONT};font-size:14px;line-height:22px;color:#5C615A;">This works once and expires soon. Didn’t ask for this? Ignore this email and your account stays as it is. Never share this code with anyone.</p>
</td></tr>
<tr><td style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:#5C615A;">Bounty · Got a task? Drop a bounty. · <a href="mailto:support@bountyfinder.app" style="color:#5C615A;">Get help</a></td></tr>
</table></td></tr></table></body></html>`
  const text = `${c.headline}\n\n${c.lead}\n\n${code ? `Your code: ${code}\n\n` : ''}${link && c.button ? `${c.button}: ${link}\n\n` : ''}This works once and expires soon. Didn't ask for this? Ignore this email. Never share this code with anyone.\n\nBounty · support@bountyfinder.app`
  return { subject: c.subject, html, text }
}

async function resend(body: Record<string, unknown>, idempotencyKey: string): Promise<Response> {
  return await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  })
}

async function sendOne(to: string, actionType: string, code: string, tokenHash: string, d: EmailData, idemKey: string): Promise<void> {
  const link = emailLink(tokenHash, actionType, d.redirect_to, d.site_url)
  const inline = inlineEmail(actionType, code, link?.url ?? null)

  if ((actionType === 'magiclink' || actionType === 'email') && link) {
    const button = link.opensApp ? SIGN_IN_BUTTON.app : SIGN_IN_BUTTON.web
    const resp = await resend({
      from: FROM,
      to: [to],
      reply_to: REPLY_TO,
      subject: `Your Bounty sign-in code: ${code}`,
      // `link.url` is built by URL(), so it is fully percent-encoded and cannot
      // contain < > or ". Passed raw so the plain-text part shows a clean URL.
      template: {
        id: SIGN_IN_TEMPLATE_ID,
        variables: {
          CODE: code.replace(/\D/g, ''),
          SIGN_IN_URL: link.url,
          BUTTON_LABEL: button.label,
          BUTTON_HINT: button.hint,
        },
      },
    }, `${idemKey}/tpl`)
    if (resp.ok) return
    const errBody = await resp.text().catch(() => '')
    // 4xx other than 409/429 = the template itself was refused; send the inline
    // version so a template problem never blocks someone from signing in.
    if (![400, 403, 404, 422].includes(resp.status)) {
      throw new Error(`Resend template send failed: ${resp.status} ${errBody.slice(0, 200)}`)
    }
    console.warn('[send-auth-email] template rejected, sending inline', resp.status, errBody.slice(0, 200))
    inline.subject = `Your Bounty sign-in code: ${code}`
  }

  const resp = await resend({ from: FROM, to: [to], reply_to: REPLY_TO, subject: inline.subject, html: inline.html, text: inline.text }, `${idemKey}/inline`)
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '')
    throw new Error(`Resend send failed: ${resp.status} ${errBody.slice(0, 200)}`)
  }
}

function hookError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return hookError(405, 'Method not allowed')
  if (!HOOK_SECRET || !RESEND_API_KEY) {
    console.error('[send-auth-email] missing SEND_EMAIL_HOOK_SECRET or RESEND_API_KEY')
    return hookError(500, 'Email sending is not configured')
  }

  const payload = await req.text()
  let user: HookUser
  let d: EmailData
  try {
    const wh = new Webhook(HOOK_SECRET)
    const verified = wh.verify(payload, Object.fromEntries(req.headers)) as { user: HookUser; email_data: EmailData }
    user = verified.user
    d = verified.email_data
  } catch (_e) {
    return hookError(401, 'Invalid signature')
  }

  const action = d.email_action_type
  // Webhook id makes a hook retry a no-op at Resend instead of a second email.
  const idemKey = `auth-email/${req.headers.get('webhook-id') ?? crypto.randomUUID()}`

  try {
    if (action === 'email_change') {
      // Secure email change: Supabase sends two emails. Note the naming is
      // inverted for backward compatibility: token_hash_new goes to the
      // CURRENT address, token_hash to the NEW one.
      if (d.token_hash_new && user.email) {
        await sendOne(user.email, action, d.token_new ?? '', d.token_hash_new, d, `${idemKey}/current`)
      }
      if (user.new_email) {
        await sendOne(user.new_email, action, d.token, d.token_hash, d, `${idemKey}/new`)
      }
    } else {
      if (!user.email) return hookError(400, 'User has no email')
      await sendOne(user.email, action, d.token, d.token_hash, d, idemKey)
    }
  } catch (e) {
    console.error('[send-auth-email] send failed', action, String(e))
    return hookError(500, 'Could not send email')
  }

  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
