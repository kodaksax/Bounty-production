-- Migration: Bounty moderation queue -- detection, review workflow, founder alerts
-- Created: 2026-08-29
--
-- BACKGROUND: promotional / spam listings (Instagram-promo posts, "DM me",
-- crypto shills, affiliate funnels) are accumulating real hunter applications
-- and contaminating marketplace liquidity. Today nothing surfaces a bad
-- listing unless a user reports it (app/(admin)/reports.tsx only reads the
-- `reports` table), there is no persisted moderation state, and there is no
-- founder alerting backend at all.
--
-- This adds a real pipeline: detect -> FLAG -> human review -> APPROVE / HIDE /
-- REMOVE, configurable founder alerts, and outcome metrics that let analytics
-- tell legitimate demand from suspicious demand.
--
-- SAFETY INVARIANTS (enforced below, covered by scripts/verify-moderation-migration.js):
--   * Automation NEVER bans a user, NEVER hides or removes a listing, and NEVER
--     moves a listing past `flagged`. Only an admin RPC can reach
--     under_review / approved / hidden / removed.
--   * HIDE / REMOVE take the listing out of the marketplace by driving
--     `bounties.status` ('archived' / 'deleted') -- the exclusion every feed
--     query already honours. The core `bounties` SELECT RLS policy is NOT
--     touched.
--   * Every new table is admin-SELECT-only under RLS; all writes go through
--     SECURITY DEFINER functions or service_role. EXECUTE is revoked from anon
--     explicitly (Supabase auto-grants it on new functions otherwise).
--   * The scan trigger on `bounties` is AFTER and swallows its own errors, so a
--     moderation failure can never block a post or an edit.
--
-- Deploy posture: this migration is NOT applied by the change that adds it, the
-- moderation-sweep edge function is NOT deployed, and no cron is scheduled --
-- same gating as the Command Center / reconciliation work.

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- One row per listing that has entered the moderation pipeline (a signal fired
-- or an admin acted on it). Bounties with no row are implicitly ACTIVE.
CREATE TABLE IF NOT EXISTS public.bounty_moderation (
  bounty_id         uuid PRIMARY KEY REFERENCES public.bounties(id) ON DELETE CASCADE,
  state             text NOT NULL DEFAULT 'active'
                      CHECK (state IN ('active','flagged','under_review','hidden','removed','approved')),
  signal_score      numeric NOT NULL DEFAULT 0,
  auto_flagged      boolean NOT NULL DEFAULT false,
  flagged_at        timestamptz,
  flagged_reason    text,
  review_started_at timestamptz,
  reviewed_by       uuid,
  resolved_at       timestamptz,
  resolution        text CHECK (resolution IN ('legitimate','suspicious_confirmed')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bounty_moderation IS
  'Authoritative moderation state per listing. HIDE/REMOVE also drive bounties.status; this table is the queue record and audit anchor.';

CREATE INDEX IF NOT EXISTS bounty_moderation_state_idx
  ON public.bounty_moderation (state, signal_score DESC);
CREATE INDEX IF NOT EXISTS bounty_moderation_open_idx
  ON public.bounty_moderation (updated_at DESC) WHERE state IN ('flagged','under_review');

DROP TRIGGER IF EXISTS trg_bounty_moderation_updated_at ON public.bounty_moderation;
CREATE TRIGGER trg_bounty_moderation_updated_at
  BEFORE UPDATE ON public.bounty_moderation
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Append-only transition log. Deliberately NOT an FK: the audit trail must
-- survive a bounty delete (which is itself a moderation outcome).
CREATE TABLE IF NOT EXISTS public.bounty_moderation_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id  uuid NOT NULL,
  from_state text,
  to_state   text NOT NULL,
  actor      text NOT NULL CHECK (actor IN ('system','admin')),
  actor_id   uuid,
  reason     text,
  notes      text,
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bounty_moderation_events_bounty_idx
  ON public.bounty_moderation_events (bounty_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bounty_moderation_events_flagged_idx
  ON public.bounty_moderation_events (created_at DESC) WHERE to_state = 'flagged';

-- Detection signals attached to a bounty. Upserted on (bounty_id, signal_type)
-- so re-scanning refreshes rather than duplicates. `weight` sums into
-- bounty_moderation.signal_score.
CREATE TABLE IF NOT EXISTS public.moderation_signals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id   uuid NOT NULL REFERENCES public.bounties(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  severity    text NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high')),
  weight      numeric NOT NULL DEFAULT 1,
  source      text NOT NULL DEFAULT 'content' CHECK (source IN ('content','sweep','manual')),
  evidence    jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bounty_id, signal_type)
);

CREATE INDEX IF NOT EXISTS moderation_signals_bounty_idx
  ON public.moderation_signals (bounty_id);

-- Configurable founder-alert thresholds. Admin-editable via
-- admin_update_moderation_threshold(); seeded below.
CREATE TABLE IF NOT EXISTS public.moderation_alert_thresholds (
  key             text PRIMARY KEY,
  description     text NOT NULL,
  comparator      text NOT NULL DEFAULT 'gte',
  threshold_value numeric NOT NULL,
  window_minutes  integer,
  severity        text NOT NULL DEFAULT 'high' CHECK (severity IN ('low','medium','high','critical')),
  enabled         boolean NOT NULL DEFAULT true,
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.moderation_alert_thresholds (key, description, threshold_value, window_minutes, severity) VALUES
  ('application_velocity', 'Applications to one bounty within a 30-minute window', 7,  30, 'high'),
  ('signal_score',         'Summed content-signal weight that auto-flags a listing', 5, NULL, 'high'),
  ('new_account_value',    'Bounty amount ($) posted within 24h of the poster signing up', 200, 1440, 'medium'),
  ('repeated_listing',     'Near-identical listings from one poster within 7 days', 3, 10080, 'medium'),
  ('flag_rate_spike',      'Listings flagged platform-wide within 60 minutes', 10, 60, 'critical')
ON CONFLICT (key) DO NOTHING;

-- Fired alerts. `alert_key` is a deterministic dedup key (per bounty per
-- time-bucket) so a sweep re-run does not re-alert.
CREATE TABLE IF NOT EXISTS public.moderation_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key        text NOT NULL UNIQUE,
  threshold_key    text NOT NULL,
  bounty_id        uuid,
  poster_id        uuid,
  severity         text NOT NULL DEFAULT 'high',
  summary          text NOT NULL,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid
);

CREATE INDEX IF NOT EXISTS moderation_alerts_unacked_idx
  ON public.moderation_alerts (created_at DESC) WHERE acknowledged_at IS NULL;

-- Sweep observability (mirrors reconciliation_reports).
CREATE TABLE IF NOT EXISTS public.moderation_sweep_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at           timestamptz NOT NULL DEFAULT now(),
  bounties_scanned integer NOT NULL DEFAULT 0,
  signals_written  integer NOT NULL DEFAULT 0,
  alerts_created   integer NOT NULL DEFAULT 0
);

-- ============================================================================
-- 2. RLS -- admin SELECT only; every write goes through a function below
-- ============================================================================

ALTER TABLE public.bounty_moderation           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bounty_moderation_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_signals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_alert_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_alerts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_sweep_runs       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bounty_moderation','bounty_moderation_events','moderation_signals',
    'moderation_alert_thresholds','moderation_alerts','moderation_sweep_runs'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select_admin ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_select_admin ON public.%I FOR SELECT '
      || 'USING ((auth.jwt() -> ''app_metadata'' ->> ''role'') = ''admin'')', t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ============================================================================
-- 3. notifications.type CHECK -- allow the moderation types
-- ============================================================================
-- Rebuilt from 20260725080000_notification_categories_and_types.sql (the
-- current live definition) plus the two moderation types. category stays
-- 'security', which notifications_category_check already permits.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'application', 'acceptance', 'completion', 'payment', 'message', 'follow',
    'cancellation_request', 'cancellation_accepted', 'cancellation_rejected',
    'dispute_created', 'dispute_resolved', 'workflow_dispute_created',
    'stale_bounty', 'stale_bounty_cancelled', 'stale_bounty_reposted',
    'update', 'review_needed', 'balance_update', 'bounty_nearby', 'bounty_expiry',
    'dispute_escalated',
    'account_warning', 'account_restricted',
    'payout_paid', 'payout_failed', 'payout_canceled', 'withdrawal_reversed',
    'bank_disconnected', 'payout_method_changed',
    'verification_submitted', 'verification_verified', 'verification_rejected',
    'verification_canceled',
    'marketing_promo',
    -- new: trust & safety moderation
    'moderation_alert', 'moderation_flagged'
  ]::text[]));

