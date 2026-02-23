// Supabase Edge Function: webhooks
// Handles POST /webhooks/stripe — Stripe webhook event processing.
// This is the most critical function to migrate as it processes payments
// and must verify Stripe's webhook signature.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno&no-check'
import type { Profile, WalletTransaction } from '../_shared/types.ts'

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

  if (!sig) {
    return jsonResponse({ error: 'Missing stripe-signature header' }, 400)
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (err: unknown) {
    const e = err as { message?: string }
    console.error('[webhooks] Signature verification failed:', e.message)
    return jsonResponse({ error: `Webhook signature verification failed: ${e.message}` }, 400)
  }

  console.log(`[webhooks] Received event: ${event.type} (${event.id})`)

  try {
    // Idempotency check
    const { data: existingEvent } = await supabase
      .from('stripe_events')
      .select('id, processed')
      .eq('stripe_event_id', event.id)
      .single()

    if (existingEvent?.processed) {
      console.log(`[webhooks] Event ${event.id} already processed`)
      return jsonResponse({ received: true, alreadyProcessed: true })
    }

    // Log event for tracking
    await supabase.from('stripe_events').upsert({
      stripe_event_id: event.id,
      event_type: event.type,
      event_data: event.data.object,
      processed: false,
    })

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

        const { error: balanceError } = await supabase.rpc('increment_balance', {
          p_user_id: userId,
          p_amount: paymentIntent.amount / 100,
        })

        if (balanceError) {
          // Retry once
          const { error: retryError } = await supabase.rpc('increment_balance', {
            p_user_id: userId,
            p_amount: paymentIntent.amount / 100,
          })
          if (retryError) {
            console.error('[webhooks] Atomic balance update failed after retry, using fallback', {
              user_id: userId,
              amount: paymentIntent.amount / 100,
            })
            const { data: profile } = await supabase
              .from('profiles')
              .select('balance')
              .eq('id', userId)
              .single()
            const currentBalance = (profile as Profile | null)?.balance ?? 0
            await supabase
              .from('profiles')
              .update({ balance: currentBalance + paymentIntent.amount / 100 })
              .eq('id', userId)
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

          const { error: rpcError } = await supabase.rpc('decrement_balance', {
            p_user_id: origTx.user_id,
            p_amount: charge.amount_refunded / 100,
          })

          if (rpcError) {
            const { error: retryError } = await supabase.rpc('decrement_balance', {
              p_user_id: origTx.user_id,
              p_amount: charge.amount_refunded / 100,
            })
            if (retryError) {
              console.error('[webhooks] Atomic balance decrement for refund failed, using fallback')
              const { data: profile } = await supabase
                .from('profiles')
                .select('balance')
                .eq('id', origTx.user_id)
                .single()
              const currentBalance = (profile as Profile | null)?.balance ?? 0
              await supabase
                .from('profiles')
                .update({ balance: Math.max(0, currentBalance - charge.amount_refunded / 100) })
                .eq('id', origTx.user_id)
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
          const { error: rpcError } = await supabase.rpc('increment_balance', {
            p_user_id: txUserId,
            p_amount: refundAmount,
          })
          if (rpcError) {
            const { error: retryError } = await supabase.rpc('increment_balance', {
              p_user_id: txUserId,
              p_amount: refundAmount,
            })
            if (retryError) {
              console.error('[webhooks] Atomic balance update for transfer refund failed, using fallback')
              const { data: profile } = await supabase
                .from('profiles')
                .select('balance')
                .eq('id', txUserId)
                .single()
              const currentBalance = (profile as Profile | null)?.balance ?? 0
              await supabase
                .from('profiles')
                .update({ balance: currentBalance + refundAmount })
                .eq('id', txUserId)
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
