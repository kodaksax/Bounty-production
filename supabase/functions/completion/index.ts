// Supabase Edge Function: completion
// Handles completion workflow routes that need server-side privileges.
// Routes:
//   POST /completion/ready
//   GET  /completion/ready?bountyId=<uuid>

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

function sanitizeUuid(value: unknown): string {
  const text = String(value ?? '').trim()
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidPattern.test(text)) {
    throw new Error('Invalid UUID')
  }
  return text
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const pathParts = url.pathname.split('/completion')
  const subPath = pathParts.length > 1 ? pathParts[1] : '/'

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Supabase Edge Function is not configured' }, 500)
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401)
  }

  const token = authHeader.substring(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }

  try {
    if (req.method === 'POST' && subPath === '/ready') {
      const body = await req.json().catch(() => ({})) as { bounty_id?: string; hunter_id?: string }
      const bountyId = sanitizeUuid(body.bounty_id)
      const hunterId = sanitizeUuid(body.hunter_id ?? user.id)

      if (hunterId !== user.id) {
        return jsonResponse({ error: 'Authenticated user does not match hunter_id' }, 403)
      }

      const { data: bounty, error: bountyError } = await supabaseAdmin
        .from('bounties')
        .select('id, status, accepted_by')
        .eq('id', bountyId)
        .maybeSingle()

      if (bountyError) {
        console.error('[completion] Failed to fetch bounty:', bountyError)
        return jsonResponse({ error: 'Failed to fetch bounty' }, 500)
      }

      if (!bounty) {
        return jsonResponse({ error: 'Bounty not found' }, 404)
      }

      if (bounty.status !== 'in_progress') {
        return jsonResponse({ error: 'Bounty must be in progress before marking ready' }, 400)
      }

      if (bounty.accepted_by && String(bounty.accepted_by) !== hunterId) {
        return jsonResponse({ error: 'Only the accepted hunter can mark this bounty as ready' }, 403)
      }

      const readyAt = new Date().toISOString()
      const payload = {
        bounty_id: bountyId,
        hunter_id: hunterId,
        ready_at: readyAt,
      }

      // Try an atomic upsert to avoid race conditions where concurrent
      // requests both try to insert the same ready record. If the
      // database doesn't support the specified ON CONFLICT target (no
      // unique index), fall back to the legacy read-then-write flow.
      let usedFallback = false
      try {
        const { error: upsertError } = await supabaseAdmin
          .from('completion_ready')
          .upsert([payload], { onConflict: 'bounty_id,hunter_id' })

        if (upsertError) {
          const msg = (upsertError as any)?.message || String(upsertError)
          if (!/unique|on conflict|constraint/i.test(msg)) {
            console.error('[completion] Upsert failed:', upsertError)
            return jsonResponse({ error: 'Failed to save ready state' }, 500)
          }
          // Otherwise, fall through to fallback flow below
          usedFallback = true
        }
      } catch (e) {
        const emsg = e instanceof Error ? e.message : String(e)
        if (!/unique|on conflict|constraint/i.test(emsg)) {
          console.error('[completion] Upsert error:', e)
          return jsonResponse({ error: 'Failed to save ready state' }, 500)
        }
        usedFallback = true
      }

      if (usedFallback) {
        const { data: existing, error: fetchError } = await supabaseAdmin
          .from('completion_ready')
          .select('*')
          .eq('bounty_id', bountyId)
          .eq('hunter_id', hunterId)
          .limit(1)
          .maybeSingle()

        if (fetchError) {
          console.error('[completion] Failed to fetch existing ready record:', fetchError)
          return jsonResponse({ error: 'Failed to check ready state' }, 500)
        }

        if (existing) {
          const { error: updateError } = await supabaseAdmin
            .from('completion_ready')
            .update({ ready_at: readyAt })
            .eq('bounty_id', bountyId)
            .eq('hunter_id', hunterId)

          if (updateError) {
            console.error('[completion] Failed to update ready record:', updateError)
            return jsonResponse({ error: 'Failed to update ready state' }, 500)
          }
        } else {
          const { error: insertError } = await supabaseAdmin
            .from('completion_ready')
            .insert(payload)

          if (insertError) {
            console.error('[completion] Failed to insert ready record:', insertError)
            return jsonResponse({ error: 'Failed to save ready state' }, 500)
          }
        }
      }

      return jsonResponse({
        message: 'Bounty marked ready successfully',
        data: {
          bounty_id: bountyId,
          hunter_id: hunterId,
          ready_at: readyAt,
        },
      })
    }

    if (req.method === 'GET' && subPath === '/ready') {
      const bountyId = sanitizeUuid(url.searchParams.get('bountyId'))

      const { data, error } = await supabaseAdmin
        .from('completion_ready')
        .select('*')
        .eq('bounty_id', bountyId)
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error('[completion] Failed to fetch ready state:', error)
        return jsonResponse({ error: 'Failed to fetch ready state' }, 500)
      }

      return jsonResponse(data ?? null)
    }

    return jsonResponse({ error: 'Not found' }, 404)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('[completion edge fn] Error:', error)
    const status = message === 'Invalid UUID' ? 400 : 500
    return jsonResponse({ error: message }, status)
  }
})
