-- Rollback for 20261001140000_anti_scam_distribution_gate (PRODUCTION).
--
-- Function bodies below are production's live pg_get_functiondef() output,
-- captured 2026-10-01 before the migration was written. Before using this,
-- confirm prod has not changed those functions since (docs/security/
-- anti-scam-distribution-gate-2026-10-01.md, "Rollback").
--
-- Order: deploy the previous moderation-sweep first (it calls the report RPCs
-- this drops; it logs and continues if they are missing, so either order is
-- safe), then run this file as one transaction.
--
-- Loses: bounty_distribution_decisions rows, the delivery / capture
-- watermarks. Does NOT revert moderation state written while the migration
-- was live (under_review rows from reports, approvals): those are ordinary
-- moderation decisions; review them in the admin queue.

BEGIN;

-- Visibility hold
DROP POLICY IF EXISTS bounties_select_moderation_hold ON public.bounties;

-- Report-driven action and report_submitted feed
DROP TRIGGER IF EXISTS trg_reports_moderation_action ON public.reports;
DROP FUNCTION IF EXISTS public.trg_fn_reports_moderation_action();
DROP FUNCTION IF EXISTS public.moderation_report_events_pending(integer);
DROP FUNCTION IF EXISTS public.moderation_mark_report_events_captured(uuid[]);

-- Distribution gate: restore the pre-migration push functions first.
CREATE OR REPLACE FUNCTION public.fn_escalate_stale_bounty_liquidity()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_bounty     record;
  v_candidates uuid[];
  v_poster_id  uuid;
  v_dispatched int;
