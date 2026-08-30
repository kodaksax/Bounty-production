// Supabase Edge Function: apple-pay
// Handles Apple Pay routes previously served by the Node/Express server.
// Routes:
//   POST /apple-pay/payment-intent
//   POST /apple-pay/confirm

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
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

function sanitizeText(input: unknown): string {
  if (!input) return ''
  // Remove all angle brackets to prevent HTML/script injection, then trim
  return String(input).replace(/[<>]/g, '').trim().slice(0, 1000)
}

// How far back a "recent" succeeded deposit counts as the same logical deposit.
// Matches the client idempotency window (lib/services/apple-pay-service.ts).
const RECENT_DEPOSIT_WINDOW_SECONDS = 10 * 60

/**
 * Find a recent succeeded wallet-deposit PaymentIntent for this user and exact
 * amount, so a re-tap does not create a second charge. Uses Stripe search,
 * which is indexed with a short lag; a just-succeeded intent may not appear
 * yet, which is why the client idempotency key remains the primary guard. Any
 * search failure returns undefined so payments still work if search is down.
 */
async function findRecentSucceededDeposit(
  stripe: Stripe,
  userId: string,
  amount: number,
): Promise<{ id: string; client_secret: string | null } | undefined> {
  // Quote characters would break out of the search query literal.
  const safeUserId = userId.replace(/['"\\]/g, '')
  if (!safeUserId) return undefined

  const cutoff = Math.floor(Date.now() / 1000) - RECENT_DEPOSIT_WINDOW_SECONDS
  try {
    const query = `status:'succeeded' AND metadata['user_id']:'${safeUserId}' AND metadata['purpose']:'wallet_deposit'`
    const results = await stripe.paymentIntents.search({ query, limit: 20 })
    const match = results.data.find((pi) => pi.amount === amount && pi.created >= cutoff)
    return match ? { id: match.id, client_secret: match.client_secret } : undefined
  } catch (error) {
    console.warn('[apple-pay edge fn] Recent-deposit search failed; proceeding to create:', error)
    return undefined
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const url = new URL(req.url)
  const pathParts = url.pathname.split('/apple-pay')
  const subPath = pathParts.length > 1 ? pathParts[1] : '/'

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) {
    return jsonResponse({ error: 'Stripe not configured' }, 500)
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient() })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Authenticate user
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }
  const token = authHeader.substring(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  try {
    // POST /apple-pay/payment-intent
    if (subPath === '/payment-intent') {
      const body = await req.json()
      const { amountCents, bountyId, description, idempotencyKey } = body ?? {}

      // The client (lib/services/apple-pay-service.ts) generates a fresh key
      // per payment attempt and reuses it across its own automatic retries.
      // Without forwarding it to Stripe, a network-timeout retry could create
      // a second PaymentIntent (and, if both are later confirmed, a double
      // charge) for what the client believes is a single attempt.
      const sanitizedIdempotencyKey = typeof idempotencyKey === 'string' && idempotencyKey.length > 0
        ? sanitizeText(idempotencyKey).slice(0, 255)
        : undefined
      const stripeRequestOptions = sanitizedIdempotencyKey
        ? { idempotencyKey: sanitizedIdempotencyKey }
        : undefined

      let validatedAmount: number
      try {
        validatedAmount = Number(amountCents)
        if (!isFinite(validatedAmount) || validatedAmount < 50) {
          throw new Error('Amount too small')
        }
      } catch {
        return jsonResponse({ error: 'Amount must be at least $0.50' }, 400)
      }

      const sanitizedBountyId = bountyId ? sanitizeText(bountyId) : ''
      const sanitizedDescription = description ? sanitizeText(description) : 'BountyExpo Payment'

      // Backstop against duplicate charges: if this user already has a recent
      // succeeded wallet deposit for the exact same amount, return it instead
      // of creating a second PaymentIntent. The client idempotency key is the
      // fast, exact guard for rapid re-taps; this covers the slower cases it
      // misses (a re-tap that crosses the client time bucket, or a retry from a
      // new app session). Returning a succeeded intent is safe: the client
      // confirm then reports the existing charge, and the wallet credit is
      // idempotent per intent, so no second charge and no double credit.
      const existing = await findRecentSucceededDeposit(stripe, user.id, validatedAmount)
      if (existing) {
        return jsonResponse({
          clientSecret: existing.client_secret,
          paymentIntentId: existing.id,
        })
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: validatedAmount,
        currency: 'usd',
        payment_method_types: ['card'],
        metadata: {
          user_id: user.id,
          bounty_id: sanitizedBountyId,
          payment_method: 'apple_pay',
          // The mobile client only calls this endpoint from the "Add Money to
          // Wallet" flow (lib/services/apple-pay-service.ts), then persists the
          // deposit client-side via POST /wallet/deposit. Without this tag, the
          // webhooks function's payment_intent.succeeded handler skips crediting
          // the wallet for Apple Pay intents (it only acts on purpose ===
          // 'wallet_deposit'), so a client crash between the Apple Pay charge
          // succeeding and the client-side persist call would charge the user
          // without ever crediting their balance, with no server-side backstop.
          purpose: 'wallet_deposit',
        },
        description: sanitizedDescription,
      }, stripeRequestOptions)

      return jsonResponse({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      })
    }

    // POST /apple-pay/confirm
    if (subPath === '/confirm') {
      const body = await req.json()
      const { paymentIntentId } = body ?? {}

      if (!paymentIntentId) {
        return jsonResponse({ error: 'Missing paymentIntentId' }, 400)
      }

      const sanitizedId = sanitizeText(paymentIntentId)
      const paymentIntent = await stripe.paymentIntents.retrieve(sanitizedId)

      // Verify the PaymentIntent belongs to the authenticated user
      const ownerUserId = (paymentIntent.metadata as { user_id?: string } | null | undefined)?.user_id
      if (!ownerUserId || ownerUserId !== user.id) {
        return jsonResponse({ error: 'Forbidden' }, 403)
      }

      if (paymentIntent.status === 'succeeded') {
        return jsonResponse({
          success: true,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
        })
      }

      return jsonResponse({
        success: false,
        status: paymentIntent?.status,
        error: 'Payment not completed',
      })
    }

    return jsonResponse({ error: 'Not found' }, 404)
  } catch (error: unknown) {
    const err = error as { message?: string }
    console.error('[apple-pay edge fn] Error:', err)
    return jsonResponse({ error: err.message ?? 'Internal server error' }, 500)
  }
})
