// Supabase Edge Function: webhooks
// Handles POST /webhooks/stripe — Stripe webhook event processing.
// This is the most critical function to migrate as it processes payments
// and must verify Stripe's webhook signature.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno&no-check'
import type { WalletTransaction } from '../_shared/types.ts'

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Only handle the /stripe sub-path; reject anything else
  const url = new URL(req.url)
  const pathParts = url.pathname.split('/webhooks')
  const subPath = pathParts.length > 1 ? pathParts[1] : '/'
  if (subPath !== '/stripe') {
    return jsonResponse({ error: 'Not found' }, 404)
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!stripeKey || !webhookSecret) {
    console.error('[webhooks] Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET')
    return jsonResponse({ error: 'Webhook not configured' }, 500)
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Read raw body for signature verification
  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature')

  let event: Stripe.Event

  function hex(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer)
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  async function computeHmacSha256(key: string, data: string) {
    const enc = new TextEncoder()
    const keyData = enc.encode(key)
    const msgData = enc.encode(data)
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData)
    return hex(sig)
  }

  function safeCompare(a: string, b: string) {
    if (a.length !== b.length) return false
    let res = 0
    for (let i = 0; i < a.length; i++) {
      res |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return res === 0
  }

  async function verifyStripeSignature(payload: string, header: string | null, secret: string) {
    if (!header) return false
    // header like: t=timestamp,v1=signature[,v1=...]
    const headerParts = header.split(',').map(part => part.trim())
    const headerKeyValues: Record<string, string[]> = {}
    for (const part of headerParts) {
      const [key, value] = part.split('=')
      if (!headerKeyValues[key]) headerKeyValues[key] = []
      headerKeyValues[key].push(value)
    }
    const t = headerKeyValues['t']?.[0]
    const signatures = headerKeyValues['v1'] ?? []
    if (!t || signatures.length === 0) return false

    const signedPayload = `${t}.${payload}`
    const expected = await computeHmacSha256(secret, signedPayload)

    for (const s of signatures) {
      if (safeCompare(s, expected)) {
        // optional: validate timestamp skew (5 minutes)
        const ts = Number(t)
        if (Number.isFinite(ts)) {
          const now = Math.floor(Date.now() / 1000)
          if (Math.abs(now - ts) > 5 * 60) return false
        }
        return true
      }
    }
    return false
  }

  try {
    const verified = await verifyStripeSignature(rawBody, sig, webhookSecret)
    if (!verified) {
      console.error('[webhooks] Signature verification failed (manual):', {
        timestamp: new Date().toISOString(),
        rawBodyLength: typeof rawBody === 'string' ? rawBody.length : undefined,
      })
      return jsonResponse({ error: `Webhook signature verification failed` }, 400)
    }

    // signature verified — parse event
    event = JSON.parse(rawBody) as Stripe.Event
  } catch (err: unknown) {
    const e = err as { message?: string }
    console.error('[webhooks] Error parsing/verification:', e?.message ?? err)
    return jsonResponse({ error: 'Webhook verification/parsing failed' }, 400)
  }

  try {
    // Log event for tracking — upsert on stripe_event_id to safely handle retries
    await supabase.from('stripe_events').upsert(
      {
        stripe_event_id: event.id,
        event_type: event.type,
        event_data: event.data.object,
        processed: false,
      },
      { onConflict: 'stripe_event_id' },
    )

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        const userId = paymentIntent.metadata?.user_id

        if (!userId) {
          console.error('[webhooks] Missing user_id in payment intent metadata')
          break
        }

        const { data: transaction, error: txError } = await supabase
          .from('wallet_transactions')
          .insert({
            user_id: userId,
            type: 'deposit',
            amount: paymentIntent.amount / 100,
            description: 'Wallet deposit via Stripe',
            status: 'completed',
            stripe_payment_intent_id: paymentIntent.id,
            metadata: paymentIntent.metadata,
          })
          .select()
          .single()

        if (txError) {
          console.error('[webhooks] Error creating transaction:', txError)
          throw txError
        }

        const { error: balanceError } = await supabase.rpc('update_balance', {
          p_user_id: userId,
          p_amount: paymentIntent.amount / 100,
        })

        if (balanceError) {
          // Retry once
          const { error: retryError } = await supabase.rpc('update_balance', {
            p_user_id: userId,
            p_amount: paymentIntent.amount / 100,
          })
          if (retryError) {
            console.error('[webhooks] Atomic balance update failed after retry — letting Stripe retry', {
              user_id: userId,
              amount: paymentIntent.amount / 100,
              error: retryError,
            })
            // Throw so the webhook returns 500 and Stripe will retry delivery
            throw retryError
          }
        }

        console.log(`[webhooks] Transaction created: ${transaction.id}, balance updated for user ${userId}`)
        break
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        const userId = paymentIntent.metadata?.user_id
        const error = paymentIntent.last_payment_error

        console.log(`[webhooks] PaymentIntent failed: ${paymentIntent.id} for user ${userId}`)
        console.log(`[webhooks] Failure reason: ${error?.code} - ${error?.message}`)

        await supabase
          .from('stripe_events')
          .update({
            processed: true,
            processed_at: new Date().toISOString(),
            event_data: {
              ...(event.data.object as object),
              _processed_notes: `Payment failed: ${error?.code}`,
            },
          })
          .eq('stripe_event_id', event.id)
        break
      }

      case 'payment_intent.requires_action': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        console.log(`[webhooks] PaymentIntent requires action (3DS): ${paymentIntent.id}`)
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId = charge.payment_intent as string

        const { data: originalTx } = await supabase
          .from('wallet_transactions')
          .select('user_id, amount')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .single()

        if (originalTx) {
          const origTx = originalTx as Pick<WalletTransaction, 'user_id' | 'amount'>
          await supabase.from('wallet_transactions').insert({
            user_id: origTx.user_id,
            type: 'refund',
            amount: -(charge.amount_refunded / 100),
            description: 'Payment refunded',
            status: 'completed',
            stripe_charge_id: charge.id,
            // charge.refunds.data[0].reason gives the reason for the first refund
            metadata: { refund_reason: charge.refunds?.data?.[0]?.reason ?? null },
          })

          const { error: rpcError } = await supabase.rpc('update_balance', {
            p_user_id: origTx.user_id,
            p_amount: -(charge.amount_refunded / 100),
          })

          if (rpcError) {
            const { error: retryError } = await supabase.rpc('update_balance', {
              p_user_id: origTx.user_id,
              p_amount: -(charge.amount_refunded / 100),
            })
            if (retryError) {
              console.error('[webhooks] Atomic balance decrement for refund failed — letting Stripe retry')
              throw retryError
            }
          }

          console.log(`[webhooks] Refund processed for user ${origTx.user_id}`)
        }
        break
      }

      case 'transfer.created': {
        const transfer = event.data.object as Stripe.Transfer
        console.log(`[webhooks] Transfer created: ${transfer.id}`)
        const transferUserId = transfer.metadata?.user_id
        const transferAmountDollars = transfer.amount / 100
        if (transferUserId) {
          await supabase
            .from('wallet_transactions')
            .update({
              stripe_transfer_id: transfer.id,
              metadata: { transfer_status: 'created' },
            })
            .eq('user_id', transferUserId)
            .eq('type', 'withdrawal')
            .eq('amount', -transferAmountDollars)
            .is('stripe_transfer_id', null)
            .order('created_at', { ascending: false })
            .limit(1)
        }
        break
      }

      case 'transfer.paid': {
        const transfer = event.data.object as Stripe.Transfer
        console.log(`[webhooks] Transfer paid: ${transfer.id}`)
        await supabase
          .from('wallet_transactions')
          .update({
            status: 'completed',
            metadata: { transfer_status: 'paid', paid_at: new Date().toISOString() },
          })
          .eq('stripe_transfer_id', transfer.id)
        break
      }

      case 'transfer.failed': {
        const transfer = event.data.object as Stripe.Transfer
        console.log(`[webhooks] Transfer failed: ${transfer.id}`)
        const { data: tx } = await supabase
          .from('wallet_transactions')
          .update({
            status: 'failed',
            metadata: {
              transfer_status: 'failed',
              // Stripe Transfer objects expose failure_code on the Transfer type
              failure_reason: (transfer as Stripe.Transfer & { failure_code?: string }).failure_code,
              retry_count: 0,
            },
          })
          .eq('stripe_transfer_id', transfer.id)
          .select()
          .single()

        if (tx) {
          const txRow = tx as WalletTransaction
          const refundAmount = Math.abs(txRow.amount)
          const txUserId = txRow.user_id
          const { error: rpcError } = await supabase.rpc('update_balance', {
            p_user_id: txUserId,
            p_amount: refundAmount,
          })
          if (rpcError) {
            const { error: retryError } = await supabase.rpc('update_balance', {
              p_user_id: txUserId,
              p_amount: refundAmount,
            })
            if (retryError) {
              console.error('[webhooks] Atomic balance update for transfer refund failed — letting Stripe retry')
              throw retryError
            }
          }
          console.log(`[webhooks] Refunded $${refundAmount} to user ${txUserId} for failed transfer`)
        }
        break
      }

      case 'account.updated': {
        const account = event.data.object as Stripe.Account
        console.log(`[webhooks] Connect account updated: ${account.id}`)
        if (account.metadata?.user_id) {
          await supabase
            .from('profiles')
            .update({
              stripe_connect_onboarded_at:
                account.charges_enabled && account.payouts_enabled
                  ? new Date().toISOString()
                  : null,
            })
            .eq('id', account.metadata.user_id)
        }
        break
      }

      case 'payout.paid': {
        const payout = event.data.object as Stripe.Payout
        console.log(`[webhooks] Payout paid: ${payout.id} for $${payout.amount / 100}`)
        break
      }

      case 'payout.failed': {
        const payout = event.data.object as Stripe.Payout
        console.log(`[webhooks] Payout failed: ${payout.id}, reason: ${payout.failure_code}`)
        break
      }

      default:
        console.log(`[webhooks] Unhandled event type: ${event.type}`)
    }

    // Mark event as processed
    await supabase
      .from('stripe_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('stripe_event_id', event.id)

    return jsonResponse({ received: true })
  } catch (error: unknown) {
    const err = error as { message?: string }
    console.error('[webhooks] Error processing event:', err)
    return jsonResponse({ error: 'Webhook processing failed' }, 500)
  }

})

