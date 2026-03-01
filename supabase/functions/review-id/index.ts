// Supabase Edge Function: review-id
// Marks the user's id_verification_status as 'pending' after document upload.
// Called by the mobile app immediately after uploading ID photos to storage.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

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

  let body: { userId?: string; docType?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { userId, docType } = body

  if (!userId || typeof userId !== 'string') {
    return jsonResponse({ error: 'userId is required' }, 400)
  }

  // Users may only submit their own verification
  if (userId !== user.id) {
    return jsonResponse({ error: 'Forbidden: userId does not match authenticated user' }, 403)
  }

  const validDocTypes = ['passport', 'driversLicense', 'nationalId']
  if (!docType || !validDocTypes.includes(docType)) {
    return jsonResponse({ error: `docType must be one of: ${validDocTypes.join(', ')}` }, 400)
  }

  const { data: _updatedProfile, error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({
      id_verification_status: 'pending',
      id_submitted_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select('id')
    .single()

  if (updateError) {
    // PGRST116 = no rows matched (profile does not exist)
    if ((updateError as any).code === 'PGRST116') {
      return jsonResponse({ error: 'Profile not found' }, 404)
    }
    console.error('[review-id] Failed to update profile:', updateError)
    return jsonResponse({ error: 'Failed to update verification status' }, 500)
  }

  // TODO: Notify admin team that a new verification submission is awaiting review.
  // Options: send an email via Resend/SendGrid, post to a Slack webhook, or insert
  // a row into an admin_notifications table for a dashboard to display.

  console.log(`[review-id] Verification submitted: userId=${userId} docType=${docType}`)

  return jsonResponse({ success: true })
})