-- ============================================================================
-- 4. ADMIN GUARD (self-contained: CREATE OR REPLACE with the same body the
--    Command Center migration uses, so this migration applies independently)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_assert_role()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_assert_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_assert_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_assert_role() TO authenticated, service_role;

-- ============================================================================
-- 5. STATE MACHINE + TAKEDOWN HELPERS
-- ============================================================================

-- The full allowed-transition matrix. `system` may ONLY auto-flag from
-- active/approved; everything else needs actor='admin'.
CREATE OR REPLACE FUNCTION public.moderation_transition_allowed(
  p_from text, p_to text, p_actor text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
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
$$;

-- REMOVE prefers bounties.status='deleted' but only if the live status CHECK
-- permits it (older environments may not); otherwise falls back to 'archived'.
-- Either way the moderation state carries the real hidden-vs-removed distinction.
CREATE OR REPLACE FUNCTION public._moderation_takedown_status(p_kind text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allows_deleted boolean := false;
BEGIN
  -- bounties.status is an enum in prod (bounty_status_enum) and a CHECKed text
  -- column in older environments -- support both.
  SELECT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c   ON c.oid = a.attrelid
    JOIN pg_enum  e   ON e.enumtypid = a.atttypid
    WHERE c.oid = 'public.bounties'::regclass
      AND a.attname = 'status'
      AND e.enumlabel = 'deleted'
  ) INTO v_allows_deleted;

  IF NOT v_allows_deleted THEN
    SELECT bool_or(pg_get_constraintdef(oid) ILIKE '%''deleted''%')
      INTO v_allows_deleted
    FROM pg_constraint
    WHERE conrelid = 'public.bounties'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%';
  END IF;

  IF p_kind = 'removed' AND COALESCE(v_allows_deleted, false) THEN
    RETURN 'deleted';
  END IF;
  RETURN 'archived';
END;
$$;

GRANT EXECUTE ON FUNCTION public.moderation_transition_allowed(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._moderation_takedown_status(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.moderation_transition_allowed(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public._moderation_takedown_status(text) FROM anon;

-- ============================================================================
-- 6. CONTENT DETECTION -- the single source of truth for text signals
-- ============================================================================
-- Pure, no auth. Returns a JSON array of {type,severity,weight,evidence}.
-- Every rule names itself; an operator disagrees with a rule, not a black box.
CREATE OR REPLACE FUNCTION public.moderation_scan_content(
  p_title text, p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_text text := lower(coalesce(p_title,'') || '  ' || coalesce(p_description,''));
  v_desc text := btrim(coalesce(p_description,''));
  v_out  jsonb := '[]'::jsonb;
  r      record;
  v_task_verbs text :=
    '(need|needs|build|fix|deliver|complete|design|write|create|find|pick up|drop off|help( me)?|'
    || 'install|repair|clean|mov(e|ing)|paint|walk|drive|assemble|photograph|edit|develop|research|'
    || 'test|review|translate|tutor|teach|cook|bake|deliver|setup|set up|configure|record)';
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
      ('no_actionable_task', 'low', 1.0, NULL)
    ) AS t(signal_type, severity, weight, pattern)
  LOOP
    IF r.signal_type = 'no_actionable_task' THEN
      IF length(v_desc) < 40 OR v_text !~* v_task_verbs THEN
        v_out := v_out || jsonb_build_object(
          'type', r.signal_type, 'severity', r.severity, 'weight', r.weight,
          'evidence', jsonb_build_object(
            'description_length', length(v_desc),
            'has_task_verb', v_text ~* v_task_verbs));
      END IF;
    ELSIF v_text ~* r.pattern THEN
      v_out := v_out || jsonb_build_object(
        'type', r.signal_type, 'severity', r.severity, 'weight', r.weight,
        'evidence', jsonb_build_object('match', substring(v_text from r.pattern)));
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.moderation_scan_content(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.moderation_scan_content(text, text) FROM anon;

-- ============================================================================
-- 7. APPLY SIGNALS + AUTO-FLAG (never further than flagged)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.moderation_apply_signals(
  p_bounty_id uuid, p_signals jsonb, p_source text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.moderation_apply_signals(uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.moderation_apply_signals(uuid, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.moderation_apply_signals(uuid, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.moderation_apply_signals(uuid, jsonb, text) TO service_role;

-- ---- scan trigger on bounties --------------------------------------------------
-- AFTER + error-swallowing: a moderation failure must never block a post/edit.
CREATE OR REPLACE FUNCTION public.trg_moderation_scan_bounty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.moderation_apply_signals(
    NEW.id,
    public.moderation_scan_content(NEW.title, NEW.description),
    'content');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'moderation: scan trigger suppressed error for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS moderation_scan_bounty ON public.bounties;
CREATE TRIGGER moderation_scan_bounty
  AFTER INSERT OR UPDATE OF title, description ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.trg_moderation_scan_bounty();

-- ============================================================================
-- 8. SWEEP -- velocity / duplicate / repeated / new-account signals + alerts
-- ============================================================================
-- SECURITY DEFINER, service_role only. Read-only against bounties except the
-- flagged transition path inside moderation_apply_signals. Returns the alerts
-- it created this run so the caller (moderation-sweep edge function) can fan
-- out notifications.
CREATE OR REPLACE FUNCTION public.run_moderation_sweep()
RETURNS SETOF public.moderation_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run       timestamptz := now();
  v_b         record;
  v_signals   jsonb;
  v_velocity  integer;
  v_dupe      integer;
  v_rep       integer;
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
    WHERE b.status::text = 'open'
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

  INSERT INTO public.moderation_sweep_runs (run_at, bounties_scanned, signals_written, alerts_created)
  VALUES (v_run, v_scanned, v_written, v_alerts);

  RETURN QUERY
  SELECT * FROM public.moderation_alerts
  WHERE id <> ALL (v_pre)
  ORDER BY created_at, id;
END;
$$;
REVOKE ALL ON FUNCTION public.run_moderation_sweep() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_moderation_sweep() FROM anon;
REVOKE ALL ON FUNCTION public.run_moderation_sweep() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_moderation_sweep() TO service_role;

-- Admin recipients for alert fan-out (reads auth.users; service_role only).
CREATE OR REPLACE FUNCTION public.moderation_admin_recipients()
RETURNS TABLE (user_id uuid, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email::text
  FROM auth.users u
  WHERE COALESCE(u.raw_app_meta_data ->> 'role', '') = 'admin'
    AND u.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.moderation_admin_recipients() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.moderation_admin_recipients() FROM anon;
REVOKE ALL ON FUNCTION public.moderation_admin_recipients() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.moderation_admin_recipients() TO service_role;

-- ============================================================================
-- 9. ADMIN READS
-- ============================================================================

-- The queue. Every field the founder brief asks for, in one round trip.
CREATE OR REPLACE FUNCTION public.admin_moderation_queue(
  p_state  text    DEFAULT NULL,
  p_limit  integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  bounty_id               uuid,
  title                   text,
  amount                  numeric,
  is_for_honor            boolean,
  bounty_status           text,
  created_at              timestamptz,
  poster_id               uuid,
  poster_username         text,
  poster_account_age_days integer,
  poster_account_status   text,
  poster_risk_level       text,
  applications            bigint,
  application_velocity    integer,
  related_listings        bigint,
  state                   text,
  signal_score            numeric,
  auto_flagged            boolean,
  flagged_at              timestamptz,
  flagged_reason          text,
  resolution              text,
  updated_at              timestamptz,
  signals                 jsonb,
  total_count             bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM public.admin_assert_role();

  RETURN QUERY
  WITH q AS (
    SELECT
      b.id AS bounty_id, b.title, b.amount, COALESCE(b.is_for_honor, false) AS is_for_honor,
      b.status::text AS bounty_status, b.created_at,
      pid.poster_id,
      pr.username AS poster_username,
      floor(extract(epoch FROM now() - pr.created_at) / 86400.0)::int AS poster_account_age_days,
      COALESCE(pr.account_status, 'active') AS poster_account_status,
      COALESCE(pr.risk_level, 'low') AS poster_risk_level,
      apps.applications,
      apps.application_velocity,
      (SELECT count(*) FROM public.bounties o
        WHERE COALESCE(o.poster_id, o.user_id) = pid.poster_id
          AND o.id <> b.id
          AND o.created_at >= now() - interval '7 days') AS related_listings,
      m.state, m.signal_score, m.auto_flagged, m.flagged_at, m.flagged_reason,
      m.resolution, m.updated_at,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'type', s.signal_type, 'severity', s.severity, 'weight', s.weight,
                'source', s.source, 'evidence', s.evidence, 'detected_at', s.detected_at)
              ORDER BY s.weight DESC, s.signal_type), '[]'::jsonb)
        FROM public.moderation_signals s WHERE s.bounty_id = b.id) AS signals
    FROM public.bounty_moderation m
    JOIN public.bounties b ON b.id = m.bounty_id
    CROSS JOIN LATERAL (SELECT COALESCE(b.poster_id, b.user_id) AS poster_id) pid
    LEFT JOIN public.profiles pr ON pr.id = pid.poster_id
    CROSS JOIN LATERAL (
      SELECT
        (SELECT count(*) FROM public.bounty_requests r WHERE r.bounty_id = b.id) AS applications,
        (SELECT COALESCE(max(c), 0)::int FROM (
           SELECT count(*) AS c FROM public.bounty_requests r
           WHERE r.bounty_id = b.id AND r.created_at >= now() - interval '24 hours'
           GROUP BY date_bin('30 minutes', r.created_at, TIMESTAMPTZ '2000-01-01')
        ) buckets) AS application_velocity
    ) apps
    WHERE (p_state IS NOT NULL AND m.state = p_state)
       OR (p_state IS NULL AND (m.state <> 'active' OR m.signal_score > 0))
  )
  SELECT q.*, count(*) OVER () AS total_count
  FROM q
  ORDER BY
    CASE q.state WHEN 'flagged' THEN 0 WHEN 'under_review' THEN 1
                 WHEN 'hidden' THEN 2 WHEN 'removed' THEN 3
                 WHEN 'approved' THEN 4 ELSE 5 END,
    q.signal_score DESC, q.created_at DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

-- Everything for one listing's review screen.
CREATE OR REPLACE FUNCTION public.admin_moderation_detail(p_bounty_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
  v_poster uuid;
BEGIN
  PERFORM public.admin_assert_role();

  SELECT COALESCE(poster_id, user_id) INTO v_poster FROM public.bounties WHERE id = p_bounty_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'bounty', (SELECT jsonb_build_object(
        'id', b.id, 'title', b.title, 'description', b.description, 'amount', b.amount,
        'is_for_honor', COALESCE(b.is_for_honor, false), 'category', b.category,
        'location', b.location, 'status', b.status::text,
        'created_at', b.created_at, 'updated_at', b.updated_at, 'deadline', b.deadline,
        'hunter_id', b.accepted_by)
      FROM public.bounties b WHERE b.id = p_bounty_id),
    'poster', (SELECT jsonb_build_object(
        'id', pr.id, 'username', pr.username, 'display_name', pr.display_name,
        'account_status', COALESCE(pr.account_status, 'active'),
        'account_restricted', COALESCE(pr.account_restricted, false),
        'risk_level', COALESCE(pr.risk_level, 'low'),
        'account_age_days', floor(extract(epoch FROM now() - pr.created_at) / 86400.0)::int,
        'created_at', pr.created_at)
      FROM public.profiles pr WHERE pr.id = v_poster),
    'moderation', (SELECT to_jsonb(m) FROM public.bounty_moderation m WHERE m.bounty_id = p_bounty_id),
    'signals', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.weight DESC, s.signal_type), '[]'::jsonb)
      FROM public.moderation_signals s WHERE s.bounty_id = p_bounty_id),
    'events', (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at), '[]'::jsonb)
      FROM public.bounty_moderation_events e WHERE e.bounty_id = p_bounty_id),
    'applications', (SELECT jsonb_build_object(
        'total', (SELECT count(*) FROM public.bounty_requests r WHERE r.bounty_id = p_bounty_id),
        'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', r.id, 'hunter_id', r.hunter_id, 'status', r.status::text, 'created_at', r.created_at)
            ORDER BY r.created_at DESC)
          FROM (SELECT * FROM public.bounty_requests r2
                WHERE r2.bounty_id = p_bounty_id ORDER BY r2.created_at DESC LIMIT 25) r), '[]'::jsonb))),
    'related_listings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'title', o.title, 'amount', o.amount, 'status', o.status::text,
        'created_at', o.created_at)
        ORDER BY o.created_at DESC)
      FROM public.bounties o
      WHERE COALESCE(o.poster_id, o.user_id) = v_poster
        AND o.id <> p_bounty_id
        AND o.created_at >= now() - interval '30 days'), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END;
