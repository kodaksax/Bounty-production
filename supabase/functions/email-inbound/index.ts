// Supabase Edge Function: email-inbound
//
// Makes "reply ACCEPT" a supported path, safely.
//
// Incident 2026-10-07: a poster replied "Accept" to an applicant email. The
// reply went to support@ (the Reply-To on every notification), nothing read
// it, and the applicant was never accepted. This function receives replies to
// notification emails (Resend inbound, event `email.received`) and turns each
// one into:
//   1. a support case a person can see (public.support_cases), and
//   2. an email to the poster's ACCOUNT address with a one-tap link to
//      confirm on the website, where they must be signed in.
// It NEVER accepts, declines or pays from a reply. See logic.ts for why.
//
// HOW A REPLY IS MATCHED
//   process-notification sends applicant emails with
//   Reply-To: reply+<token>@<EMAIL_REPLY_DOMAIN>, where <token> keys a row in
//   email_reply_contexts (poster, bounty, applicant, expiry). The token — not
//   the From header, not the subject — identifies the bounty. Unknown or
//   expired tokens, and replies to any other address on the domain, become an
//   'email_reply_unmatched' case for a person, and nobody is emailed back
//   (there's no verified account to send to).
//
// SETUP (nothing here is live until all of it is done)
//   - DNS: MX for EMAIL_REPLY_DOMAIN (a subdomain such as reply.bountyfinder.net,
//     so support@'s existing mail is untouched) -> Resend inbound.
//   - Resend: webhook for `email.received` -> this function's URL.
//   - Secrets: RESEND_INBOUND_WEBHOOK_SECRET (whsec_...), EMAIL_REPLY_DOMAIN
//     (here, in process-notification and in send-notification-email),
//     RESEND_API_KEY (already set; used to fetch the reply body).
//   - config.toml: verify_jwt = false (Resend can't send a Supabase JWT; the
//     Svix signature is the authentication).

declare const Deno: any

// @ts-ignore: runtime URL import for the Deno edge runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseReplyToken, resolveReplyDomain } from '../_shared/reply-context.ts'
import { capture, openSupportCase } from '../_shared/support-cases.ts'
import { webManageLink } from '../_shared/web-links.ts'
import {
  bareEmail,
  buildReplyAck,
  classifyReplyIntent,
  extractReplyText,
  shouldSendAck,
  verifySvixSignature,
} from './logic.ts'

