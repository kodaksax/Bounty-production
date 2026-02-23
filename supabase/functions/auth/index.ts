// Supabase Edge Function: auth
// Handles auth management routes previously served by the Node/Express server.
// Routes:
//   DELETE /auth/delete-account

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
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

  const url = new URL(req.url)
  const pathParts = url.pathname.split('/auth')
  const subPath = pathParts.length > 1 ? pathParts[1] : '/'

  // DELETE /auth/delete-account
  if (req.method !== 'DELETE' || subPath !== '/delete-account') {
    return jsonResponse({ error: 'Not found' }, 404)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Authenticate user
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401)
  }
  const token = authHeader.substring(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }
  const userId = user.id

  console.log(`[auth] Received deletion request for user ${userId}`)

  try {
    // Step 1: Nullify conversations.created_by to avoid FK restriction
    try {
      const { error: convErr } = await supabase
        .from('conversations')
        .update({ created_by: null })
        .eq('created_by', userId)
      if (convErr) {
        console.warn('[auth] conversations pre-cleanup error (continuing):', convErr.message)
      }
    } catch (e: unknown) {
      console.warn('[auth] conversations pre-cleanup threw (continuing):', (e as Error).message)
    }

    // Step 2: Delete auth user via admin API
    let adminDeleted = false
    try {
      const { error: adminError } = await supabase.auth.admin.deleteUser(userId)
      if (adminError) {
        console.warn('[auth] admin.deleteUser failed, will fallback:', adminError.message)
      } else {
        adminDeleted = true
      }
    } catch (e: unknown) {
      console.warn('[auth] admin.deleteUser threw, will fallback:', (e as Error).message)
    }

    // Step 3: Fallback manual profile deletion if admin delete failed
    if (!adminDeleted) {
      const { error: profileErr } = await supabase.from('profiles').delete().eq('id', userId)
      if (profileErr) {
        console.error('[auth] Manual profile deletion failed:', profileErr.message)
        return jsonResponse(
          { success: false, message: `Failed to delete account: ${profileErr.message}` },
          500,
        )
      }
    }

    console.log(`[auth] Deletion flow complete for user ${userId}`)
    return jsonResponse({ success: true, message: 'Account deletion completed successfully.' })
  } catch (error: unknown) {
    const err = error as { message?: string }
    console.error('[auth] Unexpected error:', err)
    return jsonResponse({ success: false, message: err.message ?? 'Unexpected error deleting account.' }, 500)
  }
})
