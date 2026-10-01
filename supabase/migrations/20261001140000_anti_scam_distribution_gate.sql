-- Anti-scam marketplace protection (trust-spine audit 2026-09-30, T1 + T2 + T21).
--
-- Two independent systems are changed here:
--
-- A. DISTRIBUTION. Bounty itself must not push a listing to hunters when
--    there is evidence it may be unsafe. In the 21 days before the audit, all
--    7 "still looking" escalations that reached 25+ hunters were scams, and
--    fn_escalate_stale_bounty_liquidity had no moderation, report or account
--    check at all.
--
--    fn_bounty_distribution_gate() is the single rule, used by every path that
--    pushes a bounty to hunters:
--
--      safety (all paths)       no flagged / under_review / hidden / removed
--                               moderation state; no unresolved signals
--                               (score >= 2, the existing queue threshold) unless
--                               a human approved the listing; no pending report
--                               on the bounty or its poster; poster active.
--      credibility (escalation  at least one of: a completed transaction,
--      only)                    Stripe Identity verified, escrow held on this
--                               bounty, explicit human approval.
--
--    The insert-time "new bounty near you" pushes (radius / zip / service
--    area) apply the safety rules only, so a clean first bounty from a new
--    poster still reaches nearby hunters and the feed. The broad liquidity
--    escalation (up to 60 hunters, every profile for online work) also needs
--    a credibility signal. A clean bounty that lacks one raises an
--    'escalation_review' alert so a human can approve it, and approval unlocks
--    escalation on the next run.
--
--    Every decision is recorded in bounty_distribution_decisions with its
--    reasons, so suppression is observable.
--
-- B. DETECTION.
--    * moderation_scan_content gains the four rule families that separated
--      scams from real listings on 2026-09-25: payment/identity proxy,
--      off-platform channels and payment, employment / recurring pay, and
--      details withheld (in DMs or an image). Existing rules are unchanged.
--    * An attachment-only listing (photos, almost no text) is a weight-1
--      corroborating signal.
--    * moderation_apply_signals: a human approval now sticks. The sweep
--      re-applies the same signals every 10 minutes, and 'approved -> flagged'
--      was allowed for the system, so an approved listing could be re-flagged
--      by evidence the reviewer had already seen. Only signal types that
--      appear after approval can re-open it now.
--    * Reports act: 2+ distinct reporters, or 1 report against a poster whose
--      account is under 7 days old, moves the listing to 'under_review'.
--    * Visibility: flagged / under_review / hidden / removed listings are
--      hidden from everyone except the poster, the accepted hunter, existing
--      applicants and admins, via a RESTRICTIVE SELECT policy on bounties.
--      Before this, moderation state changed nothing a hunter could see. The
--      admin HIDE path's status change to 'archived' was not reused because
--      it auto-rejects every pending application, which a reversible review
--      must not do.
--    * Alert delivery: moderation-sweep only delivered alerts created during
--      its own run, so alerts written elsewhere (insert-time auto-flags,
--      report actions, escalation reviews) were never pushed to admins.
--      moderation_alerts.fanned_out_at is now the delivery watermark.
--    * report_submitted: reports.analytics_captured_at is the watermark for
--      the server-side PostHog event emitted by moderation-sweep.
--
-- No existing row is modified. The two new watermark columns are added with
-- DEFAULT now() and the default is then dropped, so existing alerts and
-- reports count as already delivered/captured (no retroactive burst) and new
-- rows start NULL.
--
-- Function bodies below that replace existing ones were copied from
-- production's live definitions on 2026-10-01 (identical to git apart from
-- whitespace/encoding) and changed only where marked "anti-scam".
--
-- Rollback: supabase/rollbacks/production/20261001140000_anti_scam_distribution_gate.down.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bounty_distribution_decisions (
  bounty_id          uuid        NOT NULL REFERENCES public.bounties(id) ON DELETE CASCADE,
  path               text        NOT NULL CHECK (path IN ('escalation', 'radius', 'zip', 'service_area')),
  stage              smallint    NOT NULL,
  decision           text        NOT NULL CHECK (decision IN ('allowed', 'skipped')),
  reasons            text[]      NOT NULL DEFAULT '{}',
  credibility        text[]      NOT NULL DEFAULT '{}',
  first_evaluated_at timestamptz NOT NULL DEFAULT now(),
  last_evaluated_at  timestamptz NOT NULL DEFAULT now(),
  eval_count         integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (bounty_id, path, stage, decision)
);

COMMENT ON TABLE public.bounty_distribution_decisions IS
  'One row per (bounty, push path, stage, decision) from fn_bounty_distribution_gate. reasons explains a skip; credibility lists the credibility signals present. Re-evaluations bump eval_count / last_evaluated_at.';

