// Supabase Edge Function: identity-webhooks
// Dedicated webhook endpoint for Stripe Identity events (identity.verification_session.*).
//
// Kept separate from supabase/functions/webhooks/index.ts (the payments/payout
// webhook handler) deliberately:
//   1. Stripe Identity events are delivered to their own registered endpoint
//      URL with their own signing secret (STRIPE_IDENTITY_WEBHOOK_SECRET) --
//      Identity events are not delivered to the Connect/payments endpoint
//      unless explicitly configured otherwise.
//   2. webhooks/index.ts processes payments/payouts -- keeping identity
//      (non-money-moving) events out of that file means a bug here can never
//      affect payout/transfer reconciliation logic.
//   3. Matches the existing precedent of connect/index.ts already being a
//      separate function from webhooks/index.ts for a related reason.
//
// verifyStripeSignature is duplicated here rather than imported, matching
// this project's existing convention (local imports aren't supported across
// edge functions; see webhooks/index.ts's own verifyStripeSignature).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'npm:stripe@14'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function hex(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function computeHmacSha256(key: string, data: string) {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data))
  return hex(sig)
}

function safeCompare(a: string, b: string) {
  if (a.length !== b.length) return false
  let res = 0
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return res === 0
}

async function verifyStripeSignature(payload: string, header: string | null, secret: string) {
  if (!header) return false
  const headerParts = header.split(',').map((part) => part.trim())
  const headerKeyValues: Record<string, string[]> = {}
  for (const part of headerParts) {
    const [key, value] = part.split('=')
    if (!headerKeyValues[key]) headerKeyValues[key] = []
    headerKeyValues[key].push(value)
  }
  const t = headerKeyValues['t']?.[0]
  const signatures = headerKeyValues['v1'] ?? []
  if (!t || signatures.length === 0) return false

  const expected = await computeHmacSha256(secret, `${t}.${payload}`)
  for (const s of signatures) {
    if (safeCompare(s, expected)) {
      const ts = Number(t)
      if (Number.isFinite(ts) && Math.abs(Math.floor(Date.now() / 1000) - ts) > 5 * 60) return false
      return true
    }
  }
  return false
}

function extractRejectionReason(session: Stripe.Identity.VerificationSession): string | null {
  const lastError = session.last_error
  if (lastError?.reason) return lastError.reason
  const checks = session.last_verification_report as unknown as
    | { document?: { error?: { reason?: string } }; selfie?: { error?: { reason?: string } } }
    | null
    | undefined
  return checks?.document?.error?.reason ?? checks?.selfie?.error?.reason ?? null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get('STRIPE_IDENTITY_WEBHOOK_SECRET')
  if (!stripeKey || !webhookSecret) {
    console.error('[identity-webhooks] Missing STRIPE_SECRET_KEY or STRIPE_IDENTITY_WEBHOOK_SECRET')
    return jsonResponse({ error: 'Webhook not configured' }, 500)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature')

  let event: Stripe.Event
  try {
    const verified = await verifyStripeSignature(rawBody, sig, webhookSecret)
    if (!verified) {
      console.error('[identity-webhooks] Signature verification failed')
      return jsonResponse({ error: 'Webhook signature verification failed' }, 400)
    }
    event = JSON.parse(rawBody) as Stripe.Event
  } catch (err) {
    console.error('[identity-webhooks] Error parsing/verifying:', err)
    return jsonResponse({ error: 'Webhook verification/parsing failed' }, 400)
  }

  // Idempotency: reuse the same stripe_events ledger the payments webhook
  // uses. If this event id was already processed, acknowledge and stop --
  // Stripe retries deliver the same event id, never a new one, for a retry.
  const { data: existingEvent } = await supabase
    .from('stripe_events')
    .select('processed')
    .eq('stripe_event_id', event.id)
    .maybeSingle()

  if (existingEvent?.processed) {
    return jsonResponse({ received: true, alreadyProcessed: true })
  }

  await supabase.from('stripe_events').upsert(
    { stripe_event_id: event.id, event_type: event.type, event_data: event.data.object, processed: false },
    { onConflict: 'stripe_event_id' }
  )

  try {
    const session = event.data.object as Stripe.Identity.VerificationSession
    const userId = session.metadata?.user_id

    if (!userId) {
      console.warn(`[identity-webhooks] event=${event.id} type=${event.type} has no metadata.user_id`)
      return jsonResponse({ received: true })
    }

    const now = new Date().toISOString()

    switch (event.type) {
      case 'identity.verification_session.verified': {
        // Fetch current verified_since so we never overwrite an already-set
        // timestamp -- verified_since must be set once and never move.
        const { data: current } = await supabase
          .from('profiles')
          .select('verified_since')
          .eq('id', userId)
          .single()

        await supabase
          .from('profiles')
          .update({
            stripe_identity_status: 'verified',
            id_verification_rejection_reason: null,
            verified_since: current?.verified_since ?? now,
            stripe_identity_last_event_at: now,
            // Mirror legacy columns so existing readers (getVerificationBadges,
            // admin views) keep working during the dormant old-flow period.
            id_verification_status: 'verified',
            age_verified: true,
            age_verified_at: now,
          })
          .eq('id', userId)
        break
      }
      case 'identity.verification_session.requires_input': {
        await supabase
          .from('profiles')
          .update({
            stripe_identity_status: 'requires_input',
            id_verification_rejection_reason: extractRejectionReason(session),
            stripe_identity_last_event_at: now,
          })
          .eq('id', userId)
        break
      }
      case 'identity.verification_session.processing': {
        await supabase
          .from('profiles')
          .update({ stripe_identity_status: 'processing', stripe_identity_last_event_at: now })
          .eq('id', userId)
        break
      }
      case 'identity.verification_session.canceled': {
        await supabase
          .from('profiles')
          .update({ stripe_identity_status: 'canceled', stripe_identity_last_event_at: now })
          .eq('id', userId)
        break
      }
      default:
        console.log(`[identity-webhooks] Unhandled event type: ${event.type}`)
    }

    await supabase.from('stripe_events').update({ processed: true }).eq('stripe_event_id', event.id)

    return jsonResponse({ received: true })
  } catch (err) {
    console.error(`[identity-webhooks] Error handling event=${event.id} type=${event.type}:`, err)
    return jsonResponse({ error: 'Webhook handler failed' }, 500)
  }
})
