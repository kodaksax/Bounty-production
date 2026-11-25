// Server-side analytics, PostHog HTTP capture (same pattern as app-link /
// process-notification). Properties are ids and enums only — never a name,
// email, phone, address or free text. Fire-and-forget: it never throws and
// never delays the caller's response.
//
// Deno-only (reads env, calls fetch). Re-exported by support-cases.ts, where
// it used to live, so existing imports keep working.

import { resolveAppEnv } from './signup-completed-event.ts'
import type { ServerEvent } from './web-marketplace-events.ts'

declare const Deno: any

type Json = Record<string, unknown>

export interface CaptureOptions {
  /**
   * A fixed uuid per business fact, so PostHog drops a retried send instead of
   * counting it twice. Must be a valid uuid.
   */
  uuid?: string
  /** ISO time of the fact. Defaults to the time PostHog receives it. */
  timestamp?: string
}

export function capture(distinctId: string, event: string, properties: Json, opts: CaptureOptions = {}): void {
  const apiKey = Deno.env.get('POSTHOG_PROJECT_API_KEY')
  if (!apiKey) return
  const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com'
  // Staging shares the PostHog project, so this must not claim 'production'
  // there (it was hard-coded until 2026-11-24).
  const appEnv = resolveAppEnv(Deno.env.get('APP_ENV'), Deno.env.get('SUPABASE_URL') ?? '')
  const task = fetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({
      api_key: apiKey,
      event,
      ...(opts.uuid ? { uuid: opts.uuid } : {}),
      ...(opts.timestamp ? { timestamp: opts.timestamp } : {}),
      properties: { distinct_id: distinctId, platform: 'web', app_env: appEnv, source: 'poster-web', ...properties },
    }),
  }).catch(() => {})
  const runtime = (globalThis as any).EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(task)
}

/** Sends an event built by web-marketplace-events.ts. */
export function sendServerEvent(e: ServerEvent): void {
  capture(e.distinct_id, e.event, e.properties, { uuid: e.uuid, timestamp: e.timestamp })
}