$$;

-- Configurable thresholds.
CREATE OR REPLACE FUNCTION public.admin_moderation_thresholds()
RETURNS SETOF public.moderation_alert_thresholds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.admin_assert_role();
  RETURN QUERY SELECT * FROM public.moderation_alert_thresholds ORDER BY key;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_moderation_threshold(
  p_key             text,
  p_threshold_value numeric DEFAULT NULL,
  p_window_minutes  integer DEFAULT NULL,
  p_enabled         boolean DEFAULT NULL
)
RETURNS public.moderation_alert_thresholds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.moderation_alert_thresholds;
BEGIN
  PERFORM public.admin_assert_role();

  UPDATE public.moderation_alert_thresholds SET
    threshold_value = COALESCE(p_threshold_value, threshold_value),
    window_minutes  = COALESCE(p_window_minutes, window_minutes),
    enabled         = COALESCE(p_enabled, enabled),
    updated_by      = auth.uid(),
    updated_at      = now()
  WHERE key = p_key
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown moderation threshold: %', p_key USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_moderation_alerts(
  p_include_acked boolean DEFAULT false,
  p_limit         integer DEFAULT 100
)
RETURNS SETOF public.moderation_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  PERFORM public.admin_assert_role();
  RETURN QUERY
  SELECT * FROM public.moderation_alerts
  WHERE p_include_acked OR acknowledged_at IS NULL
  ORDER BY created_at DESC
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_acknowledge_moderation_alert(p_id uuid)
RETURNS public.moderation_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.moderation_alerts;
BEGIN
  PERFORM public.admin_assert_role();
  UPDATE public.moderation_alerts
    SET acknowledged_at = now(), acknowledged_by = auth.uid()
  WHERE id = p_id AND acknowledged_at IS NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.moderation_alerts WHERE id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown alert: %', p_id USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_row;