BEGIN
  FOR v_bounty IN
    SELECT b.id, b.title, b.category, b.amount, b.is_for_honor, b.geom, b.zip_code,
           b.work_type, b.liquidity_stage, b.created_at, b.liquidity_last_escalated_at,
           b.poster_id, b.user_id, b.quality_score, b.quality_nudge_stage,
           b.liquidity_location_nudged_at
    FROM public.bounties b
    WHERE b.status = 'open'
      AND b.liquidity_stage BETWEEN 1 AND 2
      AND NOT COALESCE(b.is_test, false)
      AND NOT EXISTS (SELECT 1 FROM public.bounty_requests br WHERE br.bounty_id = b.id)
      AND (
        (b.liquidity_stage = 1
           AND b.created_at < now() - interval '2 hours'
           AND (b.liquidity_last_escalated_at IS NULL OR b.liquidity_last_escalated_at < now() - interval '2 hours'))
        OR
        (b.liquidity_stage = 2
           AND b.liquidity_last_escalated_at IS NOT NULL
           AND b.liquidity_last_escalated_at < now() - interval '12 hours')
      )
  LOOP
    BEGIN
    v_poster_id := COALESCE(v_bounty.poster_id, v_bounty.user_id);
    v_candidates := NULL;
    v_dispatched := 0;

    -- An in-person bounty with no location has no candidate pool at any
    -- stage: nobody can be "nearby". Escalating it would be pure fiction, so
    -- instead: tell the poster once, record an admin anomaly, stamp the
    -- attempt so we re-check on the normal cadence (the poster may add a
    -- location, at which point the geom branches below take over), and leave
    -- liquidity_stage exactly where it is.
    IF v_bounty.work_type = 'in_person' AND v_bounty.geom IS NULL THEN
      IF v_bounty.liquidity_location_nudged_at IS NULL AND v_poster_id IS NOT NULL THEN
        INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
        VALUES (
          jsonb_build_array(v_poster_id),
          'Add a location so nearby hunters can be notified',
          '"' || v_bounty.title || '" is an in-person job but has no location, so we can''t tell hunters near you about it. Add one and we''ll start reaching out.',
          jsonb_build_object('type', 'bounty_location_nudge', 'bountyId', v_bounty.id, 'section', 'where'),
          v_bounty.id::text
        );
        UPDATE public.bounties
        SET liquidity_location_nudged_at = now()
        WHERE id = v_bounty.id;
      END IF;

      PERFORM public.record_reconciliation_finding(
        'bounty_liquidity_no_candidates',
        'warning',
        v_poster_id,
        jsonb_build_object(
          'bountyId',        v_bounty.id,
          'title',           v_bounty.title,
          'workType',        v_bounty.work_type,
          'liquidityStage',  v_bounty.liquidity_stage,
          'createdAt',       v_bounty.created_at,
          'note',            'in_person bounty has no geom, so no hunter can ever be matched. Liquidity escalation is parked at its current stage until the poster adds a location. Poster was nudged once.'
        )
      );

      UPDATE public.bounties
      SET liquidity_last_escalated_at = now()
      WHERE id = v_bounty.id;

      CONTINUE;
    END IF;

    IF v_bounty.work_type = 'online' THEN
      SELECT array_agg(p.id) INTO v_candidates
      FROM public.profiles p
      WHERE p.deleted_at IS NULL
        AND p.id IS DISTINCT FROM v_poster_id;

    ELSIF v_bounty.geom IS NOT NULL THEN
      IF v_bounty.liquidity_stage = 1 THEN
        SELECT array_agg(DISTINCT p.id) INTO v_candidates
        FROM public.profiles p
        JOIN public.hunter_service_areas hsa ON hsa.hunter_id = p.id
        WHERE p.deleted_at IS NULL
          AND hsa.hunter_id IS DISTINCT FROM v_poster_id
          AND hsa.latitude IS NOT NULL AND hsa.longitude IS NOT NULL
          AND (
            (hsa.radius_miles IS NOT NULL
               AND ST_DWithin(v_bounty.geom,
                               ST_SetSRID(ST_MakePoint(hsa.longitude, hsa.latitude), 4326)::geography,
                               hsa.radius_miles * 1609.344 * 2))
            OR (hsa.radius_miles IS NULL
                AND (v_bounty.amount >= 15 OR NOT v_bounty.is_for_honor)
                AND ST_DWithin(v_bounty.geom,
                                ST_SetSRID(ST_MakePoint(hsa.longitude, hsa.latitude), 4326)::geography,
                                40 * 1609.344))
          );
      ELSE
        SELECT array_agg(p.id) INTO v_candidates
        FROM public.profiles p
        WHERE p.deleted_at IS NULL
          AND p.id IS DISTINCT FROM v_poster_id
          AND p.geom IS NOT NULL
          AND ST_DWithin(v_bounty.geom, p.geom, 50 * 1609.344);
      END IF;
    END IF;

    v_dispatched := public.fn_score_and_dispatch_bounty_notification(
      v_bounty.id,
      v_candidates,
      (v_bounty.liquidity_stage + 1)::smallint,
      CASE WHEN v_bounty.liquidity_stage = 1 THEN 'Still looking for someone' ELSE 'This job still needs a hunter' END,
      '"' || v_bounty.title || '" hasn''t found a hunter yet — want to take a look?',
      jsonb_build_object('match', 'liquidity_escalation')
    );

    IF v_bounty.liquidity_stage = 1
       AND COALESCE(v_bounty.quality_score, 100) < 70
       AND COALESCE(v_bounty.quality_nudge_stage, 0) < 2
       AND v_poster_id IS NOT NULL
    THEN
      INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
      VALUES (
        jsonb_build_array(v_poster_id),
        'Your bounty hasn''t gotten much attention yet',
        'Adding a few more details may help the right hunter understand the job and decide it''s a fit.',
        jsonb_build_object('type', 'bounty_quality_nudge', 'bountyId', v_bounty.id, 'stage', 2, 'qualityScore', v_bounty.quality_score),
        v_bounty.id::text
      );
      UPDATE public.bounties SET quality_nudge_stage = 2 WHERE id = v_bounty.id;
    END IF;

    -- The stage is a claim about who has been reached. Only advance it when
    -- somebody actually was; otherwise just record the attempt so the next
    -- try waits the normal 2h / 12h rather than 20 minutes.
    IF v_dispatched > 0 THEN
      UPDATE public.bounties
      SET liquidity_stage = v_bounty.liquidity_stage + 1,
          liquidity_last_escalated_at = now()
      WHERE id = v_bounty.id;
    ELSE
      UPDATE public.bounties
      SET liquidity_last_escalated_at = now()
      WHERE id = v_bounty.id;
    END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_escalate_stale_bounty_liquidity: skipping bounty % after error: %', v_bounty.id, SQLERRM;
    END;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_notify_radius_matched_bounty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_poster_id  uuid;
  v_candidates uuid[];
  v_radius_m   constant double precision := 20 * 1609.344;
