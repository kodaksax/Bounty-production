-- Migration: Retune moderation content signals, add real spam rules, harden
-- the sweep, and schedule it. Follows the 2026-08-29 moderation queue.
--
-- EVIDENCE (queried live 2026-09-12/13 against project xwlwqzzphmmhghiqvkeu):
--   * moderation_signals had written 19 rows since 2026-09-07, ALL
--     signal_type='no_actionable_task', and every one was on an
--     unambiguously actionable listing ("Mount my TV", "Move a couch",
--     "Hold my spot in the merch line", ...). Precision on that sample: 0/19.
--   * Root cause: the rule fired on `length(description) < 40 OR
--     no-task-verb-in-text`. In this product the description field is
--     almost always empty (the title *is* the task), so the length<40 arm
--     alone matched nearly every legitimate post, and the verb list
--     ("build|fix|deliver|...") could never keep up with ordinary task verbs
--     ("mount", "hold", "cut", "hem", "explain", "take", ...) -- open
--     vocabulary can't be enumerated. Per instruction: a 0%-precision
--     detector is worse than none, so this rule is REMOVED rather than
--     re-tuned; the 19 stale false-positive rows are deleted below.
--   * Meanwhile two live listings from the same poster (andrepace057) are
--     unflagged and status='in_progress':
--       "Www.andrepace057@instagram.com"
--       "Follow and purchase artworks form this artist : Andrepace057@gmail.com
--        Www.andrepace057@instagtam.com"
--     Neither matched any existing rule: the scanner had no email-address
--     detector at all, and the existing external_link pattern requires a
--     protocol or a handful of named platform domains with a trailing
--     slash. Fixed below with `email_address` + `bare_url_or_handle`.
--   * Three historical listings ("Will trim ... for 45$", "Will organize ...
--     for 51$", "Will braid ... 60$ ...") were is_for_honor=true with a
--     price embedded in the title -- an off-escrow payment offer. The
--     discriminating shape is the reversed order "45$" (digits then sign),
--     NOT the standard "$45": the platform's own legitimate for-honor post
--     ("What Would You Buy for $1?") uses the standard order and must not be
--     caught. Verified against every is_for_honor listing that has ever
--     contained a "$" (4 total, all time): the reversed-order pattern
--     matches exactly the 3 spam rows and none of the legitimate one.
--   * moderation_sweep_runs and moderation_alerts both had 0 rows -- not
--     because the sweep is failing, but because it has never been invoked:
--     the moderation-sweep edge function is deployed (confirmed ACTIVE) but
--     no cron job calls it (confirmed against cron.job -- 10 unrelated jobs
--     exist, none reference moderation-sweep or run_moderation_sweep).
--     Scheduled below. The edge function itself already fans alerts out to
--     every admin (in-app bell + push + email) -- that part just needed a
--     trigger.
--   * The `reports` table/UI path was checked end-to-end: report-service.ts
--     inserts correctly, RLS (reports_insert_own) allows it, and the report
--     icon in bountydetailmodal.tsx (+ profile and chat screens) calls it.
--     0 rows reflects that nobody has used it yet at this scale (23 external
--     bounties all time), not a wiring gap. No code change needed there.
--
-- VALIDATION (see PR/session notes for the exact queries run against prod):
--   * New email/bare-domain rules produce ZERO signals on all 19 former
--     false positives, and exactly 2 matches across every currently
--     open/in_progress/cancellation_requested bounty -- both are the real
--     andrepace057 spam. 2/2 precision on live data.
--   * The reversed-dollar for-honor rule matches exactly the 3 known spam
--     titles and none of the 1 legitimate for-honor "$"-bearing post, across
--     all 4 is_for_honor rows that have ever contained "$".

-- ============================================================================
-- 1. Retune moderation_scan_content: drop no_actionable_task, add real rules
-- ============================================================================
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
$$;
GRANT EXECUTE ON FUNCTION public.moderation_scan_content(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.moderation_scan_content(text, text) FROM anon;

-- Drop the 19 stale false-positive rows the removed rule wrote. None of them
-- ever reached bounty_moderation on their own (weight 1.0 < the queue floor
-- of 2), so there is no queue/flag state to unwind alongside them.
DELETE FROM public.moderation_signals WHERE signal_type = 'no_actionable_task';

-- ============================================================================
-- 2. Insert-time trigger: also score the reversed-price for-honor pattern,
--    and re-scan when is_for_honor changes (not just title/description).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_moderation_scan_bounty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

DROP TRIGGER IF EXISTS moderation_scan_bounty ON public.bounties;
CREATE TRIGGER moderation_scan_bounty
  AFTER INSERT OR UPDATE OF title, description, is_for_honor ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.trg_moderation_scan_bounty();

-- ============================================================================
-- 3. Sweep: widen scope past 'open' (the two live spam rows are
--    'in_progress'), add content-scan + honor-price + new-account-multi-post,
--    and make a failed run observable instead of silently never writing a
--    row (same class of bug as payout_audit_log's 0 rows).
-- ============================================================================
ALTER TABLE public.moderation_sweep_runs
  ADD COLUMN IF NOT EXISTS succeeded boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS error      text;

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
$$;
REVOKE ALL ON FUNCTION public.run_moderation_sweep() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_moderation_sweep() FROM anon;
REVOKE ALL ON FUNCTION public.run_moderation_sweep() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_moderation_sweep() TO service_role;

-- ============================================================================
-- 4. Schedule the sweep. The edge function was deployed 2026-08-29 but never
--    had a cron trigger (confirmed: no cron.job row references it or
--    run_moderation_sweep). It already fans every alert out to admins
--    in-app + push + email (supabase/functions/moderation-sweep/index.ts) --
--    that path just needed something to invoke it.
-- ============================================================================
DO $$
BEGIN
  PERFORM cron.unschedule('moderation-sweep-10min');
EXCEPTION WHEN OTHERS THEN
  NULL; -- no existing job with this name
END $$;

SELECT cron.schedule(
  'moderation-sweep-10min',
  '*/10 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_base_url') || '/moderation-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
