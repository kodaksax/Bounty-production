-- Rollback for 20261019200000_applicant_distance.sql (SBA-02).
-- Drops the stamp trigger, the distance function and the three columns, and
-- restores bounty_requests_broadcast_changes() to the live definition captured
-- on 2026-10-19 (md5 ee307e3c21a06a4389eaa072f43bde81 on production and
-- staging). The stored distances are lost; they can be recomputed by
-- re-applying the migration (it backfills).

BEGIN;

DROP TRIGGER IF EXISTS zz_bounty_requests_applicant_distance ON public.bounty_requests;
DROP FUNCTION IF EXISTS public.fn_bounty_requests_stamp_distance();
DROP FUNCTION IF EXISTS public.fn_bounty_request_distance(uuid, uuid);

-- Restore first: the masked version references the columns dropped below.
CREATE OR REPLACE FUNCTION public.bounty_requests_broadcast_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_bounty_id uuid;
begin
  v_bounty_id := coalesce(new.bounty_id, old.bounty_id);

  if tg_op = 'INSERT' then
    perform realtime.broadcast_changes(
      'bounty:' || v_bounty_id::text,
      'applied',
      tg_op,
      tg_table_name,
      tg_table_schema,
      new,
      old
    );
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      perform realtime.broadcast_changes(
        'bounty:' || v_bounty_id::text,
        'application_status_changed',
        tg_op,
        tg_table_name,
        tg_table_schema,
        new,
        old
      );
    end if;
  end if;

  return null;
end;
$function$;

REVOKE ALL ON FUNCTION public.bounty_requests_broadcast_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bounty_requests_broadcast_changes() TO service_role;

ALTER TABLE public.bounty_requests
  DROP CONSTRAINT IF EXISTS bounty_requests_distance_mi_check,
  DROP COLUMN IF EXISTS distance_computed_at,
  DROP COLUMN IF EXISTS is_far,
  DROP COLUMN IF EXISTS distance_mi;

COMMIT;
