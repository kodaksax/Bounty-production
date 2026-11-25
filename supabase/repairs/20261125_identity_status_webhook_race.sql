-- One-off data repair, NOT a migration (supabase/migrations is not touched).
-- Run by hand in the SQL editor AFTER the identity-webhooks
-- guard (fix/identity-webhook-no-downgrade) is deployed, or a new race can
-- recreate the problem.
--
-- What happened: Stripe delivered identity.verification_session.processing
-- and .verified for the same session in the same second; the processing
-- handler wrote last. 12 production profiles (as of 2026-11-25) were left at
-- stripe_identity_status = 'processing' although Stripe verified them. Every
-- other user reads only stripe_identity_status (public_profiles), so they see
-- these people as not verified.
--
-- A row is repaired only when all of this holds, re-checked here rather than
-- trusted from the 11-25 count:
--   - id_verification_status = 'verified' (written only by the verified
--     handler, or by an admin approval, and none of these were admin-reviewed);
--   - stripe_identity_status = 'processing';
--   - the ledger (stripe_events) has a .verified event for THIS profile's own
--     session, with metadata.user_id matching;
--   - no .requires_input or .canceled event for that session after it.
--
-- Only stripe_identity_status changes. verified_since, age_verified and the
-- legacy columns were already written by the verified handler.
-- stripe_identity_last_event_at is left as is (it is the last event received).

-- 1. Preview: expect 12 rows, all repairable = true.
WITH candidates AS (
  SELECT p.id, p.stripe_identity_session_id AS sid, p.verified_since, p.id_reviewer_id
  FROM public.profiles p
  WHERE p.id_verification_status = 'verified'
    AND p.stripe_identity_status = 'processing'
)
SELECT
  c.id,
  c.verified_since,
  c.id_reviewer_id IS NULL AS not_admin_reviewed,
  EXISTS (
    SELECT 1 FROM public.stripe_events e
    WHERE e.event_type = 'identity.verification_session.verified'
      AND e.event_data->>'id' = c.sid
      AND e.event_data->'metadata'->>'user_id' = c.id::text
  ) AS has_verified_event,
  NOT EXISTS (
    SELECT 1 FROM public.stripe_events n
    WHERE n.event_type IN ('identity.verification_session.requires_input', 'identity.verification_session.canceled')
      AND n.event_data->>'id' = c.sid
      AND n.created_at > (
        SELECT max(v.created_at) FROM public.stripe_events v
        WHERE v.event_type = 'identity.verification_session.verified' AND v.event_data->>'id' = c.sid
      )
  ) AS no_later_negative_event
FROM candidates c
ORDER BY c.verified_since;

-- 2. Repair. One statement: if the count isn't the expected one, it raises
--    and nothing is written. Change EXPECTED only after reading step 1.
DO $$
DECLARE
  expected CONSTANT integer := 12;
  n integer;
BEGIN
  -- prevent_client_writes_to_protected_profile_columns blocks every write to
  -- stripe_identity_status outside service_role, postgres included. Its
  -- sanctioned trusted-write path is this transaction-local GUC (see
  -- 20260719120000_fix_profile_guard_blocks_trusted_writes.sql), on only
  -- around this one UPDATE.
  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE public.profiles p
  SET stripe_identity_status = 'verified'
  WHERE p.id_verification_status = 'verified'
    AND p.stripe_identity_status = 'processing'
    AND p.id_reviewer_id IS NULL
    AND p.stripe_identity_session_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.stripe_events e
      WHERE e.event_type = 'identity.verification_session.verified'
        AND e.event_data->>'id' = p.stripe_identity_session_id
        AND e.event_data->'metadata'->>'user_id' = p.id::text
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.stripe_events n
      WHERE n.event_type IN ('identity.verification_session.requires_input', 'identity.verification_session.canceled')
        AND n.event_data->>'id' = p.stripe_identity_session_id
        AND n.created_at > (
          SELECT max(v.created_at) FROM public.stripe_events v
          WHERE v.event_type = 'identity.verification_session.verified'
            AND v.event_data->>'id' = p.stripe_identity_session_id
        )
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.bypass_profile_guard', 'off', true);
  IF n <> expected THEN
    RAISE EXCEPTION 'identity repair: % rows matched, expected %; nothing written', n, expected;
  END IF;
  RAISE NOTICE 'identity repair: % profiles set back to verified', n;
END $$;

-- 3. Check: expect 0.
SELECT count(*) AS still_mismatched
FROM public.profiles
WHERE id_verification_status = 'verified' AND stripe_identity_status <> 'verified';
