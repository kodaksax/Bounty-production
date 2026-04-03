// Supabase Edge Function: webhooks
// Handles POST /webhooks/stripe — Stripe webhook event processing.
// This is the most critical function to migrate as it processes payments
// and must verify Stripe's webhook signature.
//
// Events handled:
//   payment_intent.succeeded      – record deposit + update balance
//   payment_intent.payment_failed – log failure details
//   payment_intent.requires_action– log 3DS challenge
//   payment_intent.canceled       – log cancellation
//   setup_intent.succeeded        – save payment method to DB
//   setup_intent.setup_failed     – log setup failure
//   charge.refunded               – record refund + reverse balance
//   charge.dispute.created        – log dispute + notify user
//   charge.dispute.closed         – log resolution
//   transfer.created / paid / failed
//   account.updated               – track Connect onboarding
//   payout.paid / failed          – notify hunter

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

/**
 * Attempt an RPC call with one automatic retry.
 * If both attempts fail the last error is thrown so Stripe can retry the webhook.
 */
async function rpcWithRetry(
  supabase: ReturnType<typeof createClient>,
  rpcName: string,
  params: Record<string, unknown>,
  context: string,
) {
  const { error } = await supabase.rpc(rpcName, params)
  if (!error) return
  console.warn(`[webhooks] ${context} – first attempt failed, retrying`, { error })
  const { error: retryError } = await supabase.rpc(rpcName, params)
  if (retryError) {
    console.error(`[webhooks] ${context} – retry also failed, letting Stripe retry`, { retryError })
    throw retryError
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Accept both /webhooks (Stripe-registered URL) and /webhooks/stripe
  const { pathname } = new URL(req.url)
  if (!pathname.endsWith('/webhooks') && !pathname.endsWith('/webhooks/stripe')) {
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
    // Log event for tracking — upsert on stripe_event_id to safely handle retries.
    // Use enhanced tracking fields (status, retry_count) from the webhook tracking migration.
    await supabase.from('stripe_events').upsert(
      {
        stripe_event_id: event.id,
        event_type: event.type,
        event_data: event.data.object,
        processed: false,
        status: 'processing',
      },
      { onConflict: 'stripe_event_id' },
    )

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        const userId = paymentIntent.metadata?.user_id

        if (!userId) {
          console.error('[webhooks] Missing user_id in payment intent metadata', {
            paymentIntentId: paymentIntent.id,
          })
          await supabase
            .from('stripe_events')
            .update({
              status: 'failed',
              last_error: 'Missing user_id in payment intent metadata',
            })
            .eq('stripe_event_id', event.id)
          break
        }

        // Idempotency: check if a transaction with this stripe_payment_intent_id
        // already exists to prevent double-crediting on webhook retries.
        const { data: existingTx } = await supabase
          .from('wallet_transactions')
          .select('id')
          .eq('stripe_payment_intent_id', paymentIntent.id)
          .maybeSingle()

        if (existingTx) {
          console.log(`[webhooks] Transaction already exists for PaymentIntent ${paymentIntent.id}, skipping`)
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
          // Handle unique constraint violation gracefully (concurrent webhook delivery)
          const errMsg = (txError as { message?: string })?.message ?? ''
          if (/unique|duplicate|constraint/i.test(errMsg)) {
            console.log(`[webhooks] Duplicate transaction insert for PaymentIntent ${paymentIntent.id}, skipping`)
            break
          }
          console.error('[webhooks] Error creating transaction:', txError)
          throw txError
        }

        await rpcWithRetry(
          supabase,
          'update_balance',
          { p_user_id: userId, p_amount: paymentIntent.amount / 100 },
          `balance update for payment_intent.succeeded ${paymentIntent.id}`,
        )

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
            status: 'processed',
            event_data: {
              ...(event.data.object as object),
              _processed_notes: `Payment failed: ${error?.code}`,
            },
          })
          .eq('stripe_event_id', event.id)
        break
      }

      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        const userId = paymentIntent.metadata?.user_id
        console.log(`[webhooks] PaymentIntent canceled: ${paymentIntent.id} for user ${userId}`)

        await supabase
          .from('stripe_events')
          .update({
            processed: true,
            processed_at: new Date().toISOString(),
            status: 'processed',
            event_data: {
              ...(event.data.object as object),
              _processed_notes: 'Payment intent canceled',
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

      case 'setup_intent.succeeded': {
        const setupIntent = event.data.object as Stripe.SetupIntent
        const userId = setupIntent.metadata?.user_id
        const paymentMethodId = typeof setupIntent.payment_method === 'string'
          ? setupIntent.payment_method
          : (setupIntent.payment_method as { id?: string } | null)?.id

        console.log(`[webhooks] SetupIntent succeeded: ${setupIntent.id} for user ${userId}`)

        if (!userId) {
          console.error('[webhooks] Missing user_id in setup intent metadata', {
            setupIntentId: setupIntent.id,
          })
          await supabase
            .from('stripe_events')
            .update({
              status: 'failed',
              last_error: 'Missing user_id in setup intent metadata',
            })
            .eq('stripe_event_id', event.id)
          break
        }

        if (!paymentMethodId) {
          console.error('[webhooks] Missing payment_method in setup intent', {
            setupIntentId: setupIntent.id,
          })
          await supabase
            .from('stripe_events')
            .update({
              status: 'failed',
              last_error: 'Missing payment_method in setup intent',
            })
            .eq('stripe_event_id', event.id)
          break
        }

        // Retrieve full payment method details from Stripe
        let pm: Stripe.PaymentMethod
        try {
          pm = await stripe.paymentMethods.retrieve(paymentMethodId)
        } catch (stripeErr) {
          console.error('[webhooks] Failed to retrieve payment method from Stripe', {
            paymentMethodId,
            error: stripeErr,
          })
          throw stripeErr
        }

        // Upsert into payment_methods table (idempotent on stripe_payment_method_id)
        const { error: upsertError } = await supabase
          .from('payment_methods')
          .upsert(
            {
              user_id: userId,
              stripe_payment_method_id: pm.id,
              type: pm.type ?? 'card',
              card_brand: pm.card?.brand ?? null,
              card_last4: pm.card?.last4 ?? null,
              card_exp_month: pm.card?.exp_month ?? null,
              card_exp_year: pm.card?.exp_year ?? null,
            },
            { onConflict: 'stripe_payment_method_id' },
          )

        if (upsertError) {
          console.error('[webhooks] Failed to upsert payment method', {
            userId,
            paymentMethodId: pm.id,
            error: upsertError,
          })
          throw upsertError
        }

        console.log(`[webhooks] Payment method ${pm.id} saved for user ${userId}`)
        break
      }

      case 'setup_intent.setup_failed': {
        const setupIntent = event.data.object as Stripe.SetupIntent
        const userId = setupIntent.metadata?.user_id
        const failError = (setupIntent as unknown as { last_setup_error?: { code?: string; message?: string } }).last_setup_error

        console.warn(`[webhooks] SetupIntent failed: ${setupIntent.id} for user ${userId}`, {
          errorCode: failError?.code,
          errorMessage: failError?.message,
        })

        await supabase
          .from('stripe_events')
          .update({
            processed: true,
            processed_at: new Date().toISOString(),
            status: 'processed',
            event_data: {
              ...(event.data.object as object),
              _processed_notes: `Setup failed: ${failError?.code ?? 'unknown'}`,
            },
          })
          .eq('stripe_event_id', event.id)
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId = charge.payment_intent as string

        const { data: originalTx } = await supabase
          .from('wallet_transactions')
          .select('user_id, amount')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .maybeSingle()

        if (originalTx) {
          const origTx = originalTx as Pick<WalletTransaction, 'user_id' | 'amount'>
          await supabase.from('wallet_transactions').insert({
            user_id: origTx.user_id,
            type: 'refund',
            amount: -(charge.amount_refunded / 100),
            description: 'Payment refunded',
            status: 'completed',
            stripe_charge_id: charge.id,
            metadata: { refund_reason: charge.refunds?.data?.[0]?.reason ?? null },
          })

          await rpcWithRetry(
            supabase,
            'update_balance',
            { p_user_id: origTx.user_id, p_amount: -(charge.amount_refunded / 100) },
            `balance decrement for charge.refunded ${charge.id}`,
          )

          console.log(`[webhooks] Refund processed for user ${origTx.user_id}`)
        } else {
          console.warn(`[webhooks] No original transaction found for refund, paymentIntentId: ${paymentIntentId}`)
        }
        break
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
        console.warn(`[webhooks] Dispute created: ${dispute.id} for charge ${chargeId}, amount: $${dispute.amount / 100}`)

        // Look up the original transaction to find the affected user
        if (chargeId) {
          const { data: originalTx } = await supabase
            .from('wallet_transactions')
            .select('user_id')
            .eq('stripe_charge_id', chargeId)
            .maybeSingle()

          // Also try by payment_intent if charge lookup fails
          let affectedUserId = (originalTx as { user_id?: string } | null)?.user_id
          if (!affectedUserId && dispute.payment_intent) {
            const piId = typeof dispute.payment_intent === 'string'
              ? dispute.payment_intent
              : dispute.payment_intent?.id
            if (piId) {
              const { data: piTx } = await supabase
                .from('wallet_transactions')
                .select('user_id')
                .eq('stripe_payment_intent_id', piId)
                .maybeSingle()
              affectedUserId = (piTx as { user_id?: string } | null)?.user_id
            }
          }

          if (affectedUserId) {
            await supabase.from('notifications').insert({
              user_id: affectedUserId,
              type: 'payment',
              title: 'Payment Dispute Received',
              body: `A dispute of $${(dispute.amount / 100).toFixed(2)} has been filed against a payment. Our team is reviewing this.`,
              data: { disputeId: dispute.id, chargeId, reason: dispute.reason },
            })
            console.log(`[webhooks] Notified user ${affectedUserId} of dispute ${dispute.id}`)
          } else {
            console.warn(`[webhooks] Could not find user for disputed charge ${chargeId}`)
          }
        }
        break
      }

      case 'charge.dispute.closed': {
        const dispute = event.data.object as Stripe.Dispute
        console.log(`[webhooks] Dispute closed: ${dispute.id}, status: ${dispute.status}`)
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

          await rpcWithRetry(
            supabase,
            'update_balance',
            { p_user_id: txUserId, p_amount: refundAmount },
            `balance refund for transfer.failed ${transfer.id}`,
          )

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
        const paidAccountId = (event as any).account as string | undefined
        console.log(`[webhooks] Payout paid: ${payout.id} for $${payout.amount / 100}`)

        if (paidAccountId) {
          const { data: paidProfile, error: paidProfileError } = await supabase
            .from('profiles')
            .select('id')
            .eq('stripe_connect_account_id', paidAccountId)
            .maybeSingle()

          if (paidProfileError) {
            console.error('[webhooks] Supabase error looking up profile for payout.paid', {
              accountId: paidAccountId,
              error: paidProfileError,
            })
            throw paidProfileError
          }

          if (paidProfile) {
            const { error: notifError } = await supabase.from('notifications').insert({
              user_id: paidProfile.id,
              type: 'payment',
              title: 'Payout Successful',
              body: `Your payout of $${(payout.amount / 100).toFixed(2)} has been processed and sent to your bank account.`,
              data: { payoutId: payout.id },
            })
            if (notifError) {
              console.error('[webhooks] Failed to insert payout.paid notification', {
                profileId: paidProfile.id,
                error: notifError,
              })
              throw notifError
            }
            console.log(`[webhooks] Notified hunter ${paidProfile.id} of payout.paid`)
          } else {
            console.warn(`[webhooks] No profile found for Connect account ${paidAccountId}`)
          }
        }
        break
      }

      case 'payout.failed': {
        const payout = event.data.object as Stripe.Payout
        const failedAccountId = (event as any).account as string | undefined
        console.log(`[webhooks] Payout failed: ${payout.id}, reason: ${payout.failure_code}`)

        if (failedAccountId) {
          const { data: failedProfile, error: failedProfileError } = await supabase
            .from('profiles')
            .select('id')
            .eq('stripe_connect_account_id', failedAccountId)
            .maybeSingle()

          if (failedProfileError) {
            console.error('[webhooks] Supabase error looking up profile for payout.failed', {
              accountId: failedAccountId,
              error: failedProfileError,
            })
            throw failedProfileError
          }

          if (failedProfile) {
            const { error: notifError } = await supabase.from('notifications').insert({
              user_id: failedProfile.id,
              type: 'payment',
              title: 'Payout Failed',
              body: `Your payout of $${(payout.amount / 100).toFixed(2)} could not be processed. ${payout.failure_message || payout.failure_code || 'Please update your bank account details.'}`,
              data: { payoutId: payout.id, failureCode: payout.failure_code, failureMessage: payout.failure_message },
            })
            if (notifError) {
              console.error('[webhooks] Failed to insert payout.failed notification', {
                profileId: failedProfile.id,
                error: notifError,
              })
              throw notifError
            }
            // Flag the profile so support can follow up
            const { error: payoutFlagError } = await supabase
              .from('profiles')
              .update({ payout_failed_at: new Date().toISOString() })
              .eq('id', failedProfile.id)
            if (payoutFlagError) {
              console.error('[webhooks] Failed to flag profile payout_failed_at', {
                profileId: failedProfile.id,
                error: payoutFlagError,
              })
              throw payoutFlagError
            }
            console.log(`[webhooks] Notified hunter ${failedProfile.id} of payout.failed`)
          } else {
            console.warn(`[webhooks] No profile found for Connect account ${failedAccountId}`)
          }
        }
        break
      }

      default:
        console.log(`[webhooks] Unhandled event type: ${event.type}`)
    }

    // Mark event as processed
    await supabase
      .from('stripe_events')
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        status: 'processed',
      })
      .eq('stripe_event_id', event.id)

    return jsonResponse({ received: true })
  } catch (error: unknown) {
    const err = error as { message?: string }
    console.error('[webhooks] Error processing event:', err)

    // Update event tracking with failure details for monitoring / DLQ
    try {
      await supabase
        .from('stripe_events')
        .update({
          status: 'failed',
          last_error: err.message ?? 'Unknown processing error',
          last_retry_at: new Date().toISOString(),
        })
        .eq('stripe_event_id', event!.id)
    } catch {
      // Best-effort; don't mask the original error
    }

    return jsonResponse({ error: 'Webhook processing failed' }, 500)
  }

})

