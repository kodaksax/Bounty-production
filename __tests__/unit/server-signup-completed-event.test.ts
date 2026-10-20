/**
 * SBA-13 (a): `signup_completed` once per new account, for every sign-in
 * method, sent by the server so no client branch can miss it.
 *
 * Before: only the email form sent it, and Apple + Google were 431 of 526 new
 * prod profiles in the 45 days to 2026-10-19, so PostHog saw about 1 in 5.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  buildSignupCompletedEvent,
  isMissingRelationError,
  resolveAppEnv,
  SIGNUP_COMPLETED_SOURCE,
} from '../../supabase/functions/_shared/signup-completed-event';

const read = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '../../', relativePath), 'utf8');

const migration = read('supabase/migrations/20261020140000_server_signup_completed_event.sql');
const dispatcher = read('supabase/functions/process-analytics-person/index.ts');

const USER = '6f1c2a3b-0000-4000-8000-000000000001';
const SIGNUP = {
  method: 'apple',
  event_uuid: '0b7f3d1e-1111-4111-8111-111111111111',
  signed_up_at: '2026-10-19T18:04:05.123+00:00',
};

describe('signup_completed payload', () => {
  it('carries the sign-in method and marks itself as the server source', () => {
    const event = buildSignupCompletedEvent(USER, SIGNUP, false, 'production');
    expect(event).toEqual({
      event: 'signup_completed',
      distinct_id: USER,
      uuid: SIGNUP.event_uuid,
      timestamp: '2026-10-19T18:04:05.123Z',
      properties: {
        distinct_id: USER,
        method: 'apple',
        lifecycle_stage: 'signed_up',
        is_internal: false,
        app_env: 'production',
        source: SIGNUP_COMPLETED_SOURCE,
      },
    });
    expect(SIGNUP_COMPLETED_SOURCE).toBe('server_profile_insert');
  });

  it.each(['email', 'apple', 'google', 'phone'])('sends method=%s unchanged', method => {
    expect(buildSignupCompletedEvent(USER, { ...SIGNUP, method }, false, 'production').properties.method).toBe(
      method
    );
  });

  it('is identical on a retry, so PostHog deduplicates it', () => {
    expect(buildSignupCompletedEvent(USER, SIGNUP, true, 'production')).toEqual(
      buildSignupCompletedEvent(USER, SIGNUP, true, 'production')
    );
  });

  it('only reports internal for a strict true', () => {
    expect(buildSignupCompletedEvent(USER, SIGNUP, true, 'production').properties.is_internal).toBe(true);
    expect(buildSignupCompletedEvent(USER, SIGNUP, null, 'production').properties.is_internal).toBe(false);
    expect(buildSignupCompletedEvent(USER, SIGNUP, 'true', 'production').properties.is_internal).toBe(false);
  });

  it('never labels a non-production project as production', () => {
    expect(resolveAppEnv(undefined, 'https://xwlwqzzphmmhghiqvkeu.supabase.co')).toBe('production');
    expect(resolveAppEnv(undefined, 'https://gwumwpoomwvkjyibdmpj.supabase.co')).toBe('staging');
    expect(resolveAppEnv('development', 'https://xwlwqzzphmmhghiqvkeu.supabase.co')).toBe(
      'development'
    );
  });

  it('treats only a missing table as "not migrated yet"', () => {
    expect(isMissingRelationError({ code: '42P01' })).toBe(true);
    expect(isMissingRelationError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingRelationError({ code: '57014' })).toBe(false);
    expect(isMissingRelationError(null)).toBe(false);
  });
});

describe('signup_completed queue (migration contract)', () => {
  it('queues one row per profile INSERT, keyed by user', () => {
    expect(migration).toContain('user_id uuid PRIMARY KEY REFERENCES public.profiles(id)');
    expect(migration).toContain('AFTER INSERT ON public.profiles');
    expect(migration).toContain('ON CONFLICT (user_id) DO NOTHING');
  });

  it('reads the method from the auth provider', () => {
    expect(migration).toContain("u.raw_app_meta_data->>'provider'");
  });

  it('does not count a profile backfilled for an old account', () => {
    expect(migration).toContain("v_signed_up_at > now() - interval '1 day'");
  });

  it('can never fail a signup', () => {
    // The trigger runs inside the auth.users INSERT.
    expect(migration).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);
  });

  it('is server-only', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'REVOKE ALL ON public.analytics_signup_events FROM PUBLIC, anon, authenticated'
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.queue_signup_completed_event() FROM PUBLIC, anon, authenticated'
    );
    expect(migration).toContain("SET search_path TO 'public'");
  });
});

describe('process-analytics-person sends the queued signup', () => {
  it('reads only unsent signup rows', () => {
    expect(dispatcher).toContain(".from('analytics_signup_events')");
    expect(dispatcher).toContain(".is('sent_at', null)");
  });

  it('sends it in the same PostHog batch as the person $set', () => {
    expect(dispatcher).toContain('`${host}/batch/`');
    expect(dispatcher).toContain('buildSignupCompletedEvent(');
    expect(dispatcher).toContain("resolveAppEnv(Deno.env.get('APP_ENV'), supabaseUrl)");
  });

  it('does not skip a pending signup just because the person sync was already sent', () => {
    expect(dispatcher).toContain("outbox.status === 'sent' && !signup");
  });
});
