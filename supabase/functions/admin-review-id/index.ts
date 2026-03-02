// Supabase Edge Function: admin-review-id
// Allows admins to approve or reject a pending ID verification.
// On approval, also sets age_verified = true and age_verified_at = now().
// Must be called with an Authorization: Bearer <JWT> belonging to an admin user.

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

  // Authenticate caller and verify admin role
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401)
  }
  const token = authHeader.substring(7)
  const { data: { user: adminUser }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !adminUser) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }

  // Only users with admin role may use this endpoint.
  // We check for an 'admin' claim in app_metadata (set server-side via the Admin API).
  const roles = adminUser.app_metadata?.roles
  const hasAdminRole = Array.isArray(roles)
    ? roles.includes('admin')
    : typeof roles === 'string'
      ? roles === 'admin'
      : false
  const isAdmin = (adminUser.app_metadata?.role === 'admin') || hasAdminRole
  if (!isAdmin) {
    return jsonResponse({ error: 'Forbidden: admin access required' }, 403)
  }

  let body: { userId?: string; decision?: string; notes?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { userId, decision, notes } = body

  if (!userId || typeof userId !== 'string') {
    return jsonResponse({ error: 'userId is required' }, 400)
  }

  const validDecisions = ['approved', 'rejected']
  if (!decision || !validDecisions.includes(decision)) {
    return jsonResponse({ error: `decision must be one of: ${validDecisions.join(', ')}` }, 400)
  }

  const now = new Date().toISOString()

  // Map API-level decision values to DB-allowed id_verification_status values.
  const dbStatus = decision === 'approved' ? 'verified' : 'rejected'

  const profileUpdate: Record<string, unknown> = {
    id_verification_status: dbStatus,
    id_reviewed_at: now,
    id_reviewer_id: adminUser.id,
  }

  // When the admin approves the ID, wire age_verified columns as part of the same update.
  if (decision === 'approved') {
    profileUpdate.age_verified = true
    profileUpdate.age_verified_at = now
  }

  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update(profileUpdate)
    .eq('id', userId)
    .select('id')
    .single()

  if (updateError) {
    if (typeof updateError === 'object' && updateError !== null && 'code' in updateError && (updateError as { code: string }).code === 'PGRST116') {
      return jsonResponse({ error: 'Profile not found' }, 404)
    }
    console.error('[admin-review-id] Failed to update profile:', updateError)
    return jsonResponse({ error: 'Failed to update verification status' }, 500)
  }

  console.log(
    `[admin-review-id] ID ${decision} for userId=${userId} by adminId=${adminUser.id}` +
    (notes ? ` notes_present=true notes_length=${String(notes).length}` : ''),
  )

  return jsonResponse({ success: true, userId, decision })
})
