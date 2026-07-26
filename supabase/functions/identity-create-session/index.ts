// Supabase Edge Function: identity-create-session
// Creates (or reuses) a Stripe Identity VerificationSession + ephemeral key
// for the authenticated caller and returns just enough for the client to
// present the Stripe-owned verification sheet (@stripe/stripe-identity-react-native).
//
// userId is derived exclusively from the authenticated Bearer token, never
// from the request body -- unlike the legacy review-id function, which
// trusted a client-supplied userId (still fine there, since it re-checks
// userId === user.id, but this function has no such field at all to reduce
// the attack surface).

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

// Stripe Identity sessions are valid for 24h from creation before the client
// should stop trying to resume them and request a fresh one.
const SESSION_REUSE_WINDOW_MS = 24 * 60 * 60 * 1000
const STRIPE_API_VERSION = '2023-10-16'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) {
    console.error('[identity-create-session] Missing STRIPE_SECRET_KEY')
    return jsonResponse({ error: 'Identity verification is not configured' }, 500)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401)
  }
  const token = authHeader.substring(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401)
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  })

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('stripe_identity_session_id, stripe_identity_status')
    .eq('id', user.id)
    .single()

  if (profileError) {
    console.error('[identity-create-session] Failed to load profile:', profileError)
    return jsonResponse({ error: 'Profile not found' }, 404)
  }

  if (profile.stripe_identity_status === 'verified') {
    return jsonResponse({ error: 'Identity is already verified' }, 409)
  }

  try {
    let session: Stripe.Identity.VerificationSession

    // Resume an in-flight session rather than creating a duplicate: if the
    // sheet was dismissed mid-flow or the app was backgrounded, re-entering
    // should continue the same VerificationSession, not start a new one.
    const existingId = profile.stripe_identity_session_id as string | null
    let reused = false
    if (existingId) {
      const existing = await stripe.identity.verificationSessions.retrieve(existingId)
      const createdMsAgo = Date.now() - existing.created * 1000
      if (
        (existing.status === 'requires_input' || existing.status === 'processing') &&
        createdMsAgo < SESSION_REUSE_WINDOW_MS
      ) {
        session = existing
        reused = true
      } else {
        session = await stripe.identity.verificationSessions.create({
          type: 'document',
          metadata: { user_id: user.id },
          options: { document: { require_live_capture: true, require_matching_selfie: true } },
        })
      }
    } else {
      session = await stripe.identity.verificationSessions.create({
        type: 'document',
        metadata: { user_id: user.id },
        options: { document: { require_live_capture: true, require_matching_selfie: true } },
      })
    }

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { verification_session: session.id },
      { apiVersion: STRIPE_API_VERSION }
    )

    if (!reused) {
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
          stripe_identity_session_id: session.id,
          stripe_identity_status: 'requires_input',
        })
        .eq('id', user.id)

      if (updateError) {
        console.error('[identity-create-session] Failed to persist session id:', updateError)
        return jsonResponse({ error: 'Failed to start verification' }, 500)
      }
    }

    console.log(`[identity-create-session] session=${session.id} userId=${user.id} reused=${reused}`)

    return jsonResponse({
      sessionId: session.id,
      ephemeralKeySecret: ephemeralKey.secret,
      status: session.status,
    })
  } catch (err) {
    console.error('[identity-create-session] Stripe error:', err)
    return jsonResponse({ error: 'Failed to start verification. Please try again.' }, 502)
  }
})
