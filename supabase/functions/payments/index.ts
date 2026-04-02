// Supabase Edge Function: payments
// Handles all /payments/* routes previously served by the Node/Express server.
// Routes:
//   POST   /payments/create-payment-intent
//   POST   /payments/create-setup-intent
//   GET    /payments/methods
//   POST   /payments/methods
//   DELETE /payments/methods/:id
//   POST   /payments/confirm

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno&no-check'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Wrap any promise-like DB query in a race against a timeout so the function
// returns a proper 503 quickly instead of hanging when the database is paused
// or on a cold start (free-tier projects can take 30-60s to wake).
const DB_TIMEOUT_MS = 8000
function withDbTimeout<T>(query: PromiseLike<T>): Promise<T> {
  return Promise.race([
    Promise.resolve(query),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('DB_TIMEOUT'), { code: 'DB_TIMEOUT' })), DB_TIMEOUT_MS)
    ),
  ])
}

// Input sanitization helpers (mirrors server/index.js logic)
function sanitizeText(input: unknown): string {
  if (!input) return ''
  // Remove all angle brackets to prevent HTML/script injection, then trim
  return String(input).replace(/[<>]/g, '').trim().slice(0, 1000)
}

function sanitizePositiveNumber(input: unknown): number {
  const num = Number(input)
  if (!isFinite(num) || isNaN(num) || num <= 0) {
    throw new Error('Must be a positive number')
  }
  return num
}

function isValidEmail(email: string): boolean {
  // Basic RFC-safe validation for Stripe customer email values.
  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,}$/
  return emailRegex.test(email)
}

function deriveUsernameFromEmail(email: string, userId: string): string {
  const prefix = email.includes('@') ? email.split('@')[0] : email
  const cleaned = prefix.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20)
  if (cleaned.length > 0) return cleaned
  return `user_${userId.slice(0, 8)}`
}

