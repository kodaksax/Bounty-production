// Supabase Edge Function: admin-verifications-list
//
// Returns the queue of pending ID verifications along with short-lived signed
// URLs to each user's uploaded `id-front.jpg`, `id-back.jpg` (if present), and
// `selfie.jpg` in the private `verification-docs` bucket.
//
// Service role is required because RLS only allows users to read their own
// folder in `verification-docs`. The function authenticates the caller's JWT
// and rejects non-admins so the service role is never exposed to clients.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const BUCKET = 'verification-docs'
// Short-lived signed URLs so admins can view but links can't be shared widely.
const SIGNED_URL_TTL_SECONDS = 60 * 10 // 10 minutes
// Cap the response to keep payloads small. Admins can paginate by reviewing
// approvals and re-fetching.
const MAX_RESULTS = 50

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface PendingProfile {
  id: string
  username: string | null
  display_name: string | null
  id_submitted_at: string | null
  selfie_submitted_at: string | null
}

interface VerificationItem extends PendingProfile {
  id_front_url: string | null
  id_back_url: string | null
  selfie_url: string | null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Authenticate caller and verify admin role.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401)
  }
  const token = authHeader.substring(7)
  const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !caller) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }

  const roles = caller.app_metadata?.roles
  const hasAdminRole = Array.isArray(roles)
    ? roles.includes('admin')
    : typeof roles === 'string'
      ? roles === 'admin'
      : false
  const isAdmin = (caller.app_metadata?.role === 'admin') || hasAdminRole
  if (!isAdmin) {
    return jsonResponse({ error: 'Forbidden: admin access required' }, 403)
  }

  // Fetch pending profiles (oldest first so the queue is FIFO).
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, username, display_name, id_submitted_at, selfie_submitted_at')
    .eq('id_verification_status', 'pending')
    .order('id_submitted_at', { ascending: true, nullsFirst: false })
    .limit(MAX_RESULTS)

  if (profilesError) {
    console.error('[admin-verifications-list] Failed to fetch profiles:', profilesError)
    return jsonResponse({ error: 'Failed to fetch verification queue' }, 500)
  }

  const pending = (profiles ?? []) as PendingProfile[]

  // Generate signed URLs in parallel. Missing files are tolerated (null URL).
  const items: VerificationItem[] = await Promise.all(
    pending.map(async (p) => {
      const signOne = async (filename: string): Promise<string | null> => {
        try {
          const { data, error } = await supabaseAdmin
            .storage
            .from(BUCKET)
            .createSignedUrl(`${p.id}/${filename}`, SIGNED_URL_TTL_SECONDS)
          if (error || !data?.signedUrl) return null
          return data.signedUrl
        } catch (e) {
          console.warn(`[admin-verifications-list] Could not sign ${p.id}/${filename}:`, e)
          return null
        }
      }

      const [idFront, idBack, selfie] = await Promise.all([
        signOne('id-front.jpg'),
        signOne('id-back.jpg'),
        signOne('selfie.jpg'),
      ])

      return {
        ...p,
        id_front_url: idFront,
        id_back_url: idBack,
        selfie_url: selfie,
      }
    }),
  )

  return jsonResponse({ items, count: items.length })
})
