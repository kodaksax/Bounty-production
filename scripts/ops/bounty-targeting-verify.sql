-- Local development database only, AFTER the migration is applied by its owner.
-- Run with psql -v ON_ERROR_STOP=1 -f scripts/ops/bounty-targeting-verify.sql.
-- No migration application, cron invocation or provider sends. Always rolls back.
BEGIN;
SET LOCAL search_path = public, extensions;
ALTER TABLE public.notifications_outbox DISABLE TRIGGER USER;
SET LOCAL request.jwt.claim.role = 'service_role';

-- Seed isolated profiles using the same auth/profile fixture shape as the
-- existing verify-anti-scam-gate runner. All fixture writes are rolled back.
DO $$
DECLARE
  v_poster uuid := gen_random_uuid();
  v_zip uuid := gen_random_uuid();
  v_radius uuid := gen_random_uuid();
  v_service uuid := gen_random_uuid();
  v_bounty uuid;
  v_next uuid;
  v_id uuid;
  v_before integer;
  i integer;
BEGIN
  FOREACH v_id IN ARRAY ARRAY[v_poster, v_zip, v_radius, v_service] LOOP
    INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
      VALUES (v_id, 'authenticated', 'authenticated', v_id::text || '@example.test', now(), now());
    INSERT INTO public.profiles (id, username, account_status, created_at)
      VALUES (v_id, 'hq_' || replace(v_id::text, '-', ''), 'active', now() - interval '30 days')
      ON CONFLICT (id) DO UPDATE SET account_status = 'active';
  END LOOP;
  UPDATE public.profiles SET zip_code = '99998',
    geom = ST_SetSRID(ST_MakePoint(-170, -80), 4326)::geography WHERE id = v_zip;
  UPDATE public.profiles SET geom = ST_SetSRID(ST_MakePoint(-170, -80), 4326)::geography WHERE id = v_radius;
  INSERT INTO public.hunter_service_areas (hunter_id, latitude, longitude, radius_miles)
    VALUES (v_service, -80, -170, 20);
  UPDATE public.bounty_targeting_config SET consolidated_enabled = true WHERE singleton;
  INSERT INTO public.bounties
    (title, description, amount, is_for_honor, poster_id, user_id, status, work_type, funding_mode, is_test)
  VALUES ('Carry boxes', 'Carry two boxes from the vehicle to the house, a simple local job.',
    40, false, v_poster, v_poster, 'open', 'in_person', 'at_accept', false) RETURNING id INTO v_bounty;
  IF EXISTS (SELECT 1 FROM public.bounty_targeting_dispatches WHERE bounty_id = v_bounty) THEN
    RAISE EXCEPTION 'Posting without geography must not consume the location-added dispatch';
  END IF;
  UPDATE public.bounties SET zip_code = '99998', latitude = -80, longitude = -170 WHERE id = v_bounty;
  IF (SELECT count(*) FROM public.bounty_hunter_notifications
    WHERE bounty_id = v_bounty AND hunter_id = ANY(ARRAY[v_zip, v_radius, v_service])) <> 3
    OR (SELECT count(*) FROM public.bounty_targeting_dispatches WHERE bounty_id = v_bounty) <> 1
  THEN RAISE EXCEPTION 'Location-added consolidated dispatch must union all three sources once'; END IF;
  IF NOT (SELECT reasons->'match_sources' @> '["zip","radius"]'::jsonb
      FROM public.bounty_hunter_notifications WHERE bounty_id = v_bounty AND hunter_id = v_zip)
    OR EXISTS (SELECT 1 FROM public.bounty_hunter_notifications
      WHERE bounty_id = v_bounty AND provider_accepted_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Provenance must preserve overlapping matches without inventing delivery'; END IF;
  SELECT count(*) INTO v_before FROM public.notifications_outbox WHERE bounty_id = v_bounty::text;
  UPDATE public.bounty_targeting_config SET consolidated_enabled = false WHERE singleton;
  PERFORM public.fn_dispatch_bounty_targeting(v_bounty, 'zip');
  PERFORM public.fn_dispatch_bounty_targeting(v_bounty, 'radius');
  PERFORM public.fn_dispatch_bounty_targeting(v_bounty, 'service_area');
  UPDATE public.bounties SET latitude = -80.01, longitude = -170.01 WHERE id = v_bounty;
  IF (SELECT count(*) FROM public.notifications_outbox WHERE bounty_id = v_bounty::text) <> v_before THEN
    RAISE EXCEPTION 'Mode changes/repeated location edits must not create another wave';
  END IF;
  FOR i IN 1..5 LOOP
    INSERT INTO public.bounties
      (title, description, amount, is_for_honor, poster_id, user_id, status,
       work_type, funding_mode, is_test, zip_code)
    VALUES ('Carry boxes', 'Carry two boxes from the vehicle to the house, a simple local job.',
      40, false, v_poster, v_poster, 'open', 'in_person', 'at_accept', false, '99998')
    RETURNING id INTO v_next;
  END LOOP;
  IF (SELECT count(*) FROM public.bounty_hunter_notifications WHERE hunter_id = v_zip) <> 5 THEN
    RAISE EXCEPTION 'Rolling hourly cap must reserve at most five bounty notifications';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bounty_targeting_dispatches
      WHERE bounty_id = v_next AND mode = 'legacy') THEN
    RAISE EXCEPTION 'New bounties must respect default-off/legacy configuration';
  END IF;
  INSERT INTO public.bounties
    (title, description, amount, is_for_honor, poster_id, user_id, status,
     work_type, funding_mode, is_test, zip_code)
  VALUES ('Carry boxes', 'Carry two boxes from the vehicle to the house, a simple local job.',
    40, false, v_poster, v_poster, 'open', 'in_person', 'at_accept', true, '99998')
  RETURNING id INTO v_next;
  IF EXISTS (SELECT 1 FROM public.bounty_hunter_notifications WHERE bounty_id = v_next) THEN
    RAISE EXCEPTION 'Test bounties must never reserve recipients';
  END IF;
  RAISE NOTICE 'PASS: geographic union, location-added triggers, mode freeze, provenance, test guard, hourly cap';
