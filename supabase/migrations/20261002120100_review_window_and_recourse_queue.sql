-- Deadlines and recourse for both sides (trust-spine audit 2026-09-30, T6 / T22,
-- Top improvement #6). Phase A: human escalation only. Nothing here moves money.
--
-- T6  A hunter's submission had no deadline. Prod 2026-10-02: 5 submissions
--     pending, the oldest external funded one ($5, eccfddee) since 2026-08-18.
-- T22 A poster whose hunter vanished had no working path: the dispute screen
--     required a cancellation request that posters cannot file.
--
-- 1. completion_review_policy  one row: the 72h window, the 24h/48h reminder
--    points, and rollout_at, the no-retroactive-burst watermark.
-- 2. completion_submissions    reminder / escalation watermarks.
-- 3. bounty_disputes.reason_code, so "Hunter hasn't responded" is a category
--    support can filter on rather than free text.
-- 4. trust_review_queue        the support/founder queue. One row per overdue
--    review and one per dispute. Admin-read only; written only by this
--    migration's SECURITY DEFINER functions and admin RPCs.
-- 5. trg_bounty_disputes_enqueue_review   every new dispute becomes a queue
--    item and pages internal admins.
-- 6. fn_process_completion_review_window  cron, every 15 min:
--      +24h  poster reminder      (review_needed / review_reminder)
--      +48h  last-day reminder    (review_needed / review_reminder)
--      +72h  queue item, bounty_events 'completion_review_overdue', poster +
--            hunter told support is reviewing, internal admins paged
--    then closes queue items whose outcome is already decided.
--    It does NOT approve, release or refund anything (Phase B, see
--    docs/security/escrow-recourse-review-window-2026-10-02.md).
-- 7. fn_completion_auto_release_blockers  shadow evaluation of the Phase B
--    rule, recorded on every escalation so ~20 real cases show whether the
--    rule would have been right before it is ever allowed to release money.
-- 8. Admin RPCs: queue read, queue update, Phase B readiness report.
--
-- Depends on: record_bounty_event (20260828130000), fn_admin_recipient_ids,
-- record_job_heartbeat + job_health_expectations (20260925120000),
-- admin_assert_role, get_display_name, is_account_active.
--
-- Rollback: supabase/rollbacks/production/20261002120100_review_window_and_recourse_queue.down.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Policy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.completion_review_policy (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  window_hours           integer NOT NULL DEFAULT 72 CHECK (window_hours BETWEEN 24 AND 336),
  first_reminder_hours   integer NOT NULL DEFAULT 24,
  second_reminder_hours  integer NOT NULL DEFAULT 48,
  -- Thresholds crossed before this moment never notify anyone: the people
  -- involved were never told a deadline existed. Already-overdue reviews are
  -- still queued for support, silently, flagged legacy.
  rollout_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (0 < first_reminder_hours
         AND first_reminder_hours < second_reminder_hours
         AND second_reminder_hours < window_hours)
);
INSERT INTO public.completion_review_policy (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.completion_review_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.completion_review_policy FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Submission watermarks (server-owned: fn_completion_submissions_guard
--    refuses client changes to every column outside its per-party allowlist)
-- ---------------------------------------------------------------------------
ALTER TABLE public.completion_submissions
  ADD COLUMN IF NOT EXISTS review_reminder_24h_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_reminder_48h_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_escalated_at         timestamptz;

CREATE INDEX IF NOT EXISTS completion_submissions_pending_review_idx
  ON public.completion_submissions (submitted_at)
  WHERE status = 'pending' AND review_escalated_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Dispute reason category
-- ---------------------------------------------------------------------------
ALTER TABLE public.bounty_disputes
  ADD COLUMN IF NOT EXISTS reason_code text;

ALTER TABLE public.bounty_disputes
  DROP CONSTRAINT IF EXISTS bounty_disputes_reason_code_check;
ALTER TABLE public.bounty_disputes
  ADD CONSTRAINT bounty_disputes_reason_code_check CHECK (
    reason_code IS NULL OR reason_code IN (
      'hunter_unresponsive', 'poster_unresponsive', 'work_quality',
      'scope_disagreement', 'missed_deadline', 'communication', 'other'
    )
  );

-- ---------------------------------------------------------------------------
-- 4. The queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trust_review_queue (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                   text NOT NULL CHECK (kind IN ('completion_review_overdue', 'dispute')),
  reason_code            text,
  bounty_id              uuid REFERENCES public.bounties (id) ON DELETE SET NULL,
  submission_id          uuid REFERENCES public.completion_submissions (id) ON DELETE SET NULL,
  dispute_id             integer REFERENCES public.bounty_disputes (id) ON DELETE SET NULL,
  poster_id              uuid,
  hunter_id              uuid,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'contacted', 'resolved')),
  opened_at              timestamptz NOT NULL DEFAULT now(),
  -- completion_review_overdue: the deadline that passed.
  due_at                 timestamptz,
  -- Snapshot for triage: hours since acceptance / submission, last message
  -- from each side, amount, legacy flag, internal flag.
  facts                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Phase B shadow: would the auto-release rule have released this one?
  auto_release_eligible  boolean,
  auto_release_blockers  text[],
  resolution             text CHECK (resolution IS NULL OR resolution IN (
                           'poster_approved', 'poster_requested_revision', 'poster_rejected',
                           'disputed', 'bounty_closed',
                           'dispute_resolved_poster', 'dispute_resolved_hunter', 'dispute_closed',
                           'released_by_support', 'refunded_by_support', 'hunter_cancelled',
                           'no_action_needed', 'other')),
  resolution_source      text CHECK (resolution_source IS NULL OR resolution_source IN ('system', 'admin')),
  resolved_at            timestamptz,
  resolved_by            uuid,
  notes                  text,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL AND resolution IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS trust_review_queue_one_per_submission
  ON public.trust_review_queue (submission_id) WHERE kind = 'completion_review_overdue';
CREATE UNIQUE INDEX IF NOT EXISTS trust_review_queue_one_per_dispute
  ON public.trust_review_queue (dispute_id) WHERE kind = 'dispute';
CREATE INDEX IF NOT EXISTS trust_review_queue_open_idx
  ON public.trust_review_queue (opened_at) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS trust_review_queue_bounty_idx
  ON public.trust_review_queue (bounty_id);

ALTER TABLE public.trust_review_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trust_review_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.trust_review_queue TO authenticated;

DROP POLICY IF EXISTS trust_review_queue_select_admin ON public.trust_review_queue;
CREATE POLICY trust_review_queue_select_admin
  ON public.trust_review_queue FOR SELECT TO authenticated
  USING (COALESCE((SELECT auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Internal admins only, the same audience fn_check_job_health pages.
CREATE OR REPLACE FUNCTION public.fn_trust_review_page_admins(p_title text, p_body text, p_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_recipients uuid[];
BEGIN
  SELECT COALESCE(array_agg(a.id), '{}'::uuid[]) INTO v_recipients
  FROM unnest(public.fn_admin_recipient_ids()) AS a(id)
  JOIN public.profiles p ON p.id = a.id
  WHERE p.is_internal;

  IF array_length(v_recipients, 1) IS NULL THEN
    RAISE WARNING 'fn_trust_review_page_admins: no internal admin recipient for "%"', p_title;
    RETURN;
  END IF;

  INSERT INTO public.notifications_outbox (recipients, title, body, data)
  VALUES (to_jsonb(v_recipients), p_title, p_body,
          jsonb_build_object('type', 'reconciliation_alert', 'ops_alert', true, 'trust_review', true)
            || COALESCE(p_data, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.fn_trust_review_page_admins(text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Facts support needs to triage a stalled bounty, from either side.
CREATE OR REPLACE FUNCTION public.fn_bounty_party_activity(p_bounty_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH b AS (
    SELECT b.id, b.accepted_by, COALESCE(b.poster_id, b.user_id) AS poster_id,
           b.amount, COALESCE(b.is_for_honor, false) AS is_for_honor, b.status::text AS status
    FROM public.bounties b WHERE b.id = p_bounty_id
  ),
  acc AS (
    SELECT max(COALESCE(br.accepted_at, br.updated_at)) AS accepted_at
    FROM public.bounty_requests br, b
    WHERE br.bounty_id = b.id AND br.hunter_id = b.accepted_by AND br.status::text = 'accepted'
  ),
  msg AS (
    SELECT max(m.created_at) FILTER (WHERE m.sender_id = b.accepted_by) AS hunter_last_message_at,
           max(m.created_at) FILTER (WHERE m.sender_id = b.poster_id)   AS poster_last_message_at
    FROM b
    JOIN public.conversations c ON c.bounty_id = b.id
    JOIN public.messages m ON m.conversation_id = c.id
  ),
  sub AS (
    SELECT count(*) AS submissions,
           max(cs.submitted_at) AS last_submitted_at
    FROM public.completion_submissions cs, b
    WHERE cs.bounty_id = b.id AND cs.hunter_id = b.accepted_by
  )
  SELECT jsonb_build_object(
    'bounty_status', b.status,
    'amount', b.amount,
    'is_for_honor', b.is_for_honor,
    'accepted_at', acc.accepted_at,
    'hours_since_acceptance', round((extract(epoch FROM now() - acc.accepted_at) / 3600.0)::numeric, 1),
    'hunter_last_message_at', msg.hunter_last_message_at,
    'poster_last_message_at', msg.poster_last_message_at,
    'submissions', sub.submissions,
    'last_submitted_at', sub.last_submitted_at,
    'poster_is_internal', COALESCE((SELECT p.is_internal FROM public.profiles p WHERE p.id = b.poster_id), false)
  )
  FROM b LEFT JOIN acc ON true LEFT JOIN msg ON true LEFT JOIN sub ON true;
$$;
REVOKE ALL ON FUNCTION public.fn_bounty_party_activity(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Phase B rule, evaluated in shadow only.
--    Empty array = the rule would auto-release. Phase B must call this same
--    function so the observed shadow results describe the real rule.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_completion_auto_release_blockers(p_submission_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  cs public.completion_submissions%ROWTYPE;
  b  public.bounties%ROWTYPE;
  v  text[] := '{}';
  v_policy public.completion_review_policy%ROWTYPE;
  v_funding_state text;
BEGIN
  SELECT * INTO cs FROM public.completion_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RETURN ARRAY['submission_not_found']; END IF;
  SELECT * INTO b FROM public.bounties WHERE id = cs.bounty_id;
  IF NOT FOUND THEN RETURN ARRAY['bounty_not_found']; END IF;
  SELECT * INTO v_policy FROM public.completion_review_policy WHERE id;

  IF cs.status <> 'pending' THEN v := array_append(v, 'submission_not_pending'); END IF;
  IF cs.submitted_at > now() - make_interval(hours => v_policy.window_hours) THEN
    v := array_append(v, 'window_not_elapsed');
  END IF;
  IF b.status::text <> 'in_progress' THEN v := array_append(v, 'bounty_not_in_progress'); END IF;
  -- Valid submission: from the accepted hunter, with something in it.
  IF b.accepted_by IS DISTINCT FROM cs.hunter_id THEN v := array_append(v, 'submitter_not_accepted_hunter'); END IF;
  IF COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(cs.proof_items) = 'array' THEN cs.proof_items END), 0) = 0
     AND COALESCE(btrim(cs.message), '') = ''
  THEN
    v := array_append(v, 'empty_submission');
  END IF;
  -- No revision request, ever, on this bounty.
  IF EXISTS (SELECT 1 FROM public.completion_submissions o
              WHERE o.bounty_id = cs.bounty_id AND o.status = 'revision_requested') THEN
    v := array_append(v, 'revision_requested_before');
  END IF;
  -- No dispute, ever, on this bounty (open or decided).
  IF EXISTS (SELECT 1 FROM public.bounty_disputes d WHERE d.bounty_id = cs.bounty_id) THEN
    v := array_append(v, 'dispute_on_record');
  END IF;
  IF EXISTS (SELECT 1 FROM public.bounty_cancellations bc
              WHERE bc.bounty_id = cs.bounty_id AND bc.status IN ('pending', 'disputed')) THEN
    v := array_append(v, 'cancellation_pending');
  END IF;
  IF NOT public.is_account_active(cs.hunter_id) THEN v := array_append(v, 'hunter_account_not_active'); END IF;
  -- Payment state is architecture-specific. Only completed v1 ledger rows and
  -- canonical v2/v3 payment states can prove escrow is available or settled.
  CASE COALESCE(b.payment_architecture_version, 1)
    WHEN 1 THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.wallet_transactions wt
         WHERE wt.bounty_id = cs.bounty_id
           AND wt.type::text = 'escrow'
           AND wt.status::text = 'completed'
      ) THEN
        v := array_append(v, 'escrow_not_funded');
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.wallet_transactions wt
         WHERE wt.bounty_id = cs.bounty_id
           AND wt.type::text IN ('release', 'refund')
           AND wt.status::text = 'completed'
      ) THEN
        v := array_append(v, 'payment_already_settled');
      END IF;
    WHEN 2 THEN
      IF EXISTS (
        SELECT 1 FROM public.bounty_payments bp
         WHERE bp.bounty_id = cs.bounty_id
           AND bp.status IN ('released', 'refunded')
      ) THEN
        v := array_append(v, 'payment_already_settled');
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.bounty_payments bp
         WHERE bp.bounty_id = cs.bounty_id
           AND bp.status IN ('release_pending', 'refund_pending')
      ) THEN
        v := array_append(v, 'payment_settlement_pending');
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.bounty_payments bp
         WHERE bp.bounty_id = cs.bounty_id
           AND bp.status IN ('authorized', 'captured')
      ) THEN
        v := array_append(v, 'escrow_not_funded');
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.bounty_payments bp
         WHERE bp.bounty_id = cs.bounty_id
           AND bp.status = 'disputed'
      ) THEN
        v := array_append(v, 'payment_disputed');
      END IF;
    WHEN 3 THEN
      SELECT bf.state INTO v_funding_state
        FROM public.bounty_v3_funding bf
       WHERE bf.bounty_id = cs.bounty_id;
      IF v_funding_state = 'released' THEN
        v := array_append(v, 'payment_already_settled');
      ELSIF v_funding_state = 'capturing' THEN
        v := array_append(v, 'payment_settlement_pending');
      END IF;
      IF v_funding_state IS DISTINCT FROM 'authorized'
         AND v_funding_state IS DISTINCT FROM 'awaiting_hunter_onboarding'
      THEN
        v := array_append(v, 'escrow_not_funded');
      END IF;
    ELSE
      v := array_append(v, 'unsupported_payment_architecture');
  END CASE;
  -- Nothing to release. Phase B would still need a policy for approving
  -- for-honor work on the poster's behalf.
  IF COALESCE(b.is_for_honor, false) OR COALESCE(b.amount, 0) <= 0 THEN
    v := array_append(v, 'no_escrow_for_honor');
  END IF;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_completion_auto_release_blockers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_completion_auto_release_blockers(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Every new dispute is a support item
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_bounty_disputes_enqueue_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  b          record;
  v_role     text;
  v_facts    jsonb;
  v_item     uuid;
  v_title    text;
  v_reason   text;
BEGIN
  SELECT x.id, x.title, x.accepted_by, COALESCE(x.poster_id, x.user_id) AS poster_id
    INTO b FROM public.bounties x WHERE x.id = NEW.bounty_id;

  v_role := CASE
    WHEN NEW.stripe_dispute_id IS NOT NULL THEN 'card_network'
    WHEN NEW.initiator_id = b.poster_id THEN 'poster'
    WHEN NEW.initiator_id = b.accepted_by THEN 'hunter'
    ELSE 'other'
  END;
  v_facts := COALESCE(public.fn_bounty_party_activity(NEW.bounty_id), '{}'::jsonb)
             || jsonb_build_object('initiator_role', v_role, 'dispute_stage', NEW.dispute_stage);

  INSERT INTO public.trust_review_queue
    (kind, reason_code, bounty_id, dispute_id, poster_id, hunter_id, facts)
  VALUES
    ('dispute', NEW.reason_code,
     NEW.bounty_id, NEW.id, b.poster_id, b.accepted_by, v_facts)
  ON CONFLICT (dispute_id) WHERE kind = 'dispute' DO NOTHING
  RETURNING id INTO v_item;

  IF v_item IS NOT NULL THEN
    v_title := left(COALESCE(NULLIF(btrim(b.title), ''), 'a bounty'), 60);
    v_reason := CASE NEW.reason_code
      WHEN 'hunter_unresponsive' THEN 'Poster says the hunter hasn''t responded'
      WHEN 'poster_unresponsive' THEN 'Hunter says the poster hasn''t responded'
      ELSE initcap(v_role) || ' opened a dispute'
    END;
    PERFORM public.fn_trust_review_page_admins(
      '[Support] ' || v_reason,
      '"' || v_title || '": ' || left(COALESCE(NEW.reason, ''), 140),
      jsonb_build_object('queueItemId', v_item, 'disputeId', NEW.id,
                         'bounty_id', NEW.bounty_id, 'bountyId', NEW.bounty_id)
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the dispute itself on queue bookkeeping; the cron's
  -- reconcile pass and the admin disputes screen still see the dispute.
  RAISE WARNING 'trg_fn_bounty_disputes_enqueue_review: dispute % not queued: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_fn_bounty_disputes_enqueue_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bounty_disputes_enqueue_review ON public.bounty_disputes;
CREATE TRIGGER trg_bounty_disputes_enqueue_review
  AFTER INSERT ON public.bounty_disputes
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_bounty_disputes_enqueue_review();

-- ---------------------------------------------------------------------------
-- 6. The review window
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_process_completion_review_window()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_policy     public.completion_review_policy%ROWTYPE;
  r            record;
  v_due        timestamptz;
  v_t1         timestamptz;
  v_t2         timestamptz;
  v_hunter     text;
  v_title      text;
  v_blockers   text[];
  v_item       uuid;
  v_legacy     boolean;
  v_reminded   integer := 0;
  v_escalated  integer := 0;
  v_legacy_esc integer := 0;
  v_closed     integer := 0;
  v_errors     integer := 0;
  v_new_items  jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_policy FROM public.completion_review_policy WHERE id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'completion_review_policy row missing';
  END IF;

  -- ── A. Close queue items whose outcome has been decided ────────────────
  WITH decided AS (
    SELECT q.id,
           CASE
             WHEN cs.status = 'approved'           THEN 'poster_approved'
             WHEN cs.status = 'revision_requested' THEN 'poster_requested_revision'
             WHEN cs.status = 'rejected'           THEN 'poster_rejected'
             WHEN EXISTS (SELECT 1 FROM public.bounty_disputes d
                           WHERE d.bounty_id = q.bounty_id AND d.created_at >= q.opened_at AT TIME ZONE 'UTC')
                                                   THEN 'disputed'
             WHEN b.id IS NULL OR b.status::text <> 'in_progress' THEN 'bounty_closed'
           END AS resolution
    FROM public.trust_review_queue q
    LEFT JOIN public.completion_submissions cs ON cs.id = q.submission_id
    LEFT JOIN public.bounties b ON b.id = q.bounty_id
    WHERE q.kind = 'completion_review_overdue' AND q.status <> 'resolved'
    UNION ALL
    SELECT q.id,
           CASE
             WHEN d.id IS NULL OR d.status IN ('open', 'under_review') THEN NULL
             WHEN d.status = 'resolved_poster_wins' THEN 'dispute_resolved_poster'
             WHEN d.status = 'resolved_hunter_wins' THEN 'dispute_resolved_hunter'
             ELSE 'dispute_closed'
           END
    FROM public.trust_review_queue q
    LEFT JOIN public.bounty_disputes d ON d.id = q.dispute_id
    WHERE q.kind = 'dispute' AND q.status <> 'resolved'
  )
  UPDATE public.trust_review_queue q
     SET status = 'resolved', resolution = decided.resolution, resolution_source = 'system',
         resolved_at = now(), updated_at = now()
    FROM decided
   WHERE q.id = decided.id AND decided.resolution IS NOT NULL;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  -- ── B. Reminders and escalation ────────────────────────────────────────
  FOR r IN
    SELECT cs.id AS submission_id, cs.bounty_id, cs.hunter_id, cs.submitted_at,
           cs.review_reminder_24h_sent_at AS r24, cs.review_reminder_48h_sent_at AS r48,
           COALESCE(b.poster_id, b.user_id) AS poster_id, b.title, b.amount, b.is_for_honor
    FROM public.completion_submissions cs
    JOIN public.bounties b ON b.id = cs.bounty_id
    WHERE cs.status = 'pending'
      AND cs.review_escalated_at IS NULL
      AND cs.submitted_at <= now() - make_interval(hours => v_policy.first_reminder_hours)
      AND b.status::text = 'in_progress'
      AND b.accepted_by = cs.hunter_id
      AND COALESCE(b.poster_id, b.user_id) IS NOT NULL
      -- Support already owns a disputed bounty.
      AND NOT EXISTS (SELECT 1 FROM public.bounty_disputes d
                       WHERE d.bounty_id = cs.bounty_id AND d.status IN ('open', 'under_review'))
      -- Only the latest submission on the bounty runs a clock.
      AND NOT EXISTS (SELECT 1 FROM public.completion_submissions n
                       WHERE n.bounty_id = cs.bounty_id AND n.submitted_at > cs.submitted_at)
    ORDER BY cs.submitted_at
    FOR UPDATE OF cs SKIP LOCKED
  LOOP
    BEGIN
      v_due := r.submitted_at + make_interval(hours => v_policy.window_hours);
      v_t1  := r.submitted_at + make_interval(hours => v_policy.first_reminder_hours);
      v_t2  := r.submitted_at + make_interval(hours => v_policy.second_reminder_hours);
      v_hunter := public.get_display_name(r.hunter_id);
      v_title  := left(COALESCE(NULLIF(btrim(r.title), ''), 'your bounty'), 80);

      IF now() >= v_due THEN
        -- ── 72h: hand it to a human ──
        v_legacy   := v_due < v_policy.rollout_at;
        v_blockers := public.fn_completion_auto_release_blockers(r.submission_id);

        INSERT INTO public.trust_review_queue
          (kind, bounty_id, submission_id, poster_id, hunter_id, due_at, facts,
           auto_release_eligible, auto_release_blockers)
        VALUES
          ('completion_review_overdue', r.bounty_id, r.submission_id, r.poster_id, r.hunter_id, v_due,
           COALESCE(public.fn_bounty_party_activity(r.bounty_id), '{}'::jsonb)
             || jsonb_build_object('legacy', v_legacy, 'submitted_at', r.submitted_at,
                                   'reminders_sent', (r.r24 IS NOT NULL)::int + (r.r48 IS NOT NULL)::int),
           cardinality(v_blockers) = 0, v_blockers)
        ON CONFLICT (submission_id) WHERE kind = 'completion_review_overdue' DO NOTHING
        RETURNING id INTO v_item;

        UPDATE public.completion_submissions SET review_escalated_at = now() WHERE id = r.submission_id;

        PERFORM public.record_bounty_event(
          'completion_review_overdue:' || r.submission_id::text,
          'completion_review_overdue', 'system', r.bounty_id, NULL, v_due, r.amount,
          r.submission_id::text,
          jsonb_build_object('submission_id', r.submission_id, 'hunter_id', r.hunter_id,
                             'poster_id', r.poster_id, 'legacy', v_legacy,
                             'auto_release_eligible', cardinality(v_blockers) = 0,
                             'auto_release_blockers', to_jsonb(v_blockers),
                             'queue_item_id', v_item));

        IF v_legacy THEN
          v_legacy_esc := v_legacy_esc + 1;
        ELSE
          v_escalated := v_escalated + 1;
          INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
          VALUES (
            jsonb_build_array(r.poster_id),
            'Bounty support is reviewing',
            'You didn''t respond to ' || v_hunter || '''s work on "' || v_title
              || '" within ' || v_policy.window_hours || ' hours, so Bounty support is reviewing it now. '
              || 'You can still approve it or report a problem in the app.',
            jsonb_build_object('type', 'review_needed', 'subtype', 'review_escalated',
                               'bounty_id', r.bounty_id, 'bountyId', r.bounty_id,
                               'submission_id', r.submission_id, 'hunter_id', r.hunter_id,
                               'hunterId', r.hunter_id),
            r.bounty_id::text);
          INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
          VALUES (
            jsonb_build_array(r.hunter_id),
            'Bounty support is following up',
            'The poster hasn''t responded to your work on "' || v_title || '" in '
              || v_policy.window_hours || ' hours. Bounty support is reviewing it now and will let you know what happens.',
            jsonb_build_object('type', 'completion', 'subtype', 'review_escalated',
                               'bounty_id', r.bounty_id, 'bountyId', r.bounty_id,
                               'submission_id', r.submission_id),
            r.bounty_id::text);
        END IF;

        IF v_item IS NOT NULL THEN
          v_new_items := v_new_items || jsonb_build_object(
            'queueItemId', v_item, 'bountyId', r.bounty_id, 'title', v_title,
            'legacy', v_legacy, 'shadowEligible', cardinality(v_blockers) = 0);
        END IF;

      ELSIF now() >= v_t2 AND r.r48 IS NULL THEN
        -- ── 48h: last day. Notify only if the threshold passed after rollout. ──
        IF v_t2 >= v_policy.rollout_at THEN
          INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
          VALUES (
            jsonb_build_array(r.poster_id),
            'Last day to review',
            'Approve ' || v_hunter || '''s work on "' || v_title
              || '" or report a problem within 24 hours. After that, Bounty support reviews it.',
            jsonb_build_object('type', 'review_needed', 'subtype', 'review_reminder', 'stage', 'final',
                               'due_at', v_due, 'bounty_id', r.bounty_id, 'bountyId', r.bounty_id,
                               'submission_id', r.submission_id, 'hunter_id', r.hunter_id,
                               'hunterId', r.hunter_id),
            r.bounty_id::text);
          v_reminded := v_reminded + 1;
        END IF;
        -- One reminder per run: a late cron never sends 24h and 48h together.
        UPDATE public.completion_submissions
           SET review_reminder_48h_sent_at = now(),
               review_reminder_24h_sent_at = COALESCE(review_reminder_24h_sent_at, now())
         WHERE id = r.submission_id;

      ELSIF now() >= v_t1 AND r.r24 IS NULL THEN
        -- ── 24h ──
        IF v_t1 >= v_policy.rollout_at THEN
          INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
          VALUES (
            jsonb_build_array(r.poster_id),
            v_hunter || ' is waiting on your review',
            'Approve the work on "' || v_title || '" or report a problem within '
              || (v_policy.window_hours - v_policy.first_reminder_hours)
              || ' hours. After that, Bounty support reviews it.',
            jsonb_build_object('type', 'review_needed', 'subtype', 'review_reminder', 'stage', 'first',
                               'due_at', v_due, 'bounty_id', r.bounty_id, 'bountyId', r.bounty_id,
                               'submission_id', r.submission_id, 'hunter_id', r.hunter_id,
                               'hunterId', r.hunter_id),
            r.bounty_id::text);
          v_reminded := v_reminded + 1;
        END IF;
        UPDATE public.completion_submissions SET review_reminder_24h_sent_at = now()
         WHERE id = r.submission_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'fn_process_completion_review_window: submission % skipped: %', r.submission_id, SQLERRM;
    END;
  END LOOP;

  -- ── C. One page per run for whatever was newly escalated ───────────────
  IF jsonb_array_length(v_new_items) > 0 THEN
    PERFORM public.fn_trust_review_page_admins(
      '[Support] ' || jsonb_array_length(v_new_items) || ' review'
        || CASE WHEN jsonb_array_length(v_new_items) = 1 THEN '' ELSE 's' END
        || ' passed the ' || v_policy.window_hours || 'h window',
      (SELECT string_agg('"' || (i ->> 'title') || '"'
                         || CASE WHEN (i ->> 'legacy')::boolean THEN ' (pre-rollout)' ELSE '' END, ', ')
         FROM jsonb_array_elements(v_new_items) AS i),
      jsonb_build_object('items', v_new_items));
  END IF;

  RETURN jsonb_build_object(
    'reminders_sent', v_reminded, 'escalated', v_escalated, 'escalated_legacy', v_legacy_esc,
    'queue_items_closed', v_closed, 'errors', v_errors);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_process_completion_review_window() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_process_completion_review_window() TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Admin RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_trust_review_queue(p_include_resolved boolean DEFAULT false)
RETURNS TABLE (
  id uuid, kind text, reason_code text, status text, opened_at timestamptz, due_at timestamptz,
  bounty_id uuid, bounty_title text, bounty_status text, amount numeric, is_for_honor boolean,
  poster_id uuid, poster_name text, hunter_id uuid, hunter_name text,
  submission_id uuid, dispute_id integer, dispute_reason text,
  auto_release_eligible boolean, auto_release_blockers text[], facts jsonb,
  resolution text, resolution_source text, resolved_at timestamptz, notes text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.admin_assert_role();
  RETURN QUERY
  SELECT q.id, q.kind, q.reason_code, q.status, q.opened_at, q.due_at,
         q.bounty_id, b.title, b.status::text, b.amount, COALESCE(b.is_for_honor, false),
         q.poster_id, public.get_display_name(q.poster_id), q.hunter_id, public.get_display_name(q.hunter_id),
         q.submission_id, q.dispute_id, d.reason,
         q.auto_release_eligible, q.auto_release_blockers, q.facts,
         q.resolution, q.resolution_source, q.resolved_at, q.notes
  FROM public.trust_review_queue q
  LEFT JOIN public.bounties b ON b.id = q.bounty_id
  LEFT JOIN public.bounty_disputes d ON d.id = q.dispute_id
  WHERE p_include_resolved OR q.status <> 'resolved'
  ORDER BY (q.status = 'resolved'), q.opened_at
  LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_trust_review_queue(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_trust_review_queue(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_trust_review_item(
  p_id uuid, p_status text, p_resolution text DEFAULT NULL, p_notes text DEFAULT NULL
)
RETURNS public.trust_review_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.trust_review_queue%ROWTYPE;
BEGIN
  PERFORM public.admin_assert_role();
  IF p_status NOT IN ('open', 'contacted', 'resolved') THEN
    RAISE EXCEPTION 'invalid_status: %', p_status USING ERRCODE = '22023';
  END IF;
  IF p_status = 'resolved' AND p_resolution IS NULL THEN
    RAISE EXCEPTION 'resolution_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.trust_review_queue q
     SET status            = p_status,
         resolution        = CASE WHEN p_status = 'resolved' THEN p_resolution END,
         resolution_source = CASE WHEN p_status = 'resolved' THEN 'admin' END,
         resolved_at       = CASE WHEN p_status = 'resolved' THEN now() END,
         resolved_by       = CASE WHEN p_status = 'resolved' THEN auth.uid() END,
         notes             = COALESCE(p_notes, q.notes),
         updated_at        = now()
   WHERE q.id = p_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'queue_item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_trust_review_item(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_trust_review_item(uuid, text, text, text) TO authenticated;

-- The Phase B gate. "Would the auto-release rule have been right?" is
-- answered by what posters and support actually did with shadow-eligible
-- escalations. Excludes pre-rollout and internal-poster cases.
CREATE OR REPLACE FUNCTION public.admin_review_window_report()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v jsonb;
BEGIN
  PERFORM public.admin_assert_role();
  WITH esc AS (
    SELECT q.* FROM public.trust_review_queue q
    WHERE q.kind = 'completion_review_overdue'
      AND NOT COALESCE((q.facts ->> 'legacy')::boolean, false)
      AND NOT COALESCE((q.facts ->> 'poster_is_internal')::boolean, false)
  ),
  decisions AS (
    SELECT extract(epoch FROM cs.reviewed_at - cs.submitted_at) / 3600.0 AS hours
    FROM public.completion_submissions cs
    JOIN public.bounties b ON b.id = cs.bounty_id
    JOIN public.profiles p ON p.id = COALESCE(b.poster_id, b.user_id)
    WHERE cs.reviewed_at IS NOT NULL
      AND cs.submitted_at >= (SELECT rollout_at FROM public.completion_review_policy WHERE id)
      AND NOT COALESCE(p.is_internal, false)
  )
  SELECT jsonb_build_object(
    'observed_escalations', (SELECT count(*) FROM esc),
    'resolved', (SELECT count(*) FROM esc WHERE status = 'resolved'),
    'by_resolution', (SELECT COALESCE(jsonb_object_agg(resolution, n), '{}'::jsonb)
                        FROM (SELECT resolution, count(*) n FROM esc WHERE status = 'resolved' GROUP BY 1) x),
    'shadow_eligible', (SELECT count(*) FROM esc WHERE auto_release_eligible),
    -- Eligible and the work was in the end paid for: auto-release would have
    -- reached the same outcome sooner.
    'shadow_eligible_confirmed', (SELECT count(*) FROM esc WHERE auto_release_eligible
                                    AND resolution IN ('poster_approved', 'released_by_support', 'dispute_resolved_hunter')),
    -- Eligible but the poster or support went the other way: auto-release
    -- would have paid for work that was later contested.
    'shadow_eligible_contradicted', (SELECT count(*) FROM esc WHERE auto_release_eligible
                                       AND resolution IN ('poster_requested_revision', 'poster_rejected', 'disputed',
                                                          'dispute_resolved_poster', 'refunded_by_support', 'hunter_cancelled')),
    'decision_hours_p50', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY hours)::numeric, 1) FROM decisions),
    'decision_hours_p90', (SELECT round(percentile_cont(0.9) WITHIN GROUP (ORDER BY hours)::numeric, 1) FROM decisions),
    'decisions_after_window_pct', (SELECT round(100.0 * avg((hours > (SELECT window_hours FROM public.completion_review_policy WHERE id))::int), 1) FROM decisions),
    'decisions_observed', (SELECT count(*) FROM decisions)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_window_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_window_report() TO authenticated;

-- ---------------------------------------------------------------------------
-- Schedule + health
-- ---------------------------------------------------------------------------
INSERT INTO public.job_health_expectations (job_name, max_silence, probe_sql, description)
VALUES ('completion-review-window', '45 minutes', NULL,
        'SQL job; fn_process_completion_review_window then heartbeat. Output: completion_submissions review_* stamps, trust_review_queue, bounty_events completion_review_overdue')
ON CONFLICT (job_name) DO UPDATE SET max_silence = EXCLUDED.max_silence, description = EXCLUDED.description;

DO $do$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'completion-review-window';
  PERFORM cron.schedule(
    'completion-review-window',
    '7,22,37,52 * * * *',
    $cmd$SELECT public.fn_process_completion_review_window(); SELECT public.record_job_heartbeat('completion-review-window');$cmd$
  );
END
$do$;

COMMIT;
