// Supabase Edge Function: expire-bounty-requests
//
// Cron-triggered (pg_cron -> net.http_post, every 15 minutes, see
// 20260913000000_bounty_request_expiry_and_poster_nudges.sql). The actual
// state transition (pending -> rejected, rejection_source='system_expiry')
// and the hunter-facing "closed loop" notification are both done inside
// fn_expire_bounty_requests as a single SQL transaction -- this function's
// only job is the one thing plain SQL can't do here: firing the
// `application_expired` PostHog event per expired request, mirroring
// process-notification's capturePostHogEvents pattern.
//
// Auth mirrors supabase/functions/reconciliation/index.ts's bearer-token
// pattern, but with its own secret (EXPIRE_BOUNTY_REQUESTS_CRON_SECRET)
// rather than reusing RECONCILIATION_CRON_SECRET -- a dedicated credential
// per cron-triggered function so one can be rotated or revoked without
// affecting the other. There is no human-triggered path for this function,
// so unlike reconciliation there is no admin-JWT fallback.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface ExpiredRequestRow {
  request_id: string;
  bounty_id: string;
  hunter_id: string | null;
  poster_id: string;
  hours_open: number;
}

async function capturePostHogEvents(
  events: Array<{ event: string; distinct_id: string; properties?: Record<string, unknown> }>
): Promise<void> {
  if (events.length === 0) return;
  const posthogKey = Deno.env.get('POSTHOG_PROJECT_API_KEY');
  if (!posthogKey) return;
  try {
    const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
    await fetch(`${host}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({
        api_key: posthogKey,
        batch: events.map((e) => ({
          event: e.event,
          distinct_id: e.distinct_id,
          properties: { ...e.properties, source: 'expire-bounty-requests' },
          timestamp: new Date().toISOString(),
        })),
      }),
    });
  } catch (e) {
    // Best-effort telemetry: a PostHog outage must never surface as a cron
    // failure, since the actual state transition already committed in SQL.
    console.error('[expire-bounty-requests] PostHog capture failed (non-fatal)', e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const cronSecret = Deno.env.get('EXPIRE_BOUNTY_REQUESTS_CRON_SECRET') ?? '';

    if (!cronSecret || bearer !== cronSecret) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Supabase Edge Function is not configured' }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase.rpc('fn_expire_bounty_requests', { p_dry_run: false });

    if (error) {
      console.error('[expire-bounty-requests] fn_expire_bounty_requests failed', error);
      return jsonResponse({ error: String(error) }, 500);
    }

    const rows = (data ?? []) as ExpiredRequestRow[];

    const events = rows
      .filter((r) => !!r.hunter_id)
      .map((r) => ({
        event: 'application_expired',
        distinct_id: r.hunter_id as string,
        properties: {
          bounty_id: r.bounty_id,
          request_id: r.request_id,
          hours_open: r.hours_open,
        },
      }));

    await capturePostHogEvents(events);

    return jsonResponse({ ok: true, expired: rows.length });
  } catch (error) {
    console.error('[expire-bounty-requests] error', error);
    return jsonResponse({ error: String(error) }, 500);
  }
});
