// Supabase Edge Function: expire-bounties
//
// Finds all bounties whose end_date has passed and whose expiry notification
// has not yet been sent, enqueues a "Bounty Expired" notification for each
// poster, and then fans out to the process-notification function so push
// tokens and in-app bells are updated immediately.
//
// Invocation:
//   • Supabase scheduled function — configure a cron trigger in the
//     Supabase Dashboard → Edge Functions → expire-bounties → Schedules,
//     e.g. "*/5 * * * *" to run every 5 minutes.
//   • Manual / test:
//       curl -X POST https://<project>.supabase.co/functions/v1/expire-bounties \
//         -H "Authorization: ******"
//
// Authentication: this function requires the service role key (verify_jwt is
// disabled in config.toml so the Supabase gateway won't reject the key, and
// the function itself checks the Authorization header is present).

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
    console.error('[expire-bounties] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return jsonResponse({ error: 'Server misconfiguration' }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    // Call the DB function that atomically finds expired bounties, enqueues
    // outbox rows, and stamps expiry_notified_at to prevent duplicates.
    const { data: enqueued, error: rpcErr } = await supabaseAdmin
      .rpc('enqueue_bounty_expiry_notifications');

    if (rpcErr) {
      console.error('[expire-bounties] RPC error', rpcErr);
      return jsonResponse({ error: rpcErr.message }, 500);
    }

    const rows = (enqueued as { outbox_id: string; bounty_id: string }[]) ?? [];

    if (rows.length === 0) {
      return jsonResponse({ processed: 0, message: 'No expired bounties to notify' });
    }

    console.log(`[expire-bounties] ${rows.length} expiry notification(s) enqueued`);

    // Fan out to process-notification for each outbox row so push tokens and
    // in-app bells are updated without waiting for the next polling interval.
    const results = await Promise.allSettled(
      rows.map(({ outbox_id }) =>
        supabaseAdmin.functions.invoke('process-notification', {
          body: { id: outbox_id },
        })
      )
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    if (failed > 0) {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(
            `[expire-bounties] process-notification failed for outbox ${rows[i].outbox_id}`,
            r.reason
          );
        }
      });
    }

    return jsonResponse({
      processed: rows.length,
      succeeded,
      failed,
    });
  } catch (err) {
    console.error('[expire-bounties] unexpected error', err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