const REPLY_DOMAIN = resolveReplyDomain(Deno.env.get('EMAIL_REPLY_DOMAIN'))
const WEB_MANAGE_BASE = Deno.env.get('WEB_MANAGE_BASE')

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const secret = Deno.env.get('RESEND_INBOUND_WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret || !supabaseUrl || !serviceKey || !REPLY_DOMAIN) {
    // Not configured: refuse rather than accept unverifiable mail.
    return json({ error: 'Inbound email is not configured' }, 503)
  }

  const rawBody = await req.text()
  const verified = await verifySvixSignature(
    secret,
    { id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature') },
    rawBody
  )
  if (!verified) return json({ error: 'Invalid signature' }, 401)

  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (event?.type !== 'email.received') return json({ ignored: true })

  const data = event.data ?? {}
  const emailId: string = typeof data.email_id === 'string' ? data.email_id : ''
  const subject: string = typeof data.subject === 'string' ? data.subject.slice(0, 200) : ''
  const fromAddress = bareEmail(Array.isArray(data.from) ? data.from[0] : data.from)
  // Resend retries a webhook until it gets a 2xx; the case dedupe key makes a
  // retry a no-op instead of a second case and a second acknowledgement.
  const dedupeKey = `inbound:${emailId || req.headers.get('svix-id')}`

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: already } = await admin.from('support_cases').select('id').eq('dedupe_key', dedupeKey).maybeSingle()
  if (already) return json({ ok: true, duplicate: true })

  const token = parseReplyToken(data.to, REPLY_DOMAIN)
  const { data: context } = token
    ? await admin
        .from('email_reply_contexts')
        .select('token, poster_id, bounty_id, request_id, expires_at, last_reply_at, reply_count')
        .eq('token', token)
        .maybeSingle()
    : { data: null }
  const live = context && Date.parse(context.expires_at) > Date.now()

  // The reply's own words, if Resend lets us read them (webhooks carry only
  // metadata; the body is a separate API call). Best-effort: without it the
  // reply still becomes a case and the poster still gets a link.
  const replyText = await fetchReplyText(emailId)
  const intent = classifyReplyIntent(replyText)

  if (!live) {
    const opened = await openSupportCase(admin, supabaseUrl, serviceKey, {
      kind: 'email_reply_unmatched',
      channel: 'email',
      posterId: null,
      bountyId: null,
      summary: `A reply came in that we couldn't match to a bounty${context ? ' (its link had expired)' : ''}. Subject: "${subject}". ${replyText ? `Message: ${replyText.slice(0, 1500)}` : ''}`,
      // Support needs the sender's address to answer. support_cases is
      // service-role only and never feeds analytics.
      metadata: { from: fromAddress, intent, expired: Boolean(context), email_id: emailId },
      dedupeKey,
    })
    if (!opened.id) return json({ error: 'Could not record this reply' }, 503)
    if (!opened.created) return json({ ok: true, duplicate: true })
    capture('system', 'email_reply_received', { matched: false, intent })
    return json({ ok: true, matched: false })
  }

  const [{ data: bounty }, { data: account }] = await Promise.all([
    admin.from('bounties').select('id, title, status').eq('id', context.bounty_id).maybeSingle(),
    admin.auth.admin.getUserById(context.poster_id),
  ])
  const accountEmail = bareEmail(account?.user?.email)
  const fromMatchesAccount = Boolean(accountEmail) && accountEmail === fromAddress

  const opened = await openSupportCase(admin, supabaseUrl, serviceKey, {
    kind: 'email_reply',
    channel: 'email',
    posterId: context.poster_id,
    bountyId: context.bounty_id,
    requestId: context.request_id,
    summary:
      `Poster replied to an applicant email${intent !== 'other' ? ` (reads as "${intent}")` : ''}. ` +
      `${fromMatchesAccount ? 'Sent from their account address.' : 'NOT sent from their account address — do not act on it without checking.'} ` +
      `We emailed them a confirm link. ${replyText ? `Message: ${replyText.slice(0, 1500)}` : `Subject: "${subject}"`}`,
    metadata: { intent, from_matches_account: fromMatchesAccount, email_id: emailId, bounty_status: bounty?.status ?? null },
    dedupeKey,
  })
  if (!opened.id) return json({ error: 'Could not record this reply' }, 503)
  if (!opened.created) return json({ ok: true, duplicate: true })

  let acknowledged = false
  if (shouldSendAck(context.last_reply_at)) {
    const ack = buildReplyAck(intent, bounty?.title ?? null)
    const view = context.request_id ? 'applicant' : 'bounty'
    try {
      // To the ACCOUNT address (userIds), never to the reply's From.
      const resp = await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          userIds: [context.poster_id],
          category: 'marketplace',
          type: 'email_reply_ack',
          title: ack.title,
          body: ack.body,
          data: {
            bountyId: context.bounty_id,
            ctaUrl: webManageLink(WEB_MANAGE_BASE, { bountyId: context.bounty_id, requestId: context.request_id, view, campaign: 'reply_ack' }),
            ctaLabel: ack.ctaLabel,
            helpUrl: webManageLink(WEB_MANAGE_BASE, { bountyId: context.bounty_id, view: 'help', campaign: 'reply_ack' }),
          },
        }),
      })
      acknowledged = resp.ok
    } catch (e) {
      console.error('[email-inbound] acknowledgement failed (case still opened)', String(e))
    }
  }

  await admin
    .from('email_reply_contexts')
    .update({ last_reply_at: new Date().toISOString(), reply_count: (context.reply_count ?? 0) + 1 })
    .eq('token', context.token)

  capture(context.poster_id, 'email_reply_received', {
    matched: true, intent, acknowledged, from_matches_account: fromMatchesAccount, bounty_id: context.bounty_id,
  })
  return json({ ok: true, matched: true, acknowledged })
})

async function fetchReplyText(emailId: string): Promise<string> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key || !emailId) return ''
  try {
    const resp = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) return ''
    const email = await resp.json()
    return extractReplyText(typeof email?.text === 'string' ? email.text : '')
  } catch {
    return ''
  }
}
