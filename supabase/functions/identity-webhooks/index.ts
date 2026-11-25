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
import { type ApplyResult, NOTIFICATION_TYPE_BY_STATUS } from './logic.ts'

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

// Notification redesign (2026-07-25): Verification category notifications go
// through notifications_outbox (drained by the drain-notifications-outbox
// pg_cron job within ~1 minute), so they get the full in-app + push + email +
// preference + quiet-hours treatment like every other outbox-driven event.
//
// Every identity event goes through one RPC that, in a single transaction
// holding the profile's row lock, applies the never-off-verified rule, writes
// the status, supersedes this user's undelivered verification notifications
// that no longer match, and queues the new one. See logic.ts and migration
// 20261125200000. Doing the write and the insert as two calls let a slow
// processing response queue "Verification Submitted" after "Identity Verified".
//
// A failure throws, so the handler returns 500 and Stripe retries the event;
// nothing was committed, so the retry is clean. Redelivery of an event that
// did commit stops earlier, at the stripe_events.processed check.
async function applyIdentityEvent(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  params: {
    userId: string
    status: string
    rejectionReason?: string | null
    notification?: { title: string; body: string } | null
  }
): Promise<ApplyResult> {
  const type = NOTIFICATION_TYPE_BY_STATUS[params.status]
  const { data, error } = await supabase.rpc('apply_identity_webhook_event', {
    p_user_id: params.userId,
    p_status: params.status,
    p_rejection_reason: params.rejectionReason ?? null,
    p_notification: params.notification ? { type, ...params.notification } : null,
  })
  if (error) throw new Error(`apply_identity_webhook_event failed: ${error.message ?? JSON.stringify(error)}`)
  return data as ApplyResult
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


    let result: ApplyResult | null = null
    switch (event.type) {
      case 'identity.verification_session.verified': {
        // Always wins; supersedes any queued submitted/rejected/canceled notice.
        result = await applyIdentityEvent(supabase, {
          userId,
          status: 'verified',
          notification: {
            title: 'Identity Verified',
            body: 'Your identity has been successfully verified.',
          },
        })
        break
      }
      case 'identity.verification_session.requires_input': {
        const rejectionReason = extractRejectionReason(session)
        result = await applyIdentityEvent(supabase, {
          userId,
          status: 'requires_input',
          rejectionReason,
          // Only notify when there's an actual rejection reason — requires_input
          // also fires on the initial "waiting for the user to submit" state,
          // which isn't a meaningful transition worth pushing a notification for.
          notification: rejectionReason
            ? {
                title: 'Identity Verification Needs Attention',
                body: `We couldn't verify your identity (${rejectionReason}). Please resubmit your documents.`,
              }
            : null,
        })
        break
      }
      case 'identity.verification_session.processing': {
        // The event that raced verified in production.
        result = await applyIdentityEvent(supabase, {
          userId,
          status: 'processing',
          notification: {
            title: 'Verification Submitted',
            body: "We're reviewing your identity verification. This usually takes a few minutes.",
          },
        })
        break
      }
      case 'identity.verification_session.canceled': {
        result = await applyIdentityEvent(supabase, {
          userId,
          status: 'canceled',
          notification: {
            title: 'Verification Canceled',
            body: 'Your identity verification session was canceled.',
          },
        })
        break
      }
      default:
        console.log(`[identity-webhooks] Unhandled event type: ${event.type}`)
    }

    if (result && !result.applied) {
      console.log(`[identity-webhooks] event=${event.id} ${event.type} ignored: ${result.reason}`)
    } else if (result && result.superseded > 0) {
      console.log(`[identity-webhooks] event=${event.id} ${event.type} superseded ${result.superseded} queued notification(s)`)
    }

    await supabase.from('stripe_events').update({ processed: true }).eq('stripe_event_id', event.id)

    return jsonResponse({ received: true })
  } catch (err) {
    console.error(`[identity-webhooks] Error handling event=${event.id} type=${event.type}:`, err)
    return jsonResponse({ error: 'Webhook handler failed' }, 500)
  }
})