BEGIN
  -- Test bounties never page a real hunter, regardless of match quality.
  IF COALESCE(NEW.is_test, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.geom IS NULL THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  SELECT array_agg(p.id)
  INTO v_candidates
  FROM public.profiles p
  WHERE p.geom IS NOT NULL
    AND ST_DWithin(p.geom, NEW.geom, v_radius_m)
    AND p.id IS DISTINCT FROM v_poster_id
    AND p.deleted_at IS NULL
    AND NOT (
      NEW.zip_code IS NOT NULL
      AND btrim(NEW.zip_code) <> ''
      AND p.zip_code = NEW.zip_code
    );

  PERFORM public.fn_score_and_dispatch_bounty_notification(
    NEW.id,
    v_candidates,
    1::smallint,
    'New Bounty Near You',
    '"' || NEW.title || '" was just posted near you.',
    jsonb_build_object('match', 'radius', 'radius_miles', 20)
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_notify_service_area_matched_bounty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_poster_id  uuid;
  v_recipients jsonb;
BEGIN
  -- Test bounties never page a real hunter, regardless of match quality.
  IF COALESCE(NEW.is_test, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.geom IS NULL THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  SELECT jsonb_agg(DISTINCT hsa.hunter_id)
  INTO v_recipients
  FROM public.hunter_service_areas hsa
  JOIN public.profiles p ON p.id = hsa.hunter_id
  WHERE hsa.radius_miles IS NOT NULL
    AND hsa.latitude IS NOT NULL
    AND hsa.longitude IS NOT NULL
    AND ST_DWithin(
          NEW.geom,
          ST_SetSRID(ST_MakePoint(hsa.longitude, hsa.latitude), 4326)::geography,
          hsa.radius_miles * 1609.344
        )
    AND hsa.hunter_id IS DISTINCT FROM v_poster_id
    AND p.deleted_at IS NULL
    AND NOT (
      NEW.zip_code IS NOT NULL
      AND btrim(NEW.zip_code) <> ''
      AND p.zip_code = NEW.zip_code
    );

  IF v_recipients IS NULL OR jsonb_array_length(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  VALUES (
    v_recipients,
    'New Bounty Near You',
    '"' || NEW.title || '" was just posted near you.',
    jsonb_build_object('bountyId', NEW.id, 'type', 'bounty_nearby', 'match', 'service_area'),
    NEW.id::text
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_notify_zip_matched_bounty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_poster_id   uuid;
  v_recipients  jsonb;
BEGIN
  -- Test bounties never page a real hunter, regardless of match quality.
  IF COALESCE(NEW.is_test, false) THEN
    RETURN NEW;
  END IF;

  -- Nothing to match without a zip code on the bounty.
  IF NEW.zip_code IS NULL OR btrim(NEW.zip_code) = '' THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  SELECT jsonb_agg(id)
  INTO v_recipients
  FROM public.profiles
  WHERE zip_code = NEW.zip_code
    AND id IS DISTINCT FROM v_poster_id;

  -- No matching users (or only the poster themselves) — nothing to send.
  IF v_recipients IS NULL OR jsonb_array_length(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  VALUES (
    v_recipients,
    'New Bounty Near You',
    '"' || NEW.title || '" was just posted in your ZIP code (' || NEW.zip_code || ').',
    jsonb_build_object('bountyId', NEW.id, 'type', 'bounty_nearby', 'zip_code', NEW.zip_code),
    NEW.id::text
  );

  RETURN NEW;
END;
$function$;

DROP FUNCTION IF EXISTS public.fn_bounty_distribution_gate(uuid, text, smallint, boolean);
DROP FUNCTION IF EXISTS public.fn_bounty_credibility_signals(uuid);
DROP FUNCTION IF EXISTS public.fn_bounty_moderation_visible(uuid, uuid, uuid, uuid);
DROP TABLE IF EXISTS public.bounty_distribution_decisions;

-- Detection
CREATE OR REPLACE FUNCTION public.moderation_scan_content(p_title text, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_text text := lower(coalesce(p_title,'') || '  ' || coalesce(p_description,''));
  v_out  jsonb := '[]'::jsonb;
  r      record;
BEGIN
  -- NB: Postgres ARE uses \y for a word boundary, NOT \b (which is a literal
  -- backspace here). Every "whole word" anchor below is \y.
  FOR r IN
    SELECT * FROM (VALUES
      ('promotional_language', 'medium', 2.0,
        '(follow me|follow us|subscribe|like (and|&) share|\ypromo(tion|tional)?\y|shout[ -]?out|'
        || 'grow your (following|account|page|audience)|boost your (following|account|page|sales)|'
        || 'link in bio|linktr\.ee|linktree|smash that|go viral)'),
      ('external_link', 'medium', 2.0,
        '(https?://|www\.[a-z0-9-]+\.[a-z]{2,}|\yt\.me/|discord\.gg/|wa\.me/|bit\.ly/|'
        || 'instagram\.com/|tiktok\.com/|youtube\.com/|onlyfans\.com/|cash\.app/|venmo\.com/)'),
      ('contact_off_platform', 'high', 3.0,
        '(\ydm me\y|\ydm for\y|\ydm to\y|direct message me|message me on|text me at|whats[ ]?app|'
        || '\ytelegram\y|\yhit me up\y|my (insta|ig|snap|number)\y|add me on|reach me on)'),
      ('affiliate_referral', 'high', 3.0,
        '(referral (code|link)|affiliate (link|program|code|marketing)|use my code|use code |'
        || 'promo code|discount code|sign up (with|using) my|my referral|commission per (sign|sale))'),
      ('crypto_promotion', 'high', 3.0,
        '(\ycrypto(currency)?\y|\ybitcoin\y|\ybtc\y|\yeth\y|\ynft\y|air[ -]?drop|\yweb3\y|\yforex\y|\ybinance\y|'
        || '\ycoinbase\y|\yusdt\y|\ymemecoin\y|pump and dump|to the moon|trading signals)'),
      -- New: no detector previously fired on a bare email address anywhere
      -- in the title/description. Catches both live andrepace057 posts.
      ('email_address', 'high', 3.0,
        '([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})'),
      -- New: a bare "www.x.tld", any "word.tld" mention (no protocol
      -- required -- external_link above only fires on a named platform
      -- domain + trailing slash, or a protocol), or an "@handle" mention.
      ('bare_url_or_handle', 'medium', 2.0,
        '(\ywww\.[a-z0-9-]+\.[a-z]{2,}\S*)|'
        || '(\y[a-z0-9-]{2,}\.(com|net|org|io|co|me|app|gg|shop|store|xyz)(/\S*)?\y)|'
        || '(\y@[a-z][a-z0-9_.]{2,}\y)')
    ) AS t(signal_type, severity, weight, pattern)
  LOOP
    IF v_text ~* r.pattern THEN
      v_out := v_out || jsonb_build_object(
        'type', r.signal_type, 'severity', r.severity, 'weight', r.weight,
        'evidence', jsonb_build_object('match', substring(v_text from r.pattern)));
    END IF;
  END LOOP;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.moderation_transition_allowed(p_from text, p_to text, p_actor text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN false
    WHEN p_actor = 'system' THEN (p_from IN ('active','approved') AND p_to = 'flagged')
    WHEN p_from = p_to THEN false
    WHEN p_from = 'active'       THEN p_to IN ('flagged','under_review','hidden','removed','approved')
    WHEN p_from = 'flagged'      THEN p_to IN ('under_review','approved','hidden','removed','active')
    WHEN p_from = 'under_review' THEN p_to IN ('approved','hidden','removed','flagged')
    WHEN p_from = 'hidden'       THEN p_to IN ('removed','approved','under_review')
    WHEN p_from = 'removed'      THEN p_to IN ('approved')
    WHEN p_from = 'approved'     THEN p_to IN ('flagged','under_review','hidden','removed')
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.moderation_apply_signals(p_bounty_id uuid, p_signals jsonb, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source    text := coalesce(p_source, 'content');
  v_sig       jsonb;
  v_types     text[] := ARRAY(
                 SELECT jsonb_array_elements(coalesce(p_signals, '[]'::jsonb)) ->> 'type');
  v_score     numeric;
  v_state     text;
  v_threshold numeric;
  v_reason    text;
  v_poster    uuid;
BEGIN
  IF p_bounty_id IS NULL OR p_signals IS NULL THEN
    RETURN;
  END IF;

  -- Drop signals of this source that the fresh scan no longer reports (e.g. the
  -- poster edited the spam out), then upsert the current set.
  DELETE FROM public.moderation_signals
  WHERE bounty_id = p_bounty_id
    AND source = v_source
    AND (v_types IS NULL OR NOT (signal_type = ANY (v_types)));

  FOR v_sig IN SELECT * FROM jsonb_array_elements(p_signals)
  LOOP
    INSERT INTO public.moderation_signals
      (bounty_id, signal_type, severity, weight, source, evidence, detected_at)
    VALUES (
      p_bounty_id,
      v_sig ->> 'type',
      coalesce(v_sig ->> 'severity', 'low'),
      coalesce((v_sig ->> 'weight')::numeric, 1),
      v_source,
      coalesce(v_sig -> 'evidence', '{}'::jsonb),
      now()
    )
    ON CONFLICT (bounty_id, signal_type) DO UPDATE SET
      severity    = EXCLUDED.severity,
      weight      = EXCLUDED.weight,
      source      = EXCLUDED.source,
      evidence    = EXCLUDED.evidence,
      detected_at = now();
  END LOOP;

  SELECT coalesce(sum(weight), 0) INTO v_score
  FROM public.moderation_signals WHERE bounty_id = p_bounty_id;

  -- A single low-weight signal (e.g. a terse description) is recorded but is
  -- not on its own queue-worthy: only surface a listing once its signals
  -- corroborate (score >= 2) or an admin has already acted on it.
  IF v_score < 2 AND NOT EXISTS (
    SELECT 1 FROM public.bounty_moderation WHERE bounty_id = p_bounty_id
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.bounty_moderation (bounty_id, state, signal_score)
  VALUES (p_bounty_id, 'active', v_score)
  ON CONFLICT (bounty_id) DO UPDATE SET signal_score = v_score, updated_at = now();

  SELECT state INTO v_state FROM public.bounty_moderation WHERE bounty_id = p_bounty_id;

  SELECT threshold_value INTO v_threshold
  FROM public.moderation_alert_thresholds WHERE key = 'signal_score' AND enabled;

  -- Auto-flag: active/approved -> flagged only. Never hide, never remove,
  -- never touch the poster's account.
  IF v_threshold IS NOT NULL AND v_score >= v_threshold
     AND public.moderation_transition_allowed(v_state, 'flagged', 'system') THEN

    SELECT string_agg(signal_type, ', ' ORDER BY weight DESC, signal_type)
      INTO v_reason
    FROM public.moderation_signals WHERE bounty_id = p_bounty_id;

    UPDATE public.bounty_moderation SET
      state          = 'flagged',
      auto_flagged   = true,
      flagged_at     = now(),
      flagged_reason = left('Auto-flagged: ' || coalesce(v_reason, 'signals'), 500),
      updated_at     = now()
    WHERE bounty_id = p_bounty_id;

    INSERT INTO public.bounty_moderation_events
      (bounty_id, from_state, to_state, actor, reason, metadata)
    VALUES (
      p_bounty_id, v_state, 'flagged', 'system',
      'signal_score ' || round(v_score, 1) || ' >= ' || v_threshold,
      jsonb_build_object('signal_score', v_score, 'signals', v_reason));

    SELECT coalesce(poster_id, user_id) INTO v_poster
    FROM public.bounties WHERE id = p_bounty_id;

    INSERT INTO public.moderation_alerts
      (alert_key, threshold_key, bounty_id, poster_id, severity, summary, detail)
    VALUES (
      'signal_score:' || p_bounty_id::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD'),
      'signal_score', p_bounty_id, v_poster, 'high',
      'Listing auto-flagged: content signals scored ' || round(v_score, 1)
        || ' (' || coalesce(v_reason, '') || ').',
      jsonb_build_object('signal_score', v_score, 'threshold', v_threshold, 'signals', v_reason))
    ON CONFLICT (alert_key) DO NOTHING;
  END IF;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'moderation_apply_signals suppressed error for %: %', p_bounty_id, SQLERRM;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_moderation_scan_bounty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_signals jsonb;
BEGIN
  v_signals := public.moderation_scan_content(NEW.title, NEW.description);

  -- "for-honor" listing whose title still carries a price with the digits
  -- immediately before the $ ("45$", "51$", "60$") -- the exact shape of
  -- every confirmed off-escrow-payment listing to date. Deliberately NOT
  -- the standard "$45" order: a legitimate for-honor post ("What Would You
  -- Buy for $1?") uses that order and must not be flagged.
  IF COALESCE(NEW.is_for_honor, false) AND lower(NEW.title) ~ '\y[0-9]+\$' THEN
    v_signals := v_signals || jsonb_build_object(
      'type', 'honor_listing_with_price', 'severity', 'high', 'weight', 3.0,
      'evidence', jsonb_build_object('title', NEW.title));
  END IF;

  PERFORM public.moderation_apply_signals(NEW.id, v_signals, 'content');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'moderation: scan trigger suppressed error for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS moderation_scan_bounty ON public.bounties;
CREATE TRIGGER moderation_scan_bounty
  AFTER INSERT OR UPDATE OF title, description, is_for_honor ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.trg_moderation_scan_bounty();

CREATE OR REPLACE FUNCTION public.run_moderation_sweep()
 RETURNS SETOF moderation_alerts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run       timestamptz := now();
  v_b         record;
  v_signals   jsonb;
  v_velocity  integer;
  v_dupe      integer;
  v_rep       integer;
  v_new_acct_posts integer;
  v_vt        numeric;  v_vw integer;
  v_nt        numeric;
  v_rt        numeric;
  v_ft        numeric;
  v_fc        integer;
  v_scanned   integer := 0;
  v_written   integer := 0;
  v_alerts    integer := 0;
  -- Snapshot of existing alert ids so "created this run" is derived from what
  -- actually got inserted, not from a now() comparison (now() is frozen for
  -- the whole transaction, so a same-txn re-run would otherwise re-return
  -- earlier alerts).
  v_pre       uuid[];
BEGIN
  BEGIN
    SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_pre FROM public.moderation_alerts;

    SELECT threshold_value, window_minutes INTO v_vt, v_vw
      FROM public.moderation_alert_thresholds WHERE key = 'application_velocity' AND enabled;
    SELECT threshold_value INTO v_nt
      FROM public.moderation_alert_thresholds WHERE key = 'new_account_value' AND enabled;
    SELECT threshold_value INTO v_rt
      FROM public.moderation_alert_thresholds WHERE key = 'repeated_listing' AND enabled;

    FOR v_b IN
      SELECT b.id,
             COALESCE(b.poster_id, b.user_id) AS poster_id,
             b.amount, b.is_for_honor, b.created_at, b.title, b.description,
             p.created_at AS poster_created_at
      FROM public.bounties b
      JOIN public.profiles p ON p.id = COALESCE(b.poster_id, b.user_id)
      -- Was 'open' only; the two known-live spam rows are 'in_progress' (a
      -- hunter already accepted them) and would never be swept again.
      WHERE b.status::text IN ('open', 'in_progress', 'cancellation_requested')
        AND b.created_at >= v_run - interval '7 days'
    LOOP
      v_signals := '[]'::jsonb;

      -- application velocity: peak count in any fixed 30-minute bucket over 24h
      SELECT COALESCE(max(c), 0) INTO v_velocity FROM (
        SELECT count(*) AS c
        FROM public.bounty_requests r
        WHERE r.bounty_id = v_b.id
          AND r.created_at >= v_run - interval '24 hours'
        GROUP BY date_bin('30 minutes', r.created_at, TIMESTAMPTZ '2000-01-01')
      ) q;

      IF v_vt IS NOT NULL AND v_velocity >= v_vt THEN
        v_signals := v_signals || jsonb_build_object(
          'type', 'application_velocity', 'severity', 'high', 'weight', 3,
          'evidence', jsonb_build_object('peak_per_30min', v_velocity, 'threshold', v_vt));
      END IF;

      -- high-value listing from an account < 24h old
      IF v_nt IS NOT NULL AND NOT COALESCE(v_b.is_for_honor, false)
         AND COALESCE(v_b.amount, 0) >= v_nt
         AND v_b.created_at < v_b.poster_created_at + interval '24 hours' THEN
        v_signals := v_signals || jsonb_build_object(
          'type', 'new_account_high_value', 'severity', 'medium', 'weight', 2,
          'evidence', jsonb_build_object('amount', v_b.amount,
            'account_age_hours', round(extract(epoch FROM v_b.created_at - v_b.poster_created_at) / 3600.0, 1)));
      END IF;

      -- new account (< 24h old) that has already posted more than once
      IF v_b.poster_created_at >= v_run - interval '24 hours' THEN
        SELECT count(*) INTO v_new_acct_posts
        FROM public.bounties d
        WHERE COALESCE(d.poster_id, d.user_id) = v_b.poster_id;

        IF v_new_acct_posts > 1 THEN
          v_signals := v_signals || jsonb_build_object(
            'type', 'new_account_multi_post', 'severity', 'medium', 'weight', 2,
            'evidence', jsonb_build_object('post_count', v_new_acct_posts,
              'account_age_hours', round(extract(epoch FROM v_run - v_b.poster_created_at) / 3600.0, 1)));
        END IF;
      END IF;

      -- duplicate description shared by >= 2 other listings (any poster)
      IF length(btrim(coalesce(v_b.description, ''))) >= 20 THEN
        SELECT count(*) INTO v_dupe
        FROM public.bounties d
        WHERE d.id <> v_b.id
          AND lower(btrim(d.description)) = lower(btrim(v_b.description));
        IF v_dupe >= 2 THEN
          v_signals := v_signals || jsonb_build_object(
            'type', 'duplicate_description', 'severity', 'medium', 'weight', 2,
            'evidence', jsonb_build_object('copies', v_dupe));
        END IF;
      END IF;

      -- repeated near-identical listing from the same poster in 7 days
      IF v_rt IS NOT NULL THEN
        SELECT count(*) INTO v_rep
        FROM public.bounties d
        WHERE COALESCE(d.poster_id, d.user_id) = v_b.poster_id
          AND d.created_at >= v_run - interval '7 days'
          AND (lower(btrim(d.title)) = lower(btrim(v_b.title))
               OR (length(btrim(coalesce(d.description, ''))) >= 20
                   AND lower(btrim(d.description)) = lower(btrim(v_b.description))));
        IF v_rep >= v_rt THEN
          v_signals := v_signals || jsonb_build_object(
            'type', 'repeated_listing', 'severity', 'medium', 'weight', 2,
            'evidence', jsonb_build_object('count', v_rep, 'window_days', 7));
        END IF;
      END IF;

      -- content signals (email/url/handle/promo/etc.) -- a retroactive net
      -- for listings whose title/description hasn't changed since the
      -- insert-time trigger ran (or that predate a rule).
      v_signals := v_signals || public.moderation_scan_content(v_b.title, v_b.description);

      -- for-honor listing pricing itself "NN$" instead of "$NN" -- see
      -- trg_moderation_scan_bounty for why this exact shape.
      IF COALESCE(v_b.is_for_honor, false) AND lower(v_b.title) ~ '\y[0-9]+\$' THEN
        v_signals := v_signals || jsonb_build_object(
          'type', 'honor_listing_with_price', 'severity', 'high', 'weight', 3.0,
          'evidence', jsonb_build_object('title', v_b.title));
      END IF;

      IF jsonb_array_length(v_signals) > 0 THEN
        v_scanned := v_scanned + 1;
        v_written := v_written + jsonb_array_length(v_signals);
        PERFORM public.moderation_apply_signals(v_b.id, v_signals, 'sweep');
      END IF;

      -- Velocity alert -- independent of the auto-flag score, deduped per hour.
      IF v_vt IS NOT NULL AND v_velocity >= v_vt THEN
        INSERT INTO public.moderation_alerts
          (alert_key, threshold_key, bounty_id, poster_id, severity, summary, detail)
        VALUES (
          'application_velocity:' || v_b.id::text || ':'
            || to_char(date_trunc('hour', v_run AT TIME ZONE 'UTC'), 'YYYYMMDD"T"HH24'),
          'application_velocity', v_b.id, v_b.poster_id, 'high',
          'Suspicious bounty received ' || v_velocity || ' applications within 30 minutes.',
          jsonb_build_object('peak_per_30min', v_velocity, 'threshold', v_vt))
        ON CONFLICT (alert_key) DO NOTHING;
        IF FOUND THEN v_alerts := v_alerts + 1; END IF;
      END IF;
    END LOOP;

    -- Platform-wide flag-rate spike.
    SELECT threshold_value INTO v_ft
      FROM public.moderation_alert_thresholds WHERE key = 'flag_rate_spike' AND enabled;
    IF v_ft IS NOT NULL THEN
      SELECT count(*) INTO v_fc
      FROM public.bounty_moderation_events
      WHERE to_state = 'flagged' AND created_at >= v_run - interval '60 minutes';
      IF v_fc >= v_ft THEN
        INSERT INTO public.moderation_alerts
          (alert_key, threshold_key, bounty_id, poster_id, severity, summary, detail)
        VALUES (
          'flag_rate_spike:' || to_char(date_trunc('hour', v_run AT TIME ZONE 'UTC'), 'YYYYMMDD"T"HH24'),
          'flag_rate_spike', NULL, NULL, 'critical',
          v_fc || ' listings were flagged in the last hour -- possible coordinated spam.',
          jsonb_build_object('flags_last_hour', v_fc, 'threshold', v_ft))
        ON CONFLICT (alert_key) DO NOTHING;
        IF FOUND THEN v_alerts := v_alerts + 1; END IF;
      END IF;
    END IF;

    -- Everything inserted during this run: velocity + flag-rate-spike alerts
    -- here, plus any auto-flag (signal_score) alerts raised inside
    -- moderation_apply_signals while sweeping.
    SELECT count(*) INTO v_alerts
    FROM public.moderation_alerts WHERE id <> ALL (v_pre);

    INSERT INTO public.moderation_sweep_runs
      (run_at, bounties_scanned, signals_written, alerts_created, succeeded, error)
    VALUES (v_run, v_scanned, v_written, v_alerts, true, NULL);

  EXCEPTION WHEN OTHERS THEN
    -- Same posture as the scan trigger and moderation_apply_signals: a
    -- moderation failure must never be silent, but also must never be fatal
    -- to the caller. Record what happened (this is the whole fix for "we
    -- can't tell if the sweep is running or silently failing") and return
    -- no alerts for this run instead of propagating -- re-raising here would
    -- roll back this INSERT too, recreating the exact silence being fixed.
    RAISE WARNING 'run_moderation_sweep failed: %', SQLERRM;
    INSERT INTO public.moderation_sweep_runs
      (run_at, bounties_scanned, signals_written, alerts_created, succeeded, error)
    VALUES (v_run, v_scanned, v_written, 0, false, left(SQLERRM, 500));
    RETURN;
  END;

  RETURN QUERY
  SELECT * FROM public.moderation_alerts
  WHERE id <> ALL (v_pre)
  ORDER BY created_at, id;
END;
$function$;

DROP FUNCTION IF EXISTS public.moderation_scan_attachments(text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.moderation_attachment_count(jsonb);

-- Watermarks
DROP INDEX IF EXISTS public.moderation_alerts_undelivered_idx;
ALTER TABLE public.moderation_alerts DROP COLUMN IF EXISTS fanned_out_at;
DROP INDEX IF EXISTS public.reports_analytics_uncaptured_idx;
DROP INDEX IF EXISTS public.reports_pending_content_idx;
ALTER TABLE public.reports DROP COLUMN IF EXISTS analytics_captured_at;

COMMIT;
