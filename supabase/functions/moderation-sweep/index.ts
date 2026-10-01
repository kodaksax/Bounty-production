// Supabase Edge Function: moderation-sweep
//
// Runs the bounty moderation sweep and fans out founder alerts.
//
//   1. rpc('run_moderation_sweep') -- recomputes velocity / duplicate /
//      repeated / new-account signals, auto-flags listings that cross the
//      signal_score threshold (never further than FLAGGED), evaluates every
//      enabled row in moderation_alert_thresholds, and returns the alerts it
//      created this run.
//   2. For each new alert: in-app notification for every admin, a push via the
//      notifications_outbox + process-notification path, and an email via
//      send-notification-email. Every delivery step is best-effort -- a failed
//      channel is logged, never fatal. Since 20261001140000 the sweep returns
//      every alert not yet fanned out, including report-driven reviews and
//      escalation reviews raised outside the sweep.
//   3. Forwards uncaptured reports to PostHog as `report_submitted` (see
//      _shared/report-submitted-events.ts). Best-effort; never fails the run.
//
// Invocation:
//   * Supabase scheduled function -- configure a cron trigger in the Supabase
//     Dashboard -> Edge Functions -> moderation-sweep -> Schedules,
//     e.g. "*/10 * * * *". NOT scheduled by the change that adds this file.
//   * Manual / test:
//       curl -X POST https://<project>.supabase.co/functions/v1/moderation-sweep \
//         -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
//
// Auth: same pattern as expire-bounties / send-expo-push -- verify_jwt is
// disabled in config.toml and the function requires the service role key as a
// bearer token (it reads auth.users and writes notifications for arbitrary
// admins).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  forwardReportSubmittedEvents,
  type PostHogEvent,
} from '../_shared/report-submitted-events.ts';

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

interface ModerationAlert {
  id: string;
  alert_key: string;
  threshold_key: string;
  bounty_id: string | null;
  poster_id: string | null;
  severity: string;
  summary: string;
  detail: Record<string, unknown>;
  created_at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[moderation-sweep] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return jsonResponse({ error: 'Server misconfiguration' }, 500);
  }

  // Require the service role key as a bearer token (verify_jwt is off at the
  // gateway, so this check is the auth boundary for the function itself).
  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== `Bearer ${serviceRoleKey}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // Auth-only probe from public.ops_smoke_check_edge_auth(): proves the
  // caller's credential is accepted without running a sweep.
  if (req.headers.get('x-auth-probe') === '1') {
    return jsonResponse({ ok: true, probe: true });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const { data: sweepData, error: sweepErr } = await supabaseAdmin.rpc('run_moderation_sweep');
    if (sweepErr) {
      console.error('[moderation-sweep] run_moderation_sweep error', sweepErr);
      return jsonResponse({ error: sweepErr.message }, 500);
    }

    let reportEvents: Awaited<ReturnType<typeof forwardReportSubmittedEvents>>;
    try {
      reportEvents = await forwardReportSubmittedEvents(supabaseAdmin, sendPostHogBatch);
    } catch (e) {
      reportEvents = { pending: 0, sent: 0, marked: 0, error: String(e) };
    }
    if (reportEvents.error) {
      console.error('[moderation-sweep] report_submitted forwarding failed (non-fatal)', reportEvents.error);
    }

    const alerts = (sweepData as ModerationAlert[] | null) ?? [];
    if (alerts.length === 0) {
      return jsonResponse({ ok: true, alerts_created: 0, notified: 0, report_events: reportEvents });
    }

    // Resolve admin recipients once.
    const { data: recipientRows, error: recipErr } = await supabaseAdmin.rpc(
      'moderation_admin_recipients'
    );
    if (recipErr) {
      console.error('[moderation-sweep] moderation_admin_recipients error', recipErr);
    }
    const recipients = (recipientRows as { user_id: string; email: string | null }[] | null) ?? [];
    const adminIds = recipients.map((r) => r.user_id).filter(Boolean);

    if (adminIds.length === 0) {
      console.warn('[moderation-sweep] no admin recipients -- alerts recorded but not delivered');
      return jsonResponse({ ok: true, alerts_created: alerts.length, notified: 0, report_events: reportEvents });
    }

    let delivered = 0;

    for (const alert of alerts) {
      const title = severityTitle(alert.severity);
      const body = alert.summary;
      const data = {
        type: 'moderation_alert',
        alert_id: alert.id,
        threshold: alert.threshold_key,
        bounty_id: alert.bounty_id,
        severity: alert.severity,
        ...alert.detail,
      };

      // (a) in-app bell for every admin
      const { error: bellErr } = await supabaseAdmin.from('notifications').insert(
        adminIds.map((uid) => ({
          user_id: uid,
          type: 'moderation_alert',
          category: 'security',
          title,
          body,
          data,
          read: false,
        }))
      );
      if (bellErr) console.error(`[moderation-sweep] bell insert failed for ${alert.id}`, bellErr);

      // (b) push, via the outbox + process-notification path
      const { data: outboxRow, error: outboxErr } = await supabaseAdmin
        .from('notifications_outbox')
        .insert({
          bounty_id: alert.bounty_id,
          recipients: adminIds,
          title,
          body,
          data,
          status: 'pending',
        })
        .select('id')
        .single();
      if (outboxErr) {
        console.error(`[moderation-sweep] outbox insert failed for ${alert.id}`, outboxErr);
      } else if (outboxRow?.id) {
        supabaseAdmin.functions
          .invoke('process-notification', { body: { id: outboxRow.id } })
          .catch((e) => console.error(`[moderation-sweep] process-notification failed`, e));
      }

      // (c) email
      supabaseAdmin.functions
        .invoke('send-notification-email', {
          body: {
            userIds: adminIds,
            category: 'security',
            type: 'moderation_alert',
            title,
            body,
            data,
          },
        })
        .catch((e) => console.error(`[moderation-sweep] send-notification-email failed`, e));

      delivered += 1;
    }

    return jsonResponse({ ok: true, alerts_created: alerts.length, notified: delivered, report_events: reportEvents });
  } catch (err) {
    console.error('[moderation-sweep] unexpected error', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

// Resolves true only when PostHog accepted the batch, so unaccepted reports
// stay uncaptured and are retried on the next run.
async function sendPostHogBatch(events: PostHogEvent[]): Promise<boolean> {
  const apiKey = Deno.env.get('POSTHOG_PROJECT_API_KEY');
  if (!apiKey) return false;
  const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
  try {
    const res = await fetch(`${host}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({ api_key: apiKey, batch: events }),
    });
    return res.ok;
  } catch (e) {
    console.error('[moderation-sweep] PostHog batch failed (non-fatal)', e);
    return false;
  }
}

function severityTitle(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'Critical moderation alert';
    case 'high':
      return 'Suspicious marketplace activity';
    default:
      return 'Moderation alert';
  }
}
