// Support cases: the one place a situation that needs a person is recorded.
//
// Opened by poster-web (a poster asked for help, reported a problem, or
// confirmed a job whose payout could not start), email-inbound (a reply to a
// notification email) and geocode-bounties (an in-person bounty with no
// usable location). The public.support_cases row is the record; the alert
// email to SUPPORT_ALERT_EMAIL is only a nudge so a person sees it today.
//
// Deno-only (reads env, calls fetch). The DB client is passed in.

declare const Deno: any

type Json = Record<string, unknown>

export async function openSupportCase(
  admin: any,
  supabaseUrl: string,
  serviceKey: string,
  c: {
    kind: string
    channel: 'web' | 'email' | 'system'
    posterId: string | null
    bountyId: string | null
    requestId?: string | null
    summary: string
    metadata?: Json
    dedupeKey?: string
  }
): Promise<string | null> {
  const row = {
    kind: c.kind,
    channel: c.channel,
    poster_id: c.posterId,
    bounty_id: c.bountyId,
    request_id: c.requestId ?? null,
    summary: c.summary.slice(0, 4000),
    metadata: c.metadata ?? {},
    ...(c.dedupeKey ? { dedupe_key: c.dedupeKey } : {}),
  }
  const { data, error } = await admin.from('support_cases').insert(row).select('id').maybeSingle()
  if (error) {
    // 23505 = an open case for this situation already exists; that's fine.
    if (error.code === '23505' && c.dedupeKey) {
      const { data: existing } = await admin.from('support_cases').select('id').eq('dedupe_key', c.dedupeKey).maybeSingle()
      return existing?.id ?? null
    }
    console.error('[support-cases] insert failed', { kind: c.kind, code: error.code })
    return null
  }
  // Nudge a person now. The case row is the record; the email is best-effort.
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        supportAlert: true,
        title: `Support case: ${c.kind.replace(/_/g, ' ')}`,
        body: `${c.summary}\n\nCase ${data?.id}${c.bountyId ? ` · bounty ${c.bountyId}` : ''}${c.posterId ? ` · poster ${c.posterId}` : ''}`,
        data: {},
      }),
    })
  } catch (_) { /* best-effort */ }
  capture(c.posterId ?? 'system', 'support_intervention_required', { kind: c.kind, channel: c.channel, bounty_id: c.bountyId })
  return data?.id ?? null
}

// Server-side analytics, PostHog HTTP capture (same pattern as app-link /
// process-notification). Properties are ids and enums only — never a name,
// email, phone, address or free text. Fire-and-forget.
export function capture(distinctId: string, event: string, properties: Json): void {
  const apiKey = Deno.env.get('POSTHOG_PROJECT_API_KEY')
  if (!apiKey) return
  const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com'
  const task = fetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({
      api_key: apiKey,
      event,
      properties: { distinct_id: distinctId, platform: 'web', app_env: 'production', source: 'poster-web', ...properties },
    }),
  }).catch(() => {})
  const runtime = (globalThis as any).EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(task)
}