CREATE INDEX IF NOT EXISTS bounty_distribution_decisions_skipped_idx
  ON public.bounty_distribution_decisions (last_evaluated_at DESC)
  WHERE decision = 'skipped';

ALTER TABLE public.bounty_distribution_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bounty_distribution_decisions FROM anon, authenticated;
GRANT SELECT ON public.bounty_distribution_decisions TO authenticated;
DROP POLICY IF EXISTS bounty_distribution_decisions_select_admin ON public.bounty_distribution_decisions;
CREATE POLICY bounty_distribution_decisions_select_admin
  ON public.bounty_distribution_decisions FOR SELECT TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

-- Delivery watermark for moderation-sweep's admin fan-out.
ALTER TABLE public.moderation_alerts ADD COLUMN IF NOT EXISTS fanned_out_at timestamptz DEFAULT now();
ALTER TABLE public.moderation_alerts ALTER COLUMN fanned_out_at DROP DEFAULT;
CREATE INDEX IF NOT EXISTS moderation_alerts_undelivered_idx
  ON public.moderation_alerts (created_at) WHERE fanned_out_at IS NULL;

-- Watermark for the server-side report_submitted PostHog event.
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS analytics_captured_at timestamptz DEFAULT now();
ALTER TABLE public.reports ALTER COLUMN analytics_captured_at DROP DEFAULT;
CREATE INDEX IF NOT EXISTS reports_analytics_uncaptured_idx
  ON public.reports (created_at) WHERE analytics_captured_at IS NULL;
CREATE INDEX IF NOT EXISTS reports_pending_content_idx
  ON public.reports (content_type, content_id) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. Detection
-- ---------------------------------------------------------------------------

-- moderation_scan_content: production body + four anti-scam families.
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
        || '(\y@[a-z][a-z0-9_.]{2,}\y)'),

      -- anti-scam (2026-10-01) ------------------------------------------------
      -- Payment / identity proxy: the hunter is asked to spend, receive or
      -- move money, or lend their identity. On an escrow marketplace a real
      -- task never needs this, so it auto-flags on its own (weight 5).
      ('payment_proxy', 'high', 5.0,
        '(\ypay for (a|an|my|the|this|some|our) ([a-z''-]+ ){0,4}orders?\y|'
        || '\ykyc\y|\yverify (my|your|an?|the|our) ([a-z]+ )?(account|identity)\y|\yidentity verification\y|'
        || '\y(use|using|with|through) your (own )?(name|identity|id|ssn|account|card|credit card|debit card|bank|bank account|paypal|cash ?app|venmo|zelle)\y|'
        || '\yreceive (payments?|funds|money|transfers?|packages?|parcels?) (for|on behalf of)\y|'
        || '\y(card|payment) testing\y|\yre-?ship(ping)? (packages?|parcels?|items?)\y|\y(package|parcel) forwarding\y|'
        -- Added after the 2026-10-01 production replay: 0 hits outside known scams
        -- across all 187 production listings (c1c869bb, a1915343, 0b9e1e8a).
        || '\y(complete|make|process|finish) (an? |my |the |this )?online (purchase|payment)s?\y|'
        || '\y(i''?ll|i will|i can|i would) (provide|send|give) (you )?(the )?(payment|money|funds|card details)( to you)? (first|upfront|up front|beforehand)\y|'
        || '\y(card|cards|payment|website|site) (is |are )?(very |really |so )?selective\y|\ycard[- ]selective\y)'),
      -- Purchase on someone's behalf: weaker on its own (a real errand can say
      -- "place an order"), so it only queues; with any other family it flags.
      ('purchase_on_behalf', 'high', 3.0,
        '(\y(complete|make|place|process|finish) (an? |my |the |some |this )?online (purchase|payment|order|transaction)s?\y|'
        || '\yhelp (me |us )?(to )?(complete|make|process|finish) (an? |my |the |some |this )?(online )?(purchase|payment|transaction)s?\y|'
        || '\yhelp (me )?(to )?(purchase|buy) (a |an |my |some )?(birthday )?(gift|present)s?\y|'  -- 2f98b41e
        || '\ygift ?cards?\y)'),
      -- Off-platform channels the original contact rule did not name.
      ('off_platform_channel', 'high', 3.0,
        '(\ysignal (app|me|messenger|number)\y|\yon signal\y|'
        || '\y(kik|wechat|wickr|threema|viber|google voice|snapchat)\y|'
        || '\y(call|email|e-mail) me (at|on|via)\y|\ycontact me (on|via|at|outside|off)\y|'
        || '\yoff[- ]?(the )?(app|platform)\y|\youtside (of )?(the |this )?(app|platform)\y)'),
      -- Payment outside escrow.
      ('off_platform_payment', 'high', 3.0,
        '(\ycash ?app\y|\yzelle\y|\yvenmo\y|\ypaypal\y|\ywestern union\y|\ymoneygram\y|\ywire transfer\y|\yapple cash\y|'
        || '\ypay(ing)? (you |me )?(in cash|cash only|outside)\y)'),
      -- Employment pitch: a job, not a task.
      ('employment_offer', 'high', 3.0,
        '(\y(we are|we''re|now|currently|is|are|am) hiring\y|\yhiring (now|immediately)\y|'
        || '\ypart[- ]?time\y|\yfull[- ]?time\y|\ydata entry\y|'
        || '\y(personal|virtual|executive|administrative) assistant\y|'
        || '\yremote (job|position|role|opportunity)\y|\ywork[- ]from[- ]home\y|\ysalary\y|'
        || '\yjob (opening|opportunity|position|offer)\y|\yapply now\y|\yno experience (needed|required)\y)'),
      -- Recurring pay rate: a real one-off job can quote an hourly rate, so
      -- this only corroborates (weight 1 stays below every threshold alone).
      ('recurring_pay_rate', 'low', 1.0,
        '(\$ ?[0-9]+(\.[0-9]{2})? ?(/ ?|per |an |a )(hr|hour|week|wk|month)\y|'
        || '\y(weekly|bi-?weekly|monthly) (pay|salary|payment|income|wages?)\y|'
        || '\y(earn|make) (up to )?\$ ?[0-9]+k? (per|a|every) (day|week|month)\y)'),
      -- Details withheld: the task is only described in DMs or an image.
      ('details_withheld', 'medium', 2.0,
        '(\ysee (the )?(attached|attachment|image|picture|photo|pic|screenshot|flyer)\y|'
        || '\ydetails (are |is )?(in|on) (the )?(attached|attachment|image|picture|photo|pic|screenshot|flyer|bio)\y|'
        || '\y(explain|discuss|share|send|give|tell)( you)?( more| further| the)?( details| info| information)? (in|via|over|through) (the |a |my )?(dms?|pms?|private( message| chat)?|inbox)\y|'
        || '\y(more|full) (info|details|information) (in|via|over) (the )?(dms?|pms?|private|inbox)\y|'
        || '\ypm me\y|\yinbox me\y|'
        || '\ysend (me )?an? (direct|private) message\y|\yexplain (it |this |more )?further\y|'  -- c1c869bb, 4554d92a
        || '\y(check|read|look at) (the )?(image|picture|photo|pic|attachment|flyer)\y)')
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

