// Supabase Edge Function: identity-status
// Lightweight poll endpoint for the verification pending/verified/rejected
// screens. Always reads fresh from `profiles` -- this is the reconciliation
// mechanism that lets the client resume by re-fetching status on focus
// instead of trusting cached state (Stripe's VerificationSession persists
// server-side regardless of what the client has cached).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
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

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('stripe_identity_status, id_verification_rejection_reason, verified_since')
    .eq('id', user.id)
    .single()

  if (profileError) {
    console.error('[identity-status] Failed to load profile:', profileError)
    return jsonResponse({ error: 'Profile not found' }, 404)
  }

  return jsonResponse({
    status: profile.stripe_identity_status,
    rejectionReason: profile.id_verification_rejection_reason,
    verifiedSince: profile.verified_since,
  })
})