END;
$$;

DO $$
DECLARE
  v_hunter uuid;
  v_outbox uuid := gen_random_uuid();
  v_claim uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_function text;
  v_attempts integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bounty_targeting_config WHERE singleton) THEN
    RAISE EXCEPTION 'Missing server targeting configuration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE oid IN (
      'public.bounty_targeting_config'::regclass,
      'public.bounty_targeting_dispatches'::regclass,
      'public.bounty_targeting_deliveries'::regclass
    ) AND NOT relrowsecurity
  ) THEN RAISE EXCEPTION 'Internal targeting tables require RLS'; END IF;
  IF has_table_privilege('authenticated', 'public.bounty_targeting_config', 'UPDATE')
    OR has_table_privilege('anon', 'public.bounty_targeting_deliveries', 'SELECT')
    OR has_function_privilege('authenticated',
      'public.fn_claim_bounty_targeting_delivery(uuid,uuid,text,uuid)', 'EXECUTE')
    OR has_function_privilege('anon',
      'public.fn_dispatch_bounty_targeting(uuid,text)', 'EXECUTE')
  THEN RAISE EXCEPTION 'Targeting control/claims must be service-only'; END IF;

  SELECT pg_get_functiondef('public.fn_dispatch_bounty_targeting(uuid,text)'::regprocedure)
    INTO v_function;
  IF v_function NOT LIKE '%UNION ALL%' OR v_function NOT LIKE '%LIMIT 1000%'
    OR v_function ~* '(FROM|JOIN)[[:space:]]+(public[.])?bounty_private_locations([[:space:]]|$)'
    OR v_function NOT LIKE '%fn_bounty_distribution_gate%'
    OR v_function NOT LIKE '%b.is_test%'
  THEN RAISE EXCEPTION 'Geographic union/gate/privacy/bounds regression'; END IF;
  SELECT pg_get_functiondef(
    'public.fn_score_and_dispatch_bounty_notification(uuid,uuid[],smallint,text,text,jsonb)'::regprocedure)
    INTO v_function;
  IF v_function NOT LIKE '%pg_advisory_xact_lock%'
    OR v_function NOT LIKE '%interval ''1 hour''%'
    OR v_function NOT LIKE '%p.account_status = ''active''%'
    OR v_function NOT LIKE '%p.deleted_at IS NULL%'
    OR v_function NOT LIKE '%ON CONFLICT (bounty_id, hunter_id) DO NOTHING%'
    OR v_function NOT LIKE '%match_sources%'
  THEN RAISE EXCEPTION 'Scoring/dedup/hourly-cap/provenance regression'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.bounties'::regclass
        AND tgname = 'trg_bounties_notify_radius_on_location_added' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.bounties'::regclass
        AND tgname = 'trg_bounties_notify_zip_on_location_added' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.bounties'::regclass
        AND tgname = 'trg_bounties_notify_service_area_on_location_added' AND NOT tgisinternal)
  THEN RAISE EXCEPTION 'Existing location-added notification triggers must survive'; END IF;

  SELECT id INTO v_hunter FROM public.profiles ORDER BY id LIMIT 1;
  IF v_hunter IS NULL THEN RAISE EXCEPTION 'Seed at least one local profile before running integration tests'; END IF;
  INSERT INTO public.notifications_outbox (id, recipients, data)
  VALUES (v_outbox, jsonb_build_array(v_hunter),
    '{"type":"bounty_nearby","targeting_version":1}'::jsonb);
  INSERT INTO public.bounty_targeting_deliveries (outbox_id, hunter_id, channel)
    VALUES (v_outbox, v_hunter, 'push');
  IF NOT public.fn_claim_bounty_targeting_delivery(v_outbox, v_hunter, 'push', v_claim)
    OR public.fn_claim_bounty_targeting_delivery(v_outbox, v_hunter, 'push', v_other)
  THEN RAISE EXCEPTION 'Only one worker may hold a channel claim'; END IF;
  IF public.fn_ack_bounty_targeting_delivery(v_outbox, v_hunter, 'push', v_other, 'accepted')
  THEN RAISE EXCEPTION 'Acknowledgement requires the owning claim'; END IF;
  IF NOT public.fn_ack_bounty_targeting_delivery(v_outbox, v_hunter, 'push', v_claim, 'failed')
    OR NOT public.fn_claim_bounty_targeting_delivery(v_outbox, v_hunter, 'push', v_other)
    OR NOT public.fn_ack_bounty_targeting_delivery(v_outbox, v_hunter, 'push', v_other, 'accepted')
    OR public.fn_claim_bounty_targeting_delivery(v_outbox, v_hunter, 'push', v_claim)
  THEN RAISE EXCEPTION 'Only known failures may retry; accepted recipients never resend'; END IF;

  UPDATE public.bounty_targeting_deliveries
    SET state = 'processing', claim_id = v_claim, attempted_at = now() - interval '6 minutes'
    WHERE outbox_id = v_outbox;
  PERFORM public.fn_finish_bounty_targeting_outbox(v_outbox);
  IF (SELECT state FROM public.bounty_targeting_deliveries WHERE outbox_id = v_outbox) <> 'unknown'
    OR public.fn_claim_bounty_targeting_delivery(v_outbox, v_hunter, 'push', v_other)
  THEN RAISE EXCEPTION 'Interrupted/unknown outcomes must never be automatically resent'; END IF;
  SELECT attempts INTO v_attempts FROM public.notifications_outbox WHERE id = v_outbox;
  IF NOT public.fn_finish_bounty_targeting_outbox(v_outbox)
    OR (SELECT attempts FROM public.notifications_outbox WHERE id = v_outbox) <> v_attempts
  THEN RAISE EXCEPTION 'Late concurrent finalizers must not increment a terminal outbox attempt count'; END IF;
  RAISE NOTICE 'PASS: targeting RLS, geography guards, claim ownership, retry and unknown outcomes';
END;
$$;
ROLLBACK;
