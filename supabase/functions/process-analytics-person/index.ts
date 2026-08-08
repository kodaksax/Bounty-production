// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

const jsonResponse = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async request => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const posthogKey = Deno.env.get('POSTHOG_PROJECT_API_KEY');
  const authorization = request.headers.get('Authorization');

  if (!supabaseUrl || !serviceRoleKey || authorization !== `Bearer ${serviceRoleKey}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { user_id: userId } = (await request.json()) as { user_id?: string };
  if (!userId) {
    return jsonResponse({ error: 'user_id is required' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: outbox, error: readError } = await supabase
    .from('analytics_person_outbox')
    .select('properties, updated_at, attempts, status')
    .eq('user_id', userId)
    .maybeSingle();

  if (readError) {
    console.error('[process-analytics-person] failed to read outbox row', readError);
    return jsonResponse({ error: 'Failed to read outbox row' }, 500);
  }
  if (!outbox || outbox.status === 'sent') {
    return jsonResponse({ success: true, skipped: true }, 200);
  }

  const markFailure = async (message: string) => {
    await supabase
      .from('analytics_person_outbox')
      .update({
        status: 'failed',
        attempts: outbox.attempts,
        last_error: message.slice(0, 1000),
        scheduled_at: new Date(Date.now() + 120_000).toISOString(),
      })
      .eq('user_id', userId)
      .eq('updated_at', outbox.updated_at);
  };

  if (!posthogKey) {
    await markFailure('POSTHOG_PROJECT_API_KEY is not configured');
    return jsonResponse({ error: 'PostHog is not configured' }, 503);
  }

  try {
    const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
    const posthogResponse = await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        api_key: posthogKey,
        event: '$set',
        properties: {
          distinct_id: userId,
          is_internal: outbox.properties.is_internal,
          source: 'server_person_sync',
          $set: outbox.properties,
        },
        timestamp: new Date().toISOString(),
      }),
    });

    if (!posthogResponse.ok) {
      throw new Error(`PostHog request failed (${posthogResponse.status})`);
    }

    await supabase
      .from('analytics_person_outbox')
      .update({ status: 'sent', last_error: null, scheduled_at: null })
      .eq('user_id', userId)
      .eq('updated_at', outbox.updated_at);

    return jsonResponse({ success: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[process-analytics-person] PostHog sync failed', { userId, message });
    await markFailure(message);
    return jsonResponse({ error: 'PostHog sync failed' }, 502);
  }
});
