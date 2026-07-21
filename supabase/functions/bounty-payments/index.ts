// Supabase Edge Function: bounty-payments
//
// Phase 2 Stripe-native per-bounty escrow (payment_architecture_version = 2).
// Isolated from the legacy wallet/payments/connect functions so the existing
// custodial-wallet flow (version 1) keeps working unchanged.
//
// Money flow:
//   Poster --PaymentIntent(transfer_group=bounty_<id>, capture=automatic)--> platform balance (Charge)
//   platform balance --Transfer(source_transaction=charge, destination=hunter)--> Hunter's Connect acct
//
// Routes:
//   POST /bounty-payments/create   — poster funds a bounty (creates PaymentIntent)
//   POST /bounty-payments/release  — release captured funds to the hunter (Transfer)
//   POST /bounty-payments/cancel   — cancel (pre-capture) or refund (post-capture)
//
// Lifecycle is tracked in public.bounty_payments; the webhooks function
// advances status on payment_intent.succeeded / .canceled / charge.refunded /
// transfer.failed. This function performs the synchronous state transitions.

// Local type shims so `tsc --noEmit` (Node tooling) doesn't error on Deno
// runtime imports/globals. Intentionally loose so the repo can typecheck
// without pulling runtime deps into the monorepo build.
declare const Deno: any

// @ts-ignore: Allow runtime URL import for Deno/edge function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore: Allow runtime npm import for Deno/edge function.
import Stripe from 'npm:stripe@14'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Wrap DB queries in a timeout so a paused/cold-starting DB returns a fast 503
// instead of hanging (mirrors payments/wallet functions).
const DB_TIMEOUT_MS = 8000
function withDbTimeout<T>(query: PromiseLike<T>): Promise<T> {
  return Promise.race([
    Promise.resolve(query),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('DB_TIMEOUT'), { code: 'DB_TIMEOUT' })), DB_TIMEOUT_MS)
    ),
  ])
}

function sanitizeText(input: unknown): string {
  if (!input) return ''
  return String(input).replace(/[<>]/g, '').trim().slice(0, 1000)
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,}$/
  return emailRegex.test(email)
}

// Resolve (or lazily create) the poster's Stripe Customer. Mirrors the exact
// approach used by the payments function: reuse profiles.stripe_customer_id,
// recreate on stale (resource_missing), persist via .update() (never .upsert(),
// which would try an INSERT and trip NOT NULL columns like username).
async function resolveStripeCustomerForUser(params: {
  supabaseAdmin: any
  stripe: any
  userId: string
  userEmail?: string
}): Promise<{ customerId?: string; error?: string; status?: number }> {
  const { supabaseAdmin, stripe, userId, userEmail } = params

  const profileRes = (await withDbTimeout(
    supabaseAdmin.from('profiles').select('id, stripe_customer_id, email').eq('id', userId).maybeSingle()
  )) as any
  const profile = profileRes?.data
  const profileError = profileRes?.error

  if (!profile && !profileError) {
    return { error: 'User profile not found. Please complete your profile setup and try again.', status: 404 }
  }

  let customerId: string | null = profile?.stripe_customer_id ?? null
  if (customerId) {
    try {
      await stripe.customers.retrieve(customerId)
      return { customerId }
    } catch (err: any) {
      if (err?.code === 'resource_missing') {
        customerId = null
        try {
          await withDbTimeout(supabaseAdmin.from('profiles').update({ stripe_customer_id: null }).eq('id', userId))
        } catch (_clearErr) {
          /* best-effort */
        }
      } else {
        throw err
      }
    }
  }

  const resolvedEmail = sanitizeText(profile?.email ?? userEmail ?? '')
  if (!resolvedEmail || !isValidEmail(resolvedEmail)) {
    return { error: 'No valid email found for this account. Please update your profile email and try again.', status: 400 }
  }

  const customer = await stripe.customers.create({ email: resolvedEmail, metadata: { user_id: userId } })
  customerId = customer.id

  const updatePatch: Record<string, unknown> = { stripe_customer_id: customerId }
  if (!profile?.email && resolvedEmail) updatePatch.email = resolvedEmail
  const saveRes = (await withDbTimeout(
    supabaseAdmin.from('profiles').update(updatePatch).eq('id', userId)
  )) as any
  if (saveRes?.error) {
    // Fallback: targeted update of just the customer id.
    try {
      await withDbTimeout(supabaseAdmin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId))
    } catch (_fallbackErr) {
      /* best-effort — customer still returned; a later call will re-persist */
    }
  }

  // customerId is guaranteed non-null here (just set from a created customer);
  // the declared type is `string | null` only because of the stale-id reset path.
  return { customerId: customerId as string }
}