-- Number of attachments in either attachment column. attachments_json is
-- sometimes a JSON array and sometimes a JSON string holding one.
CREATE OR REPLACE FUNCTION public.moderation_attachment_count(p_value jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inner jsonb;
BEGIN
  IF p_value IS NULL THEN
    RETURN 0;
  END IF;
  IF jsonb_typeof(p_value) = 'array' THEN
    RETURN jsonb_array_length(p_value);
  END IF;
  IF jsonb_typeof(p_value) = 'string' THEN
    BEGIN
      v_inner := (p_value #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RETURN 0;
    END;
    IF jsonb_typeof(v_inner) = 'array' THEN
      RETURN jsonb_array_length(v_inner);
    END IF;
  END IF;
  RETURN 0;
END;
$function$;

-- Details hidden in images: attachments with almost no written task.
-- Weight 1, corroborating only: a real post often attaches a photo.
CREATE OR REPLACE FUNCTION public.moderation_scan_attachments(
  p_description text, p_attachments jsonb, p_attachments_json jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n   integer := GREATEST(public.moderation_attachment_count(p_attachments),
                            public.moderation_attachment_count(p_attachments_json));
  v_len integer := length(btrim(coalesce(p_description, '')));
BEGIN
  IF v_n > 0 AND v_len < 40 THEN
    RETURN jsonb_build_array(jsonb_build_object(
      'type', 'details_in_attachment', 'severity', 'low', 'weight', 1.0,
      'evidence', jsonb_build_object('attachments', v_n, 'description_length', v_len)));
  END IF;
  RETURN '[]'::jsonb;
END;
$function$;

-- System transitions: may now also open a review (reports) and drop an
-- approval when new evidence appears after it.
CREATE OR REPLACE FUNCTION public.moderation_transition_allowed(p_from text, p_to text, p_actor text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN false
    WHEN p_actor = 'system' THEN (
         (p_from IN ('active','approved') AND p_to = 'flagged')
      OR (p_from IN ('active','flagged','approved') AND p_to = 'under_review')  -- anti-scam: report threshold
      OR (p_from = 'approved' AND p_to = 'active'))                              -- anti-scam: new signals after approval
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

-- moderation_apply_signals: production body; a human approval now sticks
-- unless a signal type appears that was not present when it was approved.
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
  v_new_types text[];   -- anti-scam
BEGIN
  IF p_bounty_id IS NULL OR p_signals IS NULL THEN
    RETURN;
  END IF;

  -- anti-scam: signal types not already recorded for this listing.
  v_new_types := ARRAY(
    SELECT DISTINCT t FROM unnest(v_types) t
    WHERE NOT EXISTS (SELECT 1 FROM public.moderation_signals s
                      WHERE s.bounty_id = p_bounty_id AND s.signal_type = t));

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

  -- anti-scam: an approval only covers the evidence the reviewer saw. Signals
  -- the sweep re-applies unchanged must not undo it; a new signal type must.
  IF v_state = 'approved' AND cardinality(v_new_types) = 0 THEN
    RETURN;
  END IF;

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
      jsonb_build_object('signal_score', v_score, 'signals', v_reason, 'new_signal_types', v_new_types));

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

  -- anti-scam: below the flag threshold, new evidence after an approval
  -- returns the listing to 'active' so the distribution gate weighs it again.
  ELSIF v_state = 'approved'
        AND public.moderation_transition_allowed(v_state, 'active', 'system') THEN
    UPDATE public.bounty_moderation SET state = 'active', updated_at = now()
    WHERE bounty_id = p_bounty_id;

    INSERT INTO public.bounty_moderation_events
      (bounty_id, from_state, to_state, actor, reason, metadata)
    VALUES (
      p_bounty_id, 'approved', 'active', 'system',
      'new signals after approval: ' || array_to_string(v_new_types, ', '),
      jsonb_build_object('signal_score', v_score, 'new_signal_types', v_new_types));
  END IF;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'moderation_apply_signals suppressed error for %: %', p_bounty_id, SQLERRM;
END;
$function$;

-- Insert/edit-time scan: production body + attachment-only signal.
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

  -- anti-scam: details hidden in images.
  v_signals := v_signals
    || public.moderation_scan_attachments(NEW.description, NEW.attachments, NEW.attachments_json);

  PERFORM public.moderation_apply_signals(NEW.id, v_signals, 'content');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'moderation: scan trigger suppressed error for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$function$;

-- Rescan when attachments change too. The name is unchanged, so it still
-- sorts before the trg_bounties_notify_* AFTER INSERT triggers and the
-- distribution gate sees insert-time signals.
DROP TRIGGER IF EXISTS moderation_scan_bounty ON public.bounties;
CREATE TRIGGER moderation_scan_bounty
  AFTER INSERT OR UPDATE OF title, description, is_for_honor, attachments, attachments_json
  ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.trg_moderation_scan_bounty();

-- run_moderation_sweep: production body + attachment scan + delivery
-- watermark (returns every undelivered alert, not only this run's).
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
             b.attachments, b.attachments_json,
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

      -- anti-scam: details hidden in images.
      v_signals := v_signals
        || public.moderation_scan_attachments(v_b.description, v_b.attachments, v_b.attachments_json);

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

  -- anti-scam: hand the edge function every alert not yet fanned out --
  -- including ones raised outside the sweep (insert-time auto-flags, report
  -- actions, escalation reviews), which were previously never delivered.
  RETURN QUERY
  WITH delivered AS (
    UPDATE public.moderation_alerts a
       SET fanned_out_at = now()
     WHERE a.fanned_out_at IS NULL
    RETURNING a.*)
  SELECT * FROM delivered ORDER BY created_at, id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Visibility hold
-- ---------------------------------------------------------------------------

-- True when the caller may see this bounty given its moderation state.
-- SECURITY DEFINER because bounty_moderation is admin-only under RLS and
-- bounty_requests' own policies read bounties (a plain subquery would recurse).
CREATE OR REPLACE FUNCTION public.fn_bounty_moderation_visible(
  p_bounty_id uuid, p_poster_id uuid, p_user_id uuid, p_accepted_by uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_state text;
  v_uid   uuid := auth.uid();
BEGIN
  SELECT state INTO v_state FROM public.bounty_moderation WHERE bounty_id = p_bounty_id;
  IF v_state IS NULL OR v_state NOT IN ('flagged', 'under_review', 'hidden', 'removed') THEN
    RETURN true;
  END IF;
  IF v_uid IS NOT NULL AND (v_uid = p_poster_id OR v_uid = p_user_id OR v_uid = p_accepted_by) THEN
    RETURN true;
  END IF;
  IF ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin' THEN
    RETURN true;
  END IF;
  -- Existing applicants keep access so their application history still resolves.
  IF v_uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bounty_requests br
    WHERE br.bounty_id = p_bounty_id AND br.hunter_id = v_uid) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_bounty_moderation_visible(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_bounty_moderation_visible(uuid, uuid, uuid, uuid)
  TO anon, authenticated, service_role;

DROP POLICY IF EXISTS bounties_select_moderation_hold ON public.bounties;
CREATE POLICY bounties_select_moderation_hold
  ON public.bounties AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (public.fn_bounty_moderation_visible(id, poster_id, user_id, accepted_by));

-- ---------------------------------------------------------------------------
-- 4. Distribution gate
-- ---------------------------------------------------------------------------

-- Credibility signals for a bounty's poster / the bounty itself.
CREATE OR REPLACE FUNCTION public.fn_bounty_credibility_signals(p_bounty_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_poster uuid;
  v_pav    integer;
  v_out    text[] := '{}';
BEGIN
  SELECT COALESCE(b.poster_id, b.user_id), COALESCE(b.payment_architecture_version, 1)
    INTO v_poster, v_pav
  FROM public.bounties b WHERE b.id = p_bounty_id;
  IF NOT FOUND OR v_poster IS NULL THEN
    RETURN v_out;
  END IF;

  -- A completed bounty with a different counterparty, on either side.
  IF EXISTS (
    SELECT 1 FROM public.bounties c
    WHERE c.status::text = 'completed'
      AND NOT COALESCE(c.is_test, false)
      AND c.accepted_by IS NOT NULL
      AND c.accepted_by IS DISTINCT FROM COALESCE(c.poster_id, c.user_id)
      AND (COALESCE(c.poster_id, c.user_id) = v_poster OR c.accepted_by = v_poster)
  ) THEN
    v_out := v_out || 'completed_transaction'::text;
  END IF;

  -- Same rule as the applicant card (deriveCoarseVerificationStatus).
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_poster
      AND (p.stripe_identity_status = 'verified' OR p.id_verification_status = 'verified')
  ) THEN
    v_out := v_out || 'id_verified'::text;
  END IF;

  -- Money currently held for this bounty (per payment architecture, as in
  -- fn_bounties_enforce_funding_before_work).
  IF (v_pav = 1
      AND EXISTS (SELECT 1 FROM public.wallet_transactions wt
                  WHERE wt.bounty_id = p_bounty_id AND wt.type = 'escrow' AND wt.status = 'completed')
      AND NOT EXISTS (SELECT 1 FROM public.wallet_transactions wt
                      WHERE wt.bounty_id = p_bounty_id AND wt.type IN ('refund', 'release')
                        AND wt.status = 'completed'))
     OR (v_pav = 2
      AND EXISTS (SELECT 1 FROM public.bounty_payments bp
                  WHERE bp.bounty_id = p_bounty_id AND bp.status IN ('authorized', 'captured')))
     OR (v_pav = 3
      AND EXISTS (SELECT 1 FROM public.bounty_v3_funding bf
                  WHERE bf.bounty_id = p_bounty_id
                    AND bf.state IN ('authorized', 'awaiting_hunter_onboarding', 'capturing')))
  THEN
    v_out := v_out || 'escrow_funded'::text;
  END IF;

  IF EXISTS (SELECT 1 FROM public.bounty_moderation m
             WHERE m.bounty_id = p_bounty_id AND m.state = 'approved') THEN
    v_out := v_out || 'human_approved'::text;
  END IF;

  RETURN v_out;
END;
$function$;

-- The single distribution rule. Returns {allowed, reasons, credibility} and
-- records the decision. Never raises: an internal error fails closed
-- (reason 'gate_error') so a bounty INSERT can never fail because of it.
CREATE OR REPLACE FUNCTION public.fn_bounty_distribution_gate(
  p_bounty_id uuid, p_path text, p_stage smallint, p_require_credibility boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exists   boolean := false;
  v_poster   uuid;
  v_status   text;
  v_deleted  timestamptz;
  v_found    boolean;
  v_state    text;
  v_resolved timestamptz;
  v_since    timestamptz := '-infinity';
  v_score    numeric;
  v_reasons  text[] := '{}';
  v_cred     text[] := '{}';
  v_allowed  boolean;
BEGIN
  BEGIN
    SELECT true, COALESCE(b.poster_id, b.user_id) INTO v_exists, v_poster
    FROM public.bounties b WHERE b.id = p_bounty_id;

    IF NOT COALESCE(v_exists, false) THEN
      RETURN jsonb_build_object('allowed', false, 'reasons', jsonb_build_array('bounty_not_found'),
                                'credibility', '[]'::jsonb);
    END IF;

    -- Poster account.
    SELECT true, p.account_status, p.deleted_at INTO v_found, v_status, v_deleted
    FROM public.profiles p WHERE p.id = v_poster;
    IF v_poster IS NULL OR NOT COALESCE(v_found, false) OR v_deleted IS NOT NULL THEN
      v_reasons := v_reasons || 'poster_missing'::text;
    ELSIF COALESCE(v_status, 'active') <> 'active' THEN
      v_reasons := v_reasons || ('poster_account_' || v_status);
    END IF;

    -- Moderation state and unresolved signals. A human approval resolves the
    -- signals it saw (moderation_apply_signals drops it when new ones appear).
    SELECT m.state, m.resolved_at INTO v_state, v_resolved
    FROM public.bounty_moderation m WHERE m.bounty_id = p_bounty_id;
    IF v_state IN ('flagged', 'under_review', 'hidden', 'removed') THEN
      v_reasons := v_reasons || ('moderation_' || v_state);
    ELSIF v_state IS DISTINCT FROM 'approved' THEN
      SELECT COALESCE(sum(s.weight), 0) INTO v_score
      FROM public.moderation_signals s WHERE s.bounty_id = p_bounty_id;
      IF v_score >= 2 THEN
        v_reasons := v_reasons || 'unresolved_signals'::text;
      END IF;
    END IF;

    -- Pending reports. Reports filed before an approval were part of it.
    IF v_state = 'approved' THEN
      v_since := COALESCE(v_resolved, '-infinity');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.status = 'pending' AND r.content_type = 'bounty' AND r.content_id = p_bounty_id
        AND (r.created_at AT TIME ZONE 'UTC') > v_since
    ) THEN
      v_reasons := v_reasons || 'pending_report_on_bounty'::text;
    END IF;
    IF v_poster IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.status = 'pending'
        AND ((r.content_type = 'profile' AND r.content_id = v_poster)
          OR (r.content_type = 'bounty' AND r.content_id <> p_bounty_id AND r.content_id IN (
                SELECT o.id FROM public.bounties o WHERE COALESCE(o.poster_id, o.user_id) = v_poster)))
    ) THEN
      v_reasons := v_reasons || 'pending_report_on_poster'::text;
    END IF;

    v_cred := public.fn_bounty_credibility_signals(p_bounty_id);
    IF p_require_credibility AND cardinality(v_cred) = 0 THEN
      v_reasons := v_reasons || 'no_credibility_signal'::text;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_bounty_distribution_gate failed closed for %: %', p_bounty_id, SQLERRM;
    v_reasons := ARRAY['gate_error'];
  END;

  v_allowed := cardinality(v_reasons) = 0;

  BEGIN
    INSERT INTO public.bounty_distribution_decisions AS d
      (bounty_id, path, stage, decision, reasons, credibility)
    VALUES (p_bounty_id, p_path, p_stage,
            CASE WHEN v_allowed THEN 'allowed' ELSE 'skipped' END, v_reasons, v_cred)
    ON CONFLICT (bounty_id, path, stage, decision) DO UPDATE SET
      reasons           = EXCLUDED.reasons,
      credibility       = EXCLUDED.credibility,
      last_evaluated_at = now(),
      eval_count        = d.eval_count + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_bounty_distribution_gate could not record decision for %: %', p_bounty_id, SQLERRM;
  END;

  RETURN jsonb_build_object('allowed', v_allowed, 'reasons', to_jsonb(v_reasons),
                            'credibility', to_jsonb(v_cred));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_bounty_credibility_signals(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bounty_credibility_signals(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_bounty_distribution_gate(uuid, text, smallint, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bounty_distribution_gate(uuid, text, smallint, boolean) TO service_role;

-- fn_escalate_stale_bounty_liquidity: production body + gate (credibility
-- required).
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
  v_gate       jsonb;   -- anti-scam
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

    -- anti-scam: Bounty only vouches for a listing with no evidence against
    -- it and at least one credibility signal. A skipped bounty is not
    -- stamped, so it is re-evaluated every run and escalates as soon as it
    -- qualifies (e.g. right after a human approves it).
    v_gate := public.fn_bounty_distribution_gate(
      v_bounty.id, 'escalation', (v_bounty.liquidity_stage + 1)::smallint, true);
    IF NOT COALESCE((v_gate ->> 'allowed')::boolean, false) THEN
      -- Clean listing that only lacks credibility: ask a human once.
      IF v_gate -> 'reasons' = '["no_credibility_signal"]'::jsonb THEN
        INSERT INTO public.moderation_alerts
          (alert_key, threshold_key, bounty_id, poster_id, severity, summary, detail)
        VALUES (
          'escalation_review:' || v_bounty.id::text,
          'escalation_review', v_bounty.id, v_poster_id, 'medium',
          'Ready to reach more hunters, but the poster has no completed job, ID verification or funded escrow yet: "'
            || left(coalesce(v_bounty.title, ''), 80) || '". Approve it in moderation to allow the push.',
          jsonb_build_object('liquidity_stage', v_bounty.liquidity_stage, 'reasons', v_gate -> 'reasons'))
        ON CONFLICT (alert_key) DO NOTHING;
      END IF;
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

-- Insert-time "new bounty near you" pushes: production bodies + safety gate
-- (no credibility requirement, so new posters keep local reach).
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

  -- anti-scam: no push for a listing with evidence against it.
  IF NOT COALESCE((public.fn_bounty_distribution_gate(NEW.id, 'radius', 1::smallint, false) ->> 'allowed')::boolean, false) THEN
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

  -- anti-scam: no push for a listing with evidence against it.
  IF NOT COALESCE((public.fn_bounty_distribution_gate(NEW.id, 'service_area', 1::smallint, false) ->> 'allowed')::boolean, false) THEN
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

  -- anti-scam: no push for a listing with evidence against it.
  IF NOT COALESCE((public.fn_bounty_distribution_gate(NEW.id, 'zip', 1::smallint, false) ->> 'allowed')::boolean, false) THEN
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

-- ---------------------------------------------------------------------------
-- 5. Report-driven action
-- ---------------------------------------------------------------------------

-- After a report: 2+ distinct reporters, or 1 report against a poster whose
-- account is < 7 days old, puts the poster's live listing(s) under review
-- (out of the feed via bounties_select_moderation_hold, out of every push via
-- the gate) and alerts admins. Reports filed before a human approval do not
-- count again. Never blocks the report itself.
CREATE OR REPLACE FUNCTION public.trg_fn_reports_moderation_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target    record;
  v_from      text;
  v_resolved  timestamptz;
  v_since     timestamptz;
  v_reporters integer;
  v_age       interval;
  v_rule      text;
  v_reason    text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' OR NEW.content_id IS NULL
     OR NEW.content_type NOT IN ('bounty', 'profile') THEN
    RETURN NULL;
  END IF;

  FOR v_target IN
    SELECT b.id, b.title, COALESCE(b.poster_id, b.user_id) AS poster_id, p.created_at AS poster_created_at
    FROM public.bounties b
    JOIN public.profiles p ON p.id = COALESCE(b.poster_id, b.user_id)
    WHERE b.status::text IN ('open', 'in_progress', 'cancellation_requested')
      AND (   (NEW.content_type = 'bounty'  AND b.id = NEW.content_id)
           OR (NEW.content_type = 'profile' AND COALESCE(b.poster_id, b.user_id) = NEW.content_id))
  LOOP
    BEGIN
      IF NEW.reporter_id IS NOT DISTINCT FROM v_target.poster_id THEN
        CONTINUE;
      END IF;

      v_from := NULL; v_resolved := NULL;
      SELECT m.state, m.resolved_at INTO v_from, v_resolved
      FROM public.bounty_moderation m WHERE m.bounty_id = v_target.id;
      v_from := COALESCE(v_from, 'active');
      IF v_from IN ('under_review', 'hidden', 'removed') THEN
        CONTINUE;
      END IF;
      v_since := CASE WHEN v_from = 'approved' THEN COALESCE(v_resolved, '-infinity') ELSE '-infinity' END;

      SELECT count(DISTINCT r.reporter_id) INTO v_reporters
      FROM public.reports r
      WHERE r.status = 'pending'
        AND r.reporter_id IS NOT NULL
        AND r.reporter_id <> v_target.poster_id
        AND (r.created_at AT TIME ZONE 'UTC') > v_since
        AND (   (r.content_type = 'bounty'  AND r.content_id = v_target.id)
             OR (r.content_type = 'profile' AND r.content_id = v_target.poster_id));

      v_age := now() - v_target.poster_created_at;
      v_rule := CASE
        WHEN v_reporters >= 2 THEN 'distinct_reporters'
        WHEN v_reporters >= 1 AND v_age < interval '7 days' THEN 'report_on_new_poster'
        ELSE NULL
      END;
      IF v_rule IS NULL OR NOT public.moderation_transition_allowed(v_from, 'under_review', 'system') THEN
        CONTINUE;
      END IF;

      v_reason := CASE v_rule
        WHEN 'distinct_reporters' THEN v_reporters || ' people reported this listing'
        ELSE 'reported, and the poster''s account is ' || floor(extract(epoch FROM v_age) / 86400)::int || ' day(s) old'
      END;

      INSERT INTO public.bounty_moderation AS m (bounty_id, state, review_started_at)
      VALUES (v_target.id, 'under_review', now())
      ON CONFLICT (bounty_id) DO UPDATE SET
        state             = 'under_review',
        review_started_at = COALESCE(m.review_started_at, now()),
        updated_at        = now();

      INSERT INTO public.bounty_moderation_events
        (bounty_id, from_state, to_state, actor, reason, metadata)
      VALUES (v_target.id, v_from, 'under_review', 'system', v_reason,
              jsonb_build_object('rule', v_rule, 'report_id', NEW.id, 'distinct_reporters', v_reporters,
                                 'poster_account_age_hours', round(extract(epoch FROM v_age) / 3600.0, 1)));

      INSERT INTO public.moderation_alerts
        (alert_key, threshold_key, bounty_id, poster_id, severity, summary, detail)
      VALUES (
        'report_threshold:' || v_target.id::text,
        'report_threshold', v_target.id, v_target.poster_id, 'high',
        'Hidden from the feed for review: ' || v_reason || ' ("' || left(coalesce(v_target.title, ''), 80) || '").',
        jsonb_build_object('rule', v_rule, 'distinct_reporters', v_reporters, 'report_id', NEW.id))
      ON CONFLICT (alert_key) DO UPDATE SET
        summary = EXCLUDED.summary, detail = EXCLUDED.detail,
        created_at = now(), fanned_out_at = NULL, acknowledged_at = NULL, acknowledged_by = NULL;

      IF to_regprocedure(
           'public.record_bounty_event(text,text,text,uuid,uuid,timestamptz,numeric,text,jsonb)'
         ) IS NOT NULL THEN
        PERFORM public.record_bounty_event(
          'moderation.state_changed:' || v_target.id::text || ':report:' || NEW.id::text,
          'moderation.state_changed', 'system', v_target.id, NULL, now(), NULL, NULL,
          jsonb_build_object('from', v_from, 'to', 'under_review', 'reason', v_reason, 'rule', v_rule));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'trg_fn_reports_moderation_action failed for bounty % (report %): %',
        v_target.id, NEW.id, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_fn_reports_moderation_action failed for report %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reports_moderation_action ON public.reports;
CREATE TRIGGER trg_reports_moderation_action
  AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_reports_moderation_action();

-- report_submitted (server-side PostHog event, emitted by moderation-sweep).
-- Pending = not yet captured. Properties describe what the server did.
CREATE OR REPLACE FUNCTION public.moderation_report_events_pending(p_limit integer DEFAULT 200)
 RETURNS TABLE (
   report_id uuid, reporter_id uuid, content_type text, content_id uuid, reason text,
   reported_at timestamptz, bounty_id uuid, poster_id uuid, poster_account_age_days integer,
   moderation_state text, moved_to_review boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT r.id, r.reporter_id, r.content_type, r.content_id, r.reason,
         r.created_at AT TIME ZONE 'UTC',
         b.id,
         COALESCE(b.poster_id, b.user_id, CASE WHEN r.content_type = 'profile' THEN r.content_id END),
         floor(extract(epoch FROM now() - p.created_at) / 86400)::int,
         m.state,
         EXISTS (SELECT 1 FROM public.bounty_moderation_events e
                 WHERE e.to_state = 'under_review' AND e.actor = 'system'
                   AND e.metadata ->> 'report_id' = r.id::text)
  FROM public.reports r
  LEFT JOIN public.bounties b
         ON r.content_type = 'bounty' AND b.id = r.content_id
  LEFT JOIN public.profiles p
         ON p.id = COALESCE(b.poster_id, b.user_id, CASE WHEN r.content_type = 'profile' THEN r.content_id END)
  LEFT JOIN public.bounty_moderation m ON m.bounty_id = b.id
  WHERE r.analytics_captured_at IS NULL
  ORDER BY r.created_at
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000));
$function$;

CREATE OR REPLACE FUNCTION public.moderation_mark_report_events_captured(p_report_ids uuid[])
 RETURNS integer
 LANGUAGE sql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH u AS (
    UPDATE public.reports SET analytics_captured_at = now()
    WHERE id = ANY (p_report_ids) AND analytics_captured_at IS NULL
    RETURNING 1)
  SELECT count(*)::int FROM u;
$function$;

REVOKE ALL ON FUNCTION public.moderation_report_events_pending(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.moderation_report_events_pending(integer) TO service_role;
REVOKE ALL ON FUNCTION public.moderation_mark_report_events_captured(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.moderation_mark_report_events_captured(uuid[]) TO service_role;

COMMIT;