async function resolveStripeCustomerForUser(params: {
  supabaseAdmin: ReturnType<typeof createClient>
  stripe: Stripe
  userId: string
  userEmail?: string
}) {
  const { supabaseAdmin, stripe, userId, userEmail } = params

  const { data: profile, error: profileError } = await withDbTimeout(supabaseAdmin
    .from('profiles')
    .select('id, stripe_customer_id, email, username')
    .eq('id', userId)
    .maybeSingle())

  if (profileError) {
    console.error('[payments] Failed to fetch profile during customer resolution', { userId, profileError })
  }

  let customerId = profile?.stripe_customer_id ?? null
  if (customerId) {
    try {
      await stripe.customers.retrieve(customerId)
      return { customerId }
    } catch (err: any) {
      if (err?.code === 'resource_missing') {
        console.warn('[payments] Stored stripe_customer_id is stale; recreating customer', {
          userId,
          stripeCustomerId: customerId,
        })

        customerId = null
        try {
          await withDbTimeout(supabaseAdmin
            .from('profiles')
            .update({ stripe_customer_id: null })
            .eq('id', userId))
        } catch (clearErr) {
          console.error('[payments] Failed to clear stale stripe_customer_id', { userId, clearErr })
        }
      } else {
        throw err
      }
    }
  }

  const resolvedEmail = sanitizeText(profile?.email ?? userEmail ?? '')
  if (!resolvedEmail || !isValidEmail(resolvedEmail)) {
    return {
      error: 'No valid email found for this account. Please update your profile email and try again.',
      status: 400,
    }
  }

  const customer = await stripe.customers.create({
    email: resolvedEmail,
    metadata: { user_id: userId },
  })
  customerId = customer.id

  const profilePatch: Record<string, unknown> = {
    id: userId,
    email: resolvedEmail,
    stripe_customer_id: customerId,
  }

  if (!profile?.username) {
    profilePatch.username = deriveUsernameFromEmail(resolvedEmail, userId)
    profilePatch.balance = 0
  }

  const { error: upsertError } = await withDbTimeout(supabaseAdmin
    .from('profiles')
    .upsert(profilePatch, { onConflict: 'id' }))

  if (upsertError) {
    console.error('[payments] Failed to upsert profile while saving stripe_customer_id', { userId, upsertError })
  }

  return { customerId }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  // pathname starts with /functions/v1/payments/...
  // Extract the sub-path after /payments
  const pathParts = url.pathname.split('/payments')
  const subPath = pathParts.length > 1 ? pathParts[1] : '/'

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) {
    return jsonResponse({ error: 'Stripe not configured' }, 500)
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Authenticate user from Authorization header
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    console.warn('[payments edge fn] missing Authorization header')
    return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401)
  }
  const token = authHeader.substring(7)
  let authResult: Awaited<ReturnType<typeof supabaseAdmin.auth.getUser>>
  try {
    authResult = await withDbTimeout(supabaseAdmin.auth.getUser(token))
  } catch (e: any) {
    if (e?.code === 'DB_TIMEOUT') {
      return jsonResponse({ error: 'Service temporarily unavailable. Please try again shortly.' }, 503)
    }
    throw e
  }
  const { data: { user }, error: authError } = authResult
  if (authError || !user) {
    console.warn('[payments edge fn] invalid or expired token', authError || 'no user')
    return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401)
  }
  const userId = user.id
  const userEmail = sanitizeText(user.email ?? '')

  try {
    // POST /payments/create-payment-intent
    if (req.method === 'POST' && subPath === '/create-payment-intent') {
      const body = await req.json()
      const { amountCents, currency = 'usd', metadata = {} } = body

      let validatedAmount: number
      try {
        validatedAmount = sanitizePositiveNumber(amountCents)
      } catch {
        return jsonResponse({ error: 'Invalid amount. Must be a positive number in cents.' }, 400)
      }

      // Stripe requires an integer number of the smallest currency unit (e.g. cents).
      // Enforce a minimum of 50 cents to avoid Stripe validation errors.
      if (!Number.isInteger(validatedAmount) || validatedAmount < 50) {
        return jsonResponse(
          { error: 'Invalid amount. Must be an integer number of cents and at least 50 cents.' },
          400,
        )
      }

      const validatedCurrency = sanitizeText(currency).toLowerCase()
      if (!['usd', 'eur', 'gbp'].includes(validatedCurrency)) {
        return jsonResponse({ error: 'Invalid currency. Supported: usd, eur, gbp.' }, 400)
      }

      const customerResult = await resolveStripeCustomerForUser({
        supabaseAdmin,
        stripe,
        userId,
        userEmail,
      })
      if (customerResult.error || !customerResult.customerId) {
        return jsonResponse({ error: customerResult.error ?? 'Unable to create customer profile' }, customerResult.status ?? 400)
      }
      const customerId = customerResult.customerId

      const sanitizedMetadata: Record<string, string> = {}
      if (metadata.bounty_id) sanitizedMetadata.bounty_id = sanitizeText(metadata.bounty_id)
      if (metadata.description) sanitizedMetadata.description = sanitizeText(metadata.description)

      const paymentIntent = await stripe.paymentIntents.create({
        amount: validatedAmount,
        currency: validatedCurrency,
        customer: customerId,
        metadata: { user_id: userId, ...sanitizedMetadata },
        automatic_payment_methods: { enabled: true },
      })

      return jsonResponse({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id })
    }

    // POST /payments/create-setup-intent
    if (req.method === 'POST' && subPath === '/create-setup-intent') {
      let customerId: string
      try {
        const customerResult = await resolveStripeCustomerForUser({
          supabaseAdmin,
          stripe,
          userId,
          userEmail,
        })
        if (customerResult.error || !customerResult.customerId) {
          return jsonResponse({ error: customerResult.error ?? 'Unable to create customer profile' }, customerResult.status ?? 400)
        }
        customerId = customerResult.customerId
      } catch (err) {
        console.error('[payments] Error creating Stripe customer for setup intent', { userId, err })
        return jsonResponse({ error: 'Failed to create customer profile' }, 502)
      }

      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        usage: 'off_session',
        metadata: { user_id: userId },
      })

      return jsonResponse({ clientSecret: setupIntent.client_secret, setupIntentId: setupIntent.id })
    }

    // GET /payments/methods
    if (req.method === 'GET' && subPath === '/methods') {
      const { data: profile } = await withDbTimeout(supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', userId)
        .single())

      // If we don't have a customer yet, just return an empty list.
      if (!profile?.stripe_customer_id) {
        return jsonResponse({ paymentMethods: [] })
      }

      try {
        const paymentMethods = await stripe.paymentMethods.list({
          customer: profile.stripe_customer_id,
          type: 'card',
        })

        const methods = paymentMethods.data.map((pm: Stripe.PaymentMethod) => ({
          id: pm.id,
          type: 'card',
          card: {
            brand: pm.card?.brand ?? 'unknown',
            last4: pm.card?.last4 ?? '****',
            exp_month: pm.card?.exp_month ?? 0,
            exp_year: pm.card?.exp_year ?? 0,
          },
          created: pm.created,
        }))

        return jsonResponse({ paymentMethods: methods })
      } catch (err: any) {
        // If Stripe says the customer or its payment methods don't exist
        // (common when switching between test/live keys), treat this as
        // "no payment methods" for the current user instead of a hard error.
        if (err?.code === 'resource_missing') {
          console.warn('[payments] Stripe customer missing for /payments/methods; clearing stripe_customer_id', {
            userId,
            stripeCustomerId: profile.stripe_customer_id,
          })

          try {
            await withDbTimeout(supabaseAdmin
              .from('profiles')
              .update({ stripe_customer_id: null })
              .eq('id', userId))
          } catch (updateErr) {
            console.error('[payments] Failed to clear stale stripe_customer_id', { userId, updateErr })
          }

          return jsonResponse({ paymentMethods: [] })
        }

        // Re-throw so the outer handler can surface unexpected errors
        throw err
      }
    }

    // POST /payments/methods
    if (req.method === 'POST' && subPath === '/methods') {
      const body = await req.json()
      const { paymentMethodId } = body

      if (!paymentMethodId) {
        return jsonResponse({ error: 'Payment method ID is required' }, 400)
      }

      const customerResult = await resolveStripeCustomerForUser({
        supabaseAdmin,
        stripe,
        userId,
        userEmail,
      })
      if (customerResult.error || !customerResult.customerId) {
        return jsonResponse({ error: customerResult.error ?? 'Unable to create customer profile' }, customerResult.status ?? 400)
      }
      const customerId = customerResult.customerId

      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)

      return jsonResponse({
        success: true,
        paymentMethod: {
          id: paymentMethod.id,
          type: 'card',
          card: {
            brand: paymentMethod.card?.brand ?? 'unknown',
            last4: paymentMethod.card?.last4 ?? '****',
            exp_month: paymentMethod.card?.exp_month ?? 0,
            exp_year: paymentMethod.card?.exp_year ?? 0,
          },
          created: paymentMethod.created,
        },
      })
    }

    // DELETE /payments/methods/:id
    if (req.method === 'DELETE' && subPath.startsWith('/methods/')) {
      const paymentMethodId = subPath.split('/methods/')[1]

      const { data: profile } = await withDbTimeout(supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', userId)
        .single())

      if (!profile?.stripe_customer_id) {
        return jsonResponse({ error: 'No payment methods found' }, 404)
      }

      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
      if (paymentMethod.customer !== profile.stripe_customer_id) {
        return jsonResponse({ error: 'Not authorized to remove this payment method' }, 403)
      }

      await stripe.paymentMethods.detach(paymentMethodId)
      return jsonResponse({ success: true })
    }

    // POST /payments/confirm
    if (req.method === 'POST' && subPath === '/confirm') {
      const body = await req.json()
      const { paymentIntentId, paymentMethodId } = body

      if (!paymentIntentId) {
        return jsonResponse({ error: 'Payment intent ID is required' }, 400)
      }

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

      const metadataUserId = String(paymentIntent.metadata?.user_id ?? '')
      const requestUserId = String(userId)

      if (!metadataUserId || metadataUserId !== requestUserId) {
        return jsonResponse({ error: 'Not authorized to confirm this payment' }, 403)
      }

      if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing') {
        return jsonResponse({ success: true, status: paymentIntent.status, paymentIntentId: paymentIntent.id })
      }

      let confirmedIntent = paymentIntent
      if (
        paymentIntent.status === 'requires_confirmation' ||
        paymentIntent.status === 'requires_payment_method'
      ) {
        const confirmParams: Record<string, string> = {}
        if (paymentMethodId) confirmParams.payment_method = paymentMethodId
        confirmedIntent = await stripe.paymentIntents.confirm(paymentIntentId, confirmParams)
      }

      if (confirmedIntent.status === 'requires_action') {
        return jsonResponse({
          success: false,
          status: 'requires_action',
          requiresAction: true,
          clientSecret: confirmedIntent.client_secret,
          nextAction: confirmedIntent.next_action,
        })
      }

      return jsonResponse({
        success: confirmedIntent.status === 'succeeded',
        status: confirmedIntent.status,
        paymentIntentId: confirmedIntent.id,
      })
    }

    return jsonResponse({ error: 'Not found' }, 404)
  } catch (error: unknown) {
    const err = error as { type?: string; code?: string; decline_code?: string; message?: string }
    console.error('[payments edge fn] Error:', err)
    if ((err as any)?.code === 'DB_TIMEOUT') {
      return jsonResponse({ error: 'Service temporarily unavailable. Please try again shortly.' }, 503)
    }
    if (err.type === 'StripeCardError') {
      return jsonResponse({ error: err.message, code: err.code, decline_code: err.decline_code }, 400)
    }
    if (err.code === 'resource_missing') {
      return jsonResponse({ error: 'Payment method not found' }, 404)
    }
    return jsonResponse({ error: err.message ?? 'Internal server error' }, 500)
  }
})
