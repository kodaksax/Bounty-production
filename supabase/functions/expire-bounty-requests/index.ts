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
//
// A second, separate mode -- body {"mode":"absent_poster_sweep"} -- runs
// fn_sweep_absent_posters. The 15-minute cron never sends it; it is only
// invoked explicitly (and defaults to dry_run: true), so closing an absent
// poster's bounties is never a side effect of the general expiry rule. Both
// modes emit the same `application_expired` event, told apart by `reason`.

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
  poster_interacted?: boolean;
}

interface SweptRequestRow {
  sweep_id: string;
  request_id: string;
  bounty_id: string;
  hunter_id: string | null;
  poster_id: string;
  poster_is_internal: boolean;
  poster_last_active_at: string | null;
  bounty_action: 'archived' | 'flagged_funded';
  request_created_at: string;
  dry_run: boolean;
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

    // Auth-only probe from public.ops_smoke_check_edge_auth(): proves the
    // caller's credential is accepted without expiring anything.
    if (req.headers.get('x-auth-probe') === '1') {
      return jsonResponse({ ok: true, probe: true });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Supabase Edge Function is not configured' }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = (await req.json().catch(() => ({}))) as { mode?: string; dry_run?: boolean; absent_days?: number };

    if (body.mode === 'absent_poster_sweep') {
      const dryRun = body.dry_run !== false;
      const { data: swept, error: sweepError } = await supabase.rpc('fn_sweep_absent_posters', {
        p_dry_run: dryRun,
        p_absent_days: typeof body.absent_days === 'number' ? body.absent_days : null,
      });
      if (sweepError) {
        console.error('[expire-bounty-requests] fn_sweep_absent_posters failed', sweepError);
        return jsonResponse({ error: String(sweepError) }, 500);
      }
      const sweptRows = (swept ?? []) as SweptRequestRow[];
      if (!dryRun) {
        await capturePostHogEvents(
          sweptRows
            .filter((r) => !!r.hunter_id)
            .map((r) => ({
              event: 'application_expired',
              distinct_id: r.hunter_id as string,
              properties: {
                bounty_id: r.bounty_id,
                request_id: r.request_id,
                reason: 'poster_absent',
                sweep_id: r.sweep_id,
                bounty_action: r.bounty_action,
                poster_is_internal: r.poster_is_internal,
                hours_open: Math.round(((Date.now() - Date.parse(r.request_created_at)) / 3_600_000) * 10) / 10,
              },
            }))
        );
      }
      return jsonResponse({
        ok: true,
        mode: 'absent_poster_sweep',
        dry_run: dryRun,
        sweep_id: sweptRows[0]?.sweep_id ?? null,
        requests: sweptRows.length,
        bounties: new Set(sweptRows.map((r) => r.bounty_id)).size,
      });
    }

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
          reason: 'no_response',
          poster_interacted: r.poster_interacted === true,
        },
      }));

    await capturePostHogEvents(events);

    // Heartbeat for fn_check_job_health(): a run that expires nothing is still
    // a successful run, and has no other output row to observe. A run we
    // cannot observe is reported as a failure (500) so it shows up in
    // net._http_response and the edge-auth-or-5xx probe. The expiry above has
    // already committed; the next run simply finds nothing new to expire.
    const { error: beatError } = await supabase.rpc('record_job_heartbeat', {
      p_job_name: 'expire-stale-bounty-requests',
      p_detail: { expired: rows.length },
    });
    if (beatError) {
      console.error('[expire-bounty-requests] heartbeat write failed', beatError);
      return jsonResponse({ ok: false, expired: rows.length, error: 'heartbeat_write_failed' }, 500);
    }

    return jsonResponse({ ok: true, expired: rows.length });
  } catch (error) {
    console.error('[expire-bounty-requests] error', error);
    return jsonResponse({ error: String(error) }, 500);
  }
});