END;
$$;

-- Outcome metrics: legitimate demand vs suspicious demand, for PostHog / BI.
CREATE OR REPLACE FUNCTION public.admin_moderation_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.admin_assert_role();

  SELECT jsonb_build_object(
    'generated_at', now(),
    'by_state', (SELECT COALESCE(jsonb_object_agg(state, n), '{}'::jsonb)
      FROM (SELECT state, count(*) AS n FROM public.bounty_moderation GROUP BY state) s),
    'open_queue', (SELECT count(*) FROM public.bounty_moderation WHERE state IN ('flagged','under_review')),
    'auto_flagged', (SELECT count(*) FROM public.bounty_moderation WHERE auto_flagged),
    'resolved_legitimate', (SELECT count(*) FROM public.bounty_moderation WHERE resolution = 'legitimate'),
    'resolved_suspicious', (SELECT count(*) FROM public.bounty_moderation WHERE resolution = 'suspicious_confirmed'),
    -- "demand" = applications accumulated on listings with each outcome.
    'legitimate_demand', COALESCE((
      SELECT sum(a.c) FROM public.bounty_moderation m
      JOIN LATERAL (SELECT count(*) AS c FROM public.bounty_requests r WHERE r.bounty_id = m.bounty_id) a ON true
      WHERE m.resolution = 'legitimate'), 0),
    'suspicious_demand', COALESCE((
      SELECT sum(a.c) FROM public.bounty_moderation m
      JOIN LATERAL (SELECT count(*) AS c FROM public.bounty_requests r WHERE r.bounty_id = m.bounty_id) a ON true
      WHERE m.resolution = 'suspicious_confirmed'), 0),
    'unacknowledged_alerts', (SELECT count(*) FROM public.moderation_alerts WHERE acknowledged_at IS NULL),
    'last_sweep_at', (SELECT max(run_at) FROM public.moderation_sweep_runs)
  ) INTO v;

  RETURN v;
