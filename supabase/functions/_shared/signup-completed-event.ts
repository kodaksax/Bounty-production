// Server-side `signup_completed` (SBA-13). One row per new account is queued
// in public.analytics_signup_events by the profiles INSERT trigger
// (20261020140000_server_signup_completed_event.sql); process-analytics-person
// sends it in the same PostHog batch as the person `$set`.
//
// Pure module (no Deno APIs) so jest can pin the payload shape.

/** Marks the server event; insights filter on it (old builds still send a client one). */
export const SIGNUP_COMPLETED_SOURCE = 'server_profile_insert';

export interface PendingSignupEvent {
  method: string;
  event_uuid: string;
  signed_up_at: string;
}

export interface PostHogBatchEvent {
  event: string;
  distinct_id: string;
  uuid?: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

const PRODUCTION_PROJECT_REF = 'xwlwqzzphmmhghiqvkeu';

/**
 * `app_env` for server events, matching the app's super property. Staging
 * builds share the PostHog project (29 of the 123 client signup_completed
 * events in the 45 days to 2026-10-19 were app_env=staging), so insights
 * filter on it. APP_ENV wins when set; otherwise only the production project
 * reports 'production', so an unset variable on staging cannot pass as prod.
 */
export function resolveAppEnv(appEnv: string | undefined, supabaseUrl: string): string {
  if (appEnv) return appEnv;
  return supabaseUrl.includes(PRODUCTION_PROJECT_REF) ? 'production' : 'staging';
}

/**
 * The PostHog event for one account's signup. The uuid and timestamp are fixed
 * per account, so a retried send after a partial failure is deduplicated by
 * PostHog rather than counted twice.
 */
export function buildSignupCompletedEvent(
  userId: string,
  signup: PendingSignupEvent,
  isInternal: unknown,
  appEnv: string
): PostHogBatchEvent {
  return {
    event: 'signup_completed',
    distinct_id: userId,
    uuid: signup.event_uuid,
    timestamp: new Date(signup.signed_up_at).toISOString(),
    properties: {
      distinct_id: userId,
      method: signup.method,
      lifecycle_stage: 'signed_up',
      is_internal: isInternal === true,
      app_env: appEnv,
      source: SIGNUP_COMPLETED_SOURCE,
    },
  };
}

/**
 * A read failure on analytics_signup_events must not block the person sync:
 * the function is deployed before the table exists (see the migration's deploy
 * order), and a missing signup event is far cheaper than a stuck `$set`.
 */
export function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01 = undefined_table (Postgres); PGRST205 = table not in schema cache (PostgREST).
  return error.code === '42P01' || error.code === 'PGRST205';
}
