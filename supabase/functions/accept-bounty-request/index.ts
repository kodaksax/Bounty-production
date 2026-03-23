// Allow remote Deno std import in this file (Edge Function runtime).
// @ts-ignore: Remote Deno std types may not be available to the workspace TypeScript server
import { serve } from 'https://deno.land/std@0.201.0/http/server.ts'

// Edge Function: accept-bounty-request (no external deps)
// POST body: { request_id: string }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY in environment')
}

serve(async (req: Request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return new Response(JSON.stringify({ error: 'Server misconfigured: missing SUPABASE_URL or SERVICE_ROLE_KEY' }), { status: 500 })
    }
    if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })

    const body: any = await (req.json?.() ?? Promise.resolve(null)).catch(() => null)
    const requestId = body?.request_id || body?.id
    if (!requestId) return new Response(JSON.stringify({ error: 'Missing request_id' }), { status: 400 })

    // Call the DB-stored PL/pgSQL function via Supabase REST RPC endpoint
    const rpcUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/fn_accept_bounty_request`

    const rpcResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_request_id: String(requestId) }),
    }).catch((e) => ({ ok: false, status: 500, text: async () => String(e) }))

    const isResponse = (r: any): r is Response => !!r && typeof r.json === 'function'

    if (!rpcResp || !('ok' in rpcResp) || !rpcResp.ok) {
      const status = (rpcResp && 'status' in rpcResp) ? rpcResp.status : 500
      const text = await (rpcResp && typeof (rpcResp as any).text === 'function' ? (rpcResp as any).text() : Promise.resolve('<no-body>'))
      console.error('fn_accept_bounty_request RPC failed', { status, text })
      // Map common function error strings to 409 conflict
      if (/request_not_pending|bounty_not_open|request_not_found|bounty_not_found/i.test(text || '')) {
        return new Response(JSON.stringify({ error: 'Conflict: bounty not open or request not pending', details: text }), { status: 409 })
      }
      return new Response(JSON.stringify({ error: 'Server error', details: text }), { status: status })
    }

    if (!isResponse(rpcResp)) {
      // Unexpected shape (shouldn't happen if ok === true), but defend anyway
      return new Response(JSON.stringify({ error: 'Unexpected RPC response' }), { status: 500 })
    }

    const data = await rpcResp.json().catch(() => null)
    return new Response(JSON.stringify({ success: true, data }), { status: 200 })
  } catch (e) {
    console.error('Unhandled error in accept-bounty-request', e)
    const message = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: 'Server error', details: message }), { status: 500 })
  }
})
