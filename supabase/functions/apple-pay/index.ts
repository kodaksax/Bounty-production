// Supabase Edge Function: apple-pay
// Handles Apple Pay routes previously served by the Node/Express server.
// Routes:
//   POST /apple-pay/payment-intent
//   POST /apple-pay/confirm

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno&no-check'

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
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

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
      const { amountCents, bountyId, description } = body ?? {}

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

      const paymentIntent = await stripe.paymentIntents.create({
        amount: validatedAmount,
        currency: 'usd',
        payment_method_types: ['card'],
        metadata: {
          user_id: user.id,
          bounty_id: sanitizedBountyId,
          payment_method: 'apple_pay',
        },
        description: sanitizedDescription,
      })

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

      if (paymentIntent?.status === 'succeeded') {
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