END;
$$;

-- ============================================================================
-- 10. ADMIN WRITE -- the state transition (the only path to hide/remove)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_moderation_transition(
  p_bounty_id uuid,
  p_new_state text,
  p_reason    text,
  p_notes     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from       text;
  v_actor      uuid := auth.uid();
  v_bounty     public.bounties%rowtype;
  v_new_status text;
  v_resolution text;
  v_score      numeric;
BEGIN
  PERFORM public.admin_assert_role();

  IF p_new_state NOT IN ('active','flagged','under_review','hidden','removed','approved') THEN
    RAISE EXCEPTION 'invalid target state: %', p_new_state USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required for a moderation transition' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bounty FROM public.bounties WHERE id = p_bounty_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty % not found', p_bounty_id USING ERRCODE = 'P0002';
  END IF;

  SELECT state INTO v_from FROM public.bounty_moderation WHERE bounty_id = p_bounty_id;
  v_from := COALESCE(v_from, 'active');

  IF NOT public.moderation_transition_allowed(v_from, p_new_state, 'admin') THEN
    RAISE EXCEPTION 'illegal moderation transition: % -> %', v_from, p_new_state USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(weight), 0) INTO v_score
  FROM public.moderation_signals WHERE bounty_id = p_bounty_id;

  v_resolution := CASE
    WHEN p_new_state = 'approved' THEN 'legitimate'
    WHEN p_new_state IN ('hidden','removed') THEN 'suspicious_confirmed'
    ELSE NULL
  END;

  INSERT INTO public.bounty_moderation AS m
    (bounty_id, state, signal_score, notes, review_started_at, reviewed_by, resolved_at, resolution)
  VALUES (
    p_bounty_id, p_new_state, v_score, p_notes,
    CASE WHEN p_new_state = 'under_review' THEN now() END,
    CASE WHEN p_new_state = 'under_review' THEN v_actor END,
    CASE WHEN v_resolution IS NOT NULL THEN now() END,
    v_resolution
  )
  ON CONFLICT (bounty_id) DO UPDATE SET
    state             = EXCLUDED.state,
    notes             = COALESCE(EXCLUDED.notes, m.notes),
    review_started_at = CASE WHEN EXCLUDED.state = 'under_review' AND m.review_started_at IS NULL
                             THEN now() ELSE m.review_started_at END,
    reviewed_by       = CASE WHEN EXCLUDED.state = 'under_review' THEN v_actor ELSE m.reviewed_by END,
    resolved_at       = CASE WHEN v_resolution IS NOT NULL THEN now() ELSE m.resolved_at END,
    resolution        = CASE WHEN v_resolution IS NOT NULL THEN v_resolution ELSE m.resolution END,
    updated_at        = now();

  INSERT INTO public.bounty_moderation_events
    (bounty_id, from_state, to_state, actor, actor_id, reason, notes)
  VALUES (p_bounty_id, v_from, p_new_state, 'admin', v_actor, p_reason, p_notes);

  -- Take the listing out of / back into the marketplace via bounties.status --
  -- the exclusion every feed query already honours.
  -- bounties.status is an enum in prod; assign via a string literal (EXECUTE
  -- format %L) since text-variable -> enum has no implicit assignment cast.
  IF p_new_state IN ('hidden','removed') THEN
    v_new_status := public._moderation_takedown_status(p_new_state);
    IF v_bounty.status::text <> 'completed' AND v_bounty.status::text <> v_new_status THEN
      EXECUTE format('UPDATE public.bounties SET status = %L, updated_at = now() WHERE id = $1', v_new_status)
        USING p_bounty_id;
    END IF;
  ELSIF p_new_state IN ('approved','active')
        AND v_bounty.status::text IN ('archived','deleted')
        AND v_bounty.accepted_by IS NULL THEN
    -- Only reinstate a listing that was actually taken down and never progressed.
    EXECUTE format('UPDATE public.bounties SET status = %L, updated_at = now() WHERE id = $1', 'open')
      USING p_bounty_id;
  END IF;

  -- Best-effort mirror into the canonical event ledger if it is installed.
  IF to_regprocedure(
       'public.record_bounty_event(text,text,text,uuid,uuid,timestamptz,numeric,text,jsonb)'
     ) IS NOT NULL THEN
    PERFORM public.record_bounty_event(
      'moderation.state_changed:' || p_bounty_id::text || ':'
        || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
      'moderation.state_changed', 'system', p_bounty_id, v_actor, now(), NULL, NULL,
      jsonb_build_object('from', v_from, 'to', p_new_state, 'reason', p_reason));
  END IF;

  RETURN jsonb_build_object(
    'bounty_id', p_bounty_id,
    'from_state', v_from,
    'to_state', p_new_state,
    'resolution', v_resolution,
    'bounty_status', (SELECT status::text FROM public.bounties WHERE id = p_bounty_id));
END;
$$;

-- ============================================================================
-- 11. FUNCTION GRANTS
-- ============================================================================
DO $$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.admin_moderation_queue(text,integer,integer)',
    'public.admin_moderation_detail(uuid)',
    'public.admin_moderation_thresholds()',
    'public.admin_update_moderation_threshold(text,numeric,integer,boolean)',
    'public.admin_moderation_alerts(boolean,integer)',
    'public.admin_acknowledge_moderation_alert(uuid)',
    'public.admin_moderation_metrics()',
    'public.admin_moderation_transition(uuid,text,text,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
