// Supabase Edge Function: payments
// Handles all /payments/* routes previously served by the Node/Express server.
// Routes:
//   POST   /payments/create-payment-intent
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
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401)
  }
  const token = authHeader.substring(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }
  const userId = user.id

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

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id, email')
        .eq('id', userId)
        .single()

      let customerId = profile?.stripe_customer_id
      if (!customerId && profile?.email) {
        const customer = await stripe.customers.create({
          email: profile.email,
          metadata: { user_id: userId },
        })
        customerId = customer.id
        await supabaseAdmin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId)
      }

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

    // GET /payments/methods
    if (req.method === 'GET' && subPath === '/methods') {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', userId)
        .single()

      if (!profile?.stripe_customer_id) {
        return jsonResponse({ paymentMethods: [] })
      }

      const paymentMethods = await stripe.paymentMethods.list({
        customer: profile.stripe_customer_id,
        type: 'card',
      })

      const methods = paymentMethods.data.map((pm) => ({
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
    }

    // POST /payments/methods
    if (req.method === 'POST' && subPath === '/methods') {
      const body = await req.json()
      const { paymentMethodId } = body

      if (!paymentMethodId) {
        return jsonResponse({ error: 'Payment method ID is required' }, 400)
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id, email')
        .eq('id', userId)
        .single()

      let customerId = profile?.stripe_customer_id
      if (!customerId && profile?.email) {
        const customer = await stripe.customers.create({
          email: profile.email,
          metadata: { user_id: userId },
        })
        customerId = customer.id
        await supabaseAdmin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId)
      }

      if (!customerId) {
        return jsonResponse({ error: 'Unable to create customer profile' }, 400)
      }

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

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', userId)
        .single()

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
    if (err.type === 'StripeCardError') {
      return jsonResponse({ error: err.message, code: err.code, decline_code: err.decline_code }, 400)
    }
    if (err.code === 'resource_missing') {
      return jsonResponse({ error: 'Payment method not found' }, 404)
    }
    return jsonResponse({ error: err.message ?? 'Internal server error' }, 500)
  }
})
