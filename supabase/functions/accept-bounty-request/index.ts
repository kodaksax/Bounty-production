// Allow remote Deno std import in this file (Edge Function runtime).
// @ts-ignore: Remote Deno std types may not be available to the workspace TypeScript server
import { serve } from 'https://deno.land/std@0.201.0/http/server.ts';

// Edge Function: accept-bounty-request (no external deps)
// POST body: { request_id: string }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  Deno.env.get('SUPABASE_SERVICE_KEY') ||
  Deno.env.get('SERVICE_ROLE_KEY') ||
  '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY in environment');
}

serve(async (req: Request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return new Response(
        JSON.stringify({ error: 'Server misconfigured: missing SUPABASE_URL or SERVICE_ROLE_KEY' }),
        { status: 500 }
      );
    }
    if (req.method !== 'POST')
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

    // Authenticate the caller. This function calls the DB RPC with the
    // service-role key (which carries no auth.uid() context), so without this
    // check ANY authenticated user could accept ANY pending bounty request for
    // ANY bounty by supplying an arbitrary request_id — the RPC itself only
    // validates request/bounty state, not caller identity.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid authorization header' }), {
        status: 401,
      });
    }
    const callerToken = authHeader.substring(7);
    const baseUrl = SUPABASE_URL.replace(/\/$/, '');
    const userResp = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${callerToken}` },
    }).catch(() => null);
    if (!userResp || !userResp.ok) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401 });
    }
    const callerUser: any = await userResp.json().catch(() => null);
    const callerId = callerUser?.id;
    if (!callerId) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401 });
    }

    const body: any = await (req.json?.() ?? Promise.resolve(null)).catch(() => null);
    const requestId = body?.request_id || body?.id;
    if (!requestId)
      return new Response(JSON.stringify({ error: 'Missing request_id' }), { status: 400 });

    // Verify the caller is the poster who owns the bounty this request targets
    // before mutating anything. bounty_requests.poster_id is denormalized onto
    // the row specifically for checks like this.
    const lookupUrl = `${baseUrl}/rest/v1/bounty_requests?id=eq.${encodeURIComponent(
      String(requestId)
    )}&select=poster_id,status`;
    const lookupResp = await fetch(lookupUrl, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    }).catch(() => null);
    if (!lookupResp || !lookupResp.ok) {
      return new Response(JSON.stringify({ error: 'Failed to verify bounty request' }), {
        status: 502,
      });
    }
    const lookupRows: any = await lookupResp.json().catch(() => null);
    const requestRow = Array.isArray(lookupRows) ? lookupRows[0] : null;
    if (!requestRow) {
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
    }
    if (requestRow.poster_id !== callerId) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: only the bounty poster can accept requests' }),
        { status: 403 }
      );
    }

    // Call the DB-stored PL/pgSQL function via Supabase REST RPC endpoint
    const rpcUrl = `${baseUrl}/rest/v1/rpc/fn_accept_bounty_request`;

    const rpcResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_request_id: String(requestId) }),
    }).catch(e => ({ ok: false, status: 500, text: async () => String(e) }));

    const isResponse = (r: any): r is Response => !!r && typeof r.json === 'function';

    if (!rpcResp || !('ok' in rpcResp) || !rpcResp.ok) {
      const status = rpcResp && 'status' in rpcResp ? rpcResp.status : 500;
      const text = await (rpcResp && typeof (rpcResp as any).text === 'function'
        ? (rpcResp as any).text()
        : Promise.resolve('<no-body>'));
      console.error('fn_accept_bounty_request RPC failed', { status, text });
      // Map not-found errors to 404, and state-conflict errors to 409
      if (/request_not_found|bounty_not_found/i.test(text || '')) {
        return new Response(JSON.stringify({ error: 'Not Found', details: text }), { status: 404 });
      }
      if (/request_not_pending|bounty_not_open/i.test(text || '')) {
        return new Response(
          JSON.stringify({
            error: 'Conflict: bounty not open or request not pending',
            details: text,
          }),
          { status: 409 }
        );
      }
      return new Response(JSON.stringify({ error: 'Server error', details: text }), {
        status: status,
      });
    }

    if (!isResponse(rpcResp)) {
      // Unexpected shape (shouldn't happen if ok === true), but defend anyway
      return new Response(JSON.stringify({ error: 'Unexpected RPC response' }), { status: 500 });
    }

    const data = await rpcResp.json().catch(() => null);
    return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  } catch (e) {
    console.error('Unhandled error in accept-bounty-request', e);
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: 'Server error', details: message }), {
      status: 500,
    });
  }
});