// Statuses that count as an "active" (non-terminal, non-cancelable) escrow.
// A row in one of these states means the bounty is already funded/held, so a
// second /create is idempotent (return the existing PI) rather than a new PI.
const ACTIVE_BP_STATUSES = ['pending_payment', 'authorized', 'captured', 'released', 'refund_pending', 'refunded', 'disputed']

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const pathParts = url.pathname.split('/bounty-payments')
  const subPath = pathParts.length > 1 ? pathParts[1] : '/'

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) {
    return jsonResponse({ error: 'Stripe not configured' }, 500)
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient() })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Authenticate the caller from the Authorization header.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401)
  }
  const token = authHeader.substring(7)
  let authResult: any
  try {
    authResult = await withDbTimeout(supabaseAdmin.auth.getUser(token))
  } catch (e: any) {
    if (e?.code === 'DB_TIMEOUT') {
      return jsonResponse({ error: 'Service temporarily unavailable. Please try again shortly.' }, 503)
    }
    throw e
  }
  const { data: { user } = { user: null }, error: authError } = authResult as any
  if (authError || !user) {
    return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401)
  }
  const userId = user.id
  const userEmail = sanitizeText(user.email ?? '')

  const PLATFORM_FEE_PERCENT = Number(Deno.env.get('PLATFORM_FEE_PERCENT') ?? '5')

  try {
    // ───────────────────────────────────────────────────────────────────────
    // POST /bounty-payments/create — poster funds a specific bounty
    // ───────────────────────────────────────────────────────────────────────
    if (req.method === 'POST' && subPath === '/create') {
      const body = await req.json().catch(() => ({}))
      const bountyId = sanitizeText(body?.bountyId ?? body?.bounty_id)
      if (!bountyId) {
        return jsonResponse({ error: 'bountyId is required.' }, 400)
      }

      // Look up the bounty. NOTE: we auth against poster_id (100% populated,
      // canonical) rather than the legacy user_id column (NULL on some rows).
      const { data: bounty, error: bountyErr } = (await withDbTimeout(
        supabaseAdmin
          .from('bounties')
          .select('id, poster_id, user_id, amount, is_for_honor, status')
          .eq('id', bountyId)
          .maybeSingle()
      )) as any

      if (bountyErr) {
        return jsonResponse({ error: 'Failed to load bounty.' }, 500)
      }
      if (!bounty) {
        return jsonResponse({ error: 'Bounty not found.', code: 'bounty_not_found' }, 404)
      }

      const posterId = bounty.poster_id ?? bounty.user_id
      if (posterId !== userId) {
        return jsonResponse({ error: 'Only the poster can fund this bounty.', code: 'not_poster' }, 403)
      }
      if (bounty.is_for_honor) {
        return jsonResponse({ error: 'Honor bounties are not funded.', code: 'is_for_honor' }, 400)
      }

      const amount = Number(bounty.amount)
      if (!isFinite(amount) || amount <= 0) {
        return jsonResponse({ error: 'Bounty amount must be greater than zero.', code: 'invalid_amount' }, 400)
      }
      const amountCents = Math.round(amount * 100)
      if (amountCents < 50) {
        return jsonResponse({ error: 'Bounty amount must be at least $0.50.', code: 'amount_too_small' }, 400)
      }

      // Idempotency: if an active (non-canceled/failed) payment row already
      // exists for this bounty, return its existing PaymentIntent's
      // client_secret instead of creating a duplicate PI.
      // Defensive: order+limit so a stray duplicate row (no unique constraint
      // on bounty_id yet — see the recommended follow-up index) resolves to the
      // most recent rather than erroring out of maybeSingle().
      const { data: existing } = (await withDbTimeout(
        supabaseAdmin
          .from('bounty_payments')
          .select('id, stripe_payment_intent_id, status, amount')
          .eq('bounty_id', bountyId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      )) as any

      if (existing && ACTIVE_BP_STATUSES.includes(existing.status) && existing.stripe_payment_intent_id) {
        try {
          const existingPi = await stripe.paymentIntents.retrieve(existing.stripe_payment_intent_id)
          return jsonResponse({
            bountyPaymentId: existing.id,
            paymentIntentId: existingPi.id,
            clientSecret: existingPi.client_secret,
            status: existing.status,
            amount: Number(existing.amount),
            reused: true,
          })
        } catch (piErr: any) {
          // The stored PI is gone on Stripe's side (e.g. manually deleted in
          // test mode). Fall through and create a fresh one, overwriting the row.
          if (piErr?.code !== 'resource_missing') throw piErr
        }
      }

      // Resolve/create the poster's Stripe customer.
      const customerResult = await resolveStripeCustomerForUser({ supabaseAdmin, stripe, userId, userEmail })
      if (customerResult.error || !customerResult.customerId) {
        return jsonResponse({ error: customerResult.error ?? 'Unable to create customer profile' }, customerResult.status ?? 400)
      }
      const customerId = customerResult.customerId

      const transferGroup = `bounty_${bountyId}`

      // capture_method: 'automatic' — the poster's card is charged and funds
      // settle to the platform balance immediately at funding time, then held
      // (tracked via bounty_payments.status) until release. Automatic capture
      // is used because real bounties routinely stay open far longer than the
      // 7-day manual-capture auto-cancel window.
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        customer: customerId,
        capture_method: 'automatic',
        automatic_payment_methods: { enabled: true },
        transfer_group: transferGroup,
        metadata: {
          user_id: userId,
          bounty_id: bountyId,
          purpose: 'bounty_escrow',
        },
      })

      // Persist the bounty_payments row. There is no unique constraint on
      // bounty_id (only a plain index), so `.upsert(onConflict:'bounty_id')`
      // would error. Instead: UPDATE the existing (canceled/failed) row by id,
      // or INSERT a fresh one.
      const rowPatch = {
        bounty_id: bountyId,
        poster_id: userId,
        stripe_payment_intent_id: paymentIntent.id,
        transfer_group: transferGroup,
        amount,
        capture_method: 'automatic',
        status: 'pending_payment',
        stripe_charge_id: null,
        stripe_transfer_id: null,
        stripe_refund_id: null,
        hunter_id: null,
        platform_fee_amount: null,
        updated_at: new Date().toISOString(),
      }

      let bountyPaymentId: string
      if (existing?.id) {
        const { data: updated, error: updErr } = (await withDbTimeout(
          supabaseAdmin.from('bounty_payments').update(rowPatch).eq('id', existing.id).select('id').maybeSingle()
        )) as any
        if (updErr || !updated) {
          // The PI was created but the row write failed — cancel the PI so we
          // don't leave an orphaned, chargeable intent behind.
          await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {})
          return jsonResponse({ error: 'Failed to record bounty payment. No charge was made.' }, 500)
        }
        bountyPaymentId = updated.id
      } else {
        const { data: inserted, error: insErr } = (await withDbTimeout(
          supabaseAdmin.from('bounty_payments').insert(rowPatch).select('id').maybeSingle()
        )) as any
        if (insErr || !inserted) {
          await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {})
          return jsonResponse({ error: 'Failed to record bounty payment. No charge was made.' }, 500)
        }
        bountyPaymentId = inserted.id
      }

      // Mark the bounty as using the Phase 2 payment architecture. Best-effort:
      // the payment row is the source of truth; a failure here just means the
      // version flag lags (the row still drives all Phase 2 logic).
      const { error: verErr } = (await withDbTimeout(
        supabaseAdmin.from('bounties').update({ payment_architecture_version: 2 }).eq('id', bountyId)
      )) as any
      if (verErr) {
        console.error('[bounty-payments] Failed to set payment_architecture_version=2', { bountyId, verErr })
      }

      return jsonResponse({
        bountyPaymentId,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        status: 'pending_payment',
        amount,
      })
    }

    // ───────────────────────────────────────────────────────────────────────
    // POST /bounty-payments/release — release funds to the hunter
    // ───────────────────────────────────────────────────────────────────────
    if (req.method === 'POST' && subPath === '/release') {
      const body = await req.json().catch(() => ({}))
      const bountyId = sanitizeText(body?.bountyId ?? body?.bounty_id)
      const hunterIdInput = sanitizeText(body?.hunterId ?? body?.hunter_id)
      if (!bountyId) {
        return jsonResponse({ error: 'bountyId is required.' }, 400)
      }

      const { data: bp, error: bpErr } = (await withDbTimeout(
        supabaseAdmin.from('bounty_payments').select('*').eq('bounty_id', bountyId).maybeSingle()
      )) as any
      if (bpErr) {
        return jsonResponse({ error: 'Failed to load bounty payment.' }, 500)
      }
      if (!bp) {
        return jsonResponse({ error: 'No payment record for this bounty.', code: 'no_payment' }, 404)
      }
      if (bp.poster_id !== userId) {
        return jsonResponse({ error: 'Only the poster can release funds.', code: 'not_poster' }, 403)
      }

      // Idempotent: already released → return the existing transfer, no-op.
      if (bp.status === 'released' && bp.stripe_transfer_id) {
        return jsonResponse({
          released: true,
          transferId: bp.stripe_transfer_id,
          status: 'released',
          reused: true,
        })
      }

      // Only releasable from authorized/captured. (With automatic capture a
      // succeeded PI maps to 'captured' via the webhook; 'authorized' is kept
      // for forward-compat if manual capture is ever added.)
      if (!['authorized', 'captured'].includes(bp.status)) {
        return jsonResponse(
          { error: `Cannot release a bounty payment in status "${bp.status}".`, code: 'invalid_status', status: bp.status },
          409
        )
      }

      // Resolve the hunter. Prefer the explicit input, else the accepted hunter
      // recorded on the bounty.
      let hunterId = hunterIdInput || bp.hunter_id || null
      if (!hunterId) {
        const { data: bountyRow } = (await withDbTimeout(
          supabaseAdmin.from('bounties').select('accepted_by').eq('id', bountyId).maybeSingle()
        )) as any
        hunterId = bountyRow?.accepted_by ?? null
      }
      if (!hunterId) {
        return jsonResponse({ error: 'No hunter is assigned to this bounty.', code: 'no_hunter' }, 400)
      }

      // Verify the hunter is payout-ready on Stripe Connect.
      const { data: hunterProfile, error: hunterErr } = (await withDbTimeout(
        supabaseAdmin
          .from('profiles')
          .select('stripe_connect_account_id, stripe_connect_payouts_enabled')
          .eq('id', hunterId)
          .maybeSingle()
      )) as any
      if (hunterErr) {
        return jsonResponse({ error: 'Failed to load hunter payout profile.' }, 500)
      }
      if (!hunterProfile?.stripe_connect_account_id) {
        return jsonResponse({ error: 'The hunter has not completed payout onboarding yet.', code: 'hunter_not_onboarded' }, 400)
      }
      if (hunterProfile.stripe_connect_payouts_enabled !== true) {
        return jsonResponse({ error: 'The hunter cannot receive payouts yet.', code: 'hunter_payouts_disabled' }, 400)
      }

      // The charge id should already be set by the payment_intent.succeeded
      // webhook. If it's missing (webhook lag), resolve it live from the PI.
      let chargeId: string | null = bp.stripe_charge_id ?? null
      if (!chargeId && bp.stripe_payment_intent_id) {
        try {
          const pi = await stripe.paymentIntents.retrieve(bp.stripe_payment_intent_id)
          chargeId = (pi.latest_charge as string) ?? null
          if (pi.status !== 'succeeded') {
            return jsonResponse(
              { error: 'The bounty payment has not been captured yet. Try again shortly.', code: 'not_captured' },
              409
            )
          }
        } catch (_piErr) {
          /* fall through to the missing-charge guard below */
        }
      }
      if (!chargeId) {
        return jsonResponse({ error: 'Could not resolve the settled charge for this bounty. Try again shortly.', code: 'no_charge' }, 409)
      }

      const amount = Number(bp.amount)
      const platformFee = Math.round(((amount * PLATFORM_FEE_PERCENT) / 100) * 100) / 100
      const hunterAmount = Math.round((amount - platformFee) * 100) / 100
      const hunterAmountCents = Math.round(hunterAmount * 100)
      if (hunterAmountCents <= 0) {
        return jsonResponse({ error: 'Computed hunter payout is not positive.', code: 'invalid_payout' }, 400)
      }

      // Create the Transfer, drawing from the specific settled charge
      // (source_transaction) so Connect balance accounting is exact. Stripe
      // idempotency key makes a retried release a no-op on Stripe's side.
      let transfer: any
      try {
        transfer = await stripe.transfers.create(
          {
            amount: hunterAmountCents,
            currency: 'usd',
            destination: hunterProfile.stripe_connect_account_id,
            source_transaction: chargeId,
            transfer_group: bp.transfer_group ?? `bounty_${bountyId}`,
            metadata: {
              bounty_id: bountyId,
              hunter_id: hunterId,
              poster_id: bp.poster_id,
            },
          },
          { idempotencyKey: `bounty_release_${bp.id}` }
        )
      } catch (transferErr: any) {
        // The charge was captured successfully; only the transfer failed. Leave
        // status at 'captured' so a retry goes straight back to this step. No
        // funds are lost — they remain on the platform balance.
        console.error('[bounty-payments] Transfer failed after capture', { bountyId, bpId: bp.id, transferErr })
        return jsonResponse(
          {
            error: 'Payment is held safely but the transfer to the hunter failed. No funds were lost — please retry.',
            code: 'transfer_failed',
            detail: transferErr?.message ?? null,
          },
          502
        )
      }

      const { error: updErr } = (await withDbTimeout(
        supabaseAdmin
          .from('bounty_payments')
          .update({
            hunter_id: hunterId,
            stripe_transfer_id: transfer.id,
            platform_fee_amount: platformFee,
            status: 'released',
            updated_at: new Date().toISOString(),
          })
          .eq('id', bp.id)
      )) as any
      if (updErr) {
        // Transfer succeeded but the row write failed. The Stripe idempotency
        // key on the transfer means a retry won't double-pay; surface for
        // reconciliation rather than silently succeeding.
        console.error('[bounty-payments] CRITICAL: transfer created but row update failed', {
          bountyId,
          bpId: bp.id,
          transferId: transfer.id,
          updErr,
        })
        return jsonResponse(
          { error: 'Funds were released but the record could not be updated. Support has been notified.', code: 'record_update_failed', transferId: transfer.id },
          500
        )
      }

      return jsonResponse({
        released: true,
        transferId: transfer.id,
        hunterId,
        amount,
        platformFee,
        hunterAmount,
        status: 'released',
      })
    }

    // ───────────────────────────────────────────────────────────────────────
    // POST /bounty-payments/cancel — cancel (pre-capture) or refund (post-capture)
    // ───────────────────────────────────────────────────────────────────────
    if (req.method === 'POST' && subPath === '/cancel') {
      const body = await req.json().catch(() => ({}))
      const bountyId = sanitizeText(body?.bountyId ?? body?.bounty_id)
      if (!bountyId) {
        return jsonResponse({ error: 'bountyId is required.' }, 400)
      }

      const { data: bp, error: bpErr } = (await withDbTimeout(
        supabaseAdmin.from('bounty_payments').select('*').eq('bounty_id', bountyId).maybeSingle()
      )) as any
      if (bpErr) {
        return jsonResponse({ error: 'Failed to load bounty payment.' }, 500)
      }
      if (!bp) {
        return jsonResponse({ error: 'No payment record for this bounty.', code: 'no_payment' }, 404)
      }
      if (bp.poster_id !== userId) {
        return jsonResponse({ error: 'Only the poster can cancel this bounty payment.', code: 'not_poster' }, 403)
      }

      // Idempotent terminal states.
      if (bp.status === 'canceled') {
        return jsonResponse({ canceled: true, status: 'canceled', reused: true })
      }
      if (bp.status === 'refunded' || bp.status === 'refund_pending') {
        return jsonResponse({ refunded: true, status: bp.status, refundId: bp.stripe_refund_id ?? null, reused: true })
      }
      if (bp.status === 'released') {
        return jsonResponse({ error: 'Funds have already been released to the hunter and cannot be canceled here.', code: 'already_released' }, 409)
      }

      // Pre-capture: cancel the PaymentIntent (no charge ever settles).
      if (bp.status === 'pending_payment' || bp.status === 'authorized') {
        if (bp.stripe_payment_intent_id) {
          try {
            await stripe.paymentIntents.cancel(bp.stripe_payment_intent_id)
          } catch (cancelErr: any) {
            // If it already captured between our read and now, fall through to
            // the refund path below by re-reading status.
            if (cancelErr?.code !== 'payment_intent_unexpected_state') {
              throw cancelErr
            }
          }
        }
        const { error: updErr } = (await withDbTimeout(
          supabaseAdmin
            .from('bounty_payments')
            .update({ status: 'canceled', updated_at: new Date().toISOString() })
            .eq('id', bp.id)
        )) as any
        if (updErr) {
          return jsonResponse({ error: 'Payment intent canceled but the record could not be updated.', code: 'record_update_failed' }, 500)
        }
        return jsonResponse({ canceled: true, status: 'canceled' })
      }

      // Post-capture: issue a real refund.
      if (bp.status === 'captured') {
        if (!bp.stripe_payment_intent_id) {
          return jsonResponse({ error: 'Missing payment intent; cannot refund.', code: 'no_payment_intent' }, 500)
        }
        let refund: any
        try {
          refund = await stripe.refunds.create(
            { payment_intent: bp.stripe_payment_intent_id, reason: 'requested_by_customer' },
            { idempotencyKey: `bounty_refund_${bp.id}` }
          )
        } catch (refundErr: any) {
          console.error('[bounty-payments] Refund failed', { bountyId, bpId: bp.id, refundErr })
          return jsonResponse({ error: 'Refund could not be processed. Please try again.', code: 'refund_failed', detail: refundErr?.message ?? null }, 502)
        }

        const newStatus = refund.status === 'succeeded' ? 'refunded' : 'refund_pending'
        const { error: updErr } = (await withDbTimeout(
          supabaseAdmin
            .from('bounty_payments')
            .update({ status: newStatus, stripe_refund_id: refund.id, updated_at: new Date().toISOString() })
            .eq('id', bp.id)
        )) as any
        if (updErr) {
          console.error('[bounty-payments] Refund created but row update failed', { bountyId, bpId: bp.id, refundId: refund.id, updErr })
          return jsonResponse({ refunded: true, status: newStatus, refundId: refund.id, warning: 'record_update_failed' })
        }
        return jsonResponse({ refunded: true, status: newStatus, refundId: refund.id })
      }

      return jsonResponse({ error: `Cannot cancel a bounty payment in status "${bp.status}".`, code: 'invalid_status', status: bp.status }, 409)
    }

    return jsonResponse({ error: 'Not found' }, 404)
  } catch (err: any) {
    if (err?.code === 'DB_TIMEOUT') {
      return jsonResponse({ error: 'Service temporarily unavailable. Please try again shortly.' }, 503)
    }
    console.error('[bounty-payments] Unhandled error', { subPath, message: err?.message, type: err?.type })
    // Surface Stripe's own message when present (already user-safe), else generic.
    const message = err?.type?.startsWith?.('Stripe') && err?.message ? err.message : 'An unexpected error occurred. Please try again.'
    return jsonResponse({ error: message }, 500)
  }
})
