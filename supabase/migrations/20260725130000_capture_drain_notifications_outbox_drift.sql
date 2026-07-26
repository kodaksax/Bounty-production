-- Captures pre-existing git/live drift discovered while building the
-- notification redesign (2026-07-25): public.drain_notifications_outbox() and
-- its `drain-notifications-outbox` pg_cron job (schedule '* * * * *') already
-- existed live in production but were never committed to this repo — the only
-- record of them was the live database itself. The webhook Payments cutover
-- in this same change set depends on this cron job to pick up the outbox rows
-- it enqueues, so it needs to be in git history rather than only living in
-- prod. This migration is idempotent and reproduces the function/cron job
-- exactly as found, with one fix applied: the function's EXECUTE grant was
-- open to `anon` (unauthenticated) and `authenticated` via PostgREST RPC —
-- meaning any internet caller could invoke
-- `/rest/v1/rpc/drain_notifications_outbox` directly. This is
-- cron/service-role-only internal plumbing and must not be publicly callable;
-- the REVOKE below (already applied ad hoc to production during this
-- investigation) is included here so a fresh environment gets the same fix.

BEGIN;

CREATE OR REPLACE FUNCTION public.drain_notifications_outbox()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_url text;
  v_key text;
  r record;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'SUPABASE_URL';
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY';

  if v_url is null or v_key is null then
    raise warning 'drain_notifications_outbox: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in vault';
    return;
  end if;

  for r in
    select id
    from public.notifications_outbox
    where (status = 'pending' or (status = 'failed' and attempts < 5))
      and (scheduled_at is null or scheduled_at <= now())
    order by created_at
    limit 100
  loop
    perform net.http_post(
      url     := v_url || '/functions/v1/process-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object('id', r.id)
    );

    update public.notifications_outbox
      set scheduled_at = now() + interval '2 minutes'
      where id = r.id;
  end loop;
end;
$function$;

REVOKE ALL ON FUNCTION public.drain_notifications_outbox() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_notifications_outbox() TO service_role;

-- Idempotent cron job registration (unschedule-then-schedule, since
-- cron.schedule() errors on a duplicate jobname rather than upserting).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain-notifications-outbox') THEN
    PERFORM cron.unschedule('drain-notifications-outbox');
  END IF;
  PERFORM cron.schedule('drain-notifications-outbox', '* * * * *', 'select public.drain_notifications_outbox()');
END;
$$;

COMMIT;
