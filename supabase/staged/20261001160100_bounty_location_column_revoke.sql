-- STAGED — DO NOT APPLY YET. Lives outside supabase/migrations on purpose.
--
-- Phase 2 of the location privacy fix (phase 1:
-- supabase/migrations/20261001160000_bounty_location_privacy.sql).
--
-- Phase 1 moved exact data OUT of public.bounties, so these columns are now
-- always NULL (latitude, longitude, unit) or approximate (geom). This revoke is
-- defence in depth: if a future change ever writes exact values back, clients
-- still can't read them.
--
-- PRECONDITIONS (all required):
--   1. A native build whose bounty reads use explicit column lists (no
--      select('*'), no insert(...).select() / update(...).select() without a
--      list) is live, and PostHog shows >= 95% of active sessions on it.
--      Older builds WILL break: PostgREST answers select=* with
--      "permission denied for table bounties" once any column is revoked.
--   2. `node scripts/verify-location-privacy.js` passes on staging with this
--      file applied (it has a --with-revoke flag).
--   3. Explicit go from the owner.
--
-- Implementation: keep each role's existing table-level SELECT semantics but
-- expressed per column, minus the sensitive set. Generated from the live
-- column list so drift can't silently re-grant a column.

DO $$
DECLARE
  v_role text;
  v_cols text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT has_table_privilege(v_role, 'public.bounties', 'SELECT') THEN
      CONTINUE;
    END IF;

    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO v_cols
    FROM pg_attribute a
    WHERE a.attrelid = 'public.bounties'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attname NOT IN ('latitude', 'longitude', 'unit', 'geom', 'search_tsv');

    EXECUTE format('REVOKE SELECT ON public.bounties FROM %I', v_role);
    EXECUTE format('GRANT SELECT (%s) ON public.bounties TO %I', v_cols, v_role);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
