-- Minimum-viable ratings/reviews loop.
--
-- Problem: rating coverage is extremely low because the only nudge to rate a
-- hunter is a single in-the-moment star form the poster can dismiss with no
-- consequence and no follow-up, and the poster-facing "Jobs done" line has no
-- real average to show even when ratings do exist (get_profile_activity_stats
-- doesn't return one, so every caller was either omitting it or re-aggregating
-- the `ratings` table itself on every profile/applicant-list load).
--
-- This migration adds exactly the backend pieces the client-side loop needs:
--   1. rating_avg / rating_count on the existing profile-stats RPCs, so
--      callers stop hand-aggregating `ratings` per profile/list.
--   2. A single 24h-later reminder for a poster who approved a hunter's work
--      but never rated them, following the exact pattern already proven by
--      fn_remind_posters_of_pending_requests (20260913000000): a
--      once-only "sent" column plus a NOT EXISTS guard against the
--      ratings table, cron-polled every 15 minutes.
--
-- Deliberately NOT doing: a hunter-rates-poster flow. The existing
-- "Please rate the poster" hunter notification (20260812000000) has no
-- client screen behind it and stays that way here -- out of scope for a
-- poster-facing reputation feature; a separate decision, not an omission.

BEGIN;

-- ============================================================================
-- 1. rating_avg / rating_count on the profile-stats RPCs
--    CREATE OR REPLACE cannot change a RETURNS TABLE signature (42P13), so
--    both functions must be dropped and recreated -- same constraint noted in
--    20260914130000_fix_hunter_completed_activity_stat.sql.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_profile_activity_stats(uuid);

CREATE FUNCTION public.get_profile_activity_stats(target_user_id uuid)
RETURNS TABLE(
  bounties_posted int,
  bounties_completed int,
  hunter_completed int,
  first_bounty_posted_at timestamptz,
  rating_avg numeric,
  rating_count int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT
    (
      SELECT COUNT(*)::int FROM public.bounties b
      WHERE COALESCE(b.poster_id, b.user_id) = target_user_id
        AND b.status IN ('open', 'in_progress', 'completed')
    ) AS bounties_posted,
    (
      SELECT COUNT(*)::int FROM public.bounties b
      WHERE COALESCE(b.poster_id, b.user_id) = target_user_id
        AND b.status = 'completed'
    ) AS bounties_completed,
    (
      SELECT COUNT(*)::int FROM public.bounties b
      WHERE b.accepted_by = target_user_id
        AND b.status = 'completed'
    ) AS hunter_completed,
    (
      SELECT MIN(b.created_at) FROM public.bounties b
      WHERE COALESCE(b.poster_id, b.user_id) = target_user_id
        AND b.status IN ('open', 'in_progress', 'completed')
    ) AS first_bounty_posted_at,
    (
      -- Ratings RECEIVED by this user (to_user_id), i.e. their reputation as
      -- rated by whoever they worked for/with. NULL (not 0) with no ratings
      -- yet, so the client's "fewer than 3 -> don't show an average" rule
      -- (lib/utils/trust-summary.ts MIN_RATING_SAMPLE) can't misread a NULL
      -- as a real zero-star average.
      SELECT round(AVG(r.rating), 2) FROM public.ratings r
      WHERE r.to_user_id = target_user_id
    ) AS rating_avg,
    (
      SELECT COUNT(*)::int FROM public.ratings r
      WHERE r.to_user_id = target_user_id
    ) AS rating_count;
$$;

REVOKE ALL ON FUNCTION public.get_profile_activity_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_activity_stats(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_profile_activity_stats(uuid) IS
  'Marketplace-trust stats for a profile (own or another user''s). bounties_posted/bounties_completed are poster-side; hunter_completed is hunter-side "jobs I completed". rating_avg/rating_count (added 2026-09-14) are ratings RECEIVED by target_user_id, straight from the ratings table -- callers should stop hand-aggregating ratings once they read these. authenticated-only.';

DROP FUNCTION IF EXISTS public.get_profile_activity_stats_batch(uuid[]);

CREATE FUNCTION public.get_profile_activity_stats_batch(target_user_ids uuid[])
RETURNS TABLE(
  user_id uuid,
  bounties_posted int,
  bounties_completed int,
  hunter_completed int,
  first_bounty_posted_at timestamptz,
  rating_avg numeric,
  rating_count int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  with ids as (
    select unnest(target_user_ids) as id
  ),
  posted as (
    select coalesce(b.poster_id, b.user_id) as id, count(*) as n,
           min(b.created_at) as first_posted_at
    from public.bounties b
    where coalesce(b.poster_id, b.user_id) = any(target_user_ids)
      and b.status in ('open', 'in_progress', 'completed')
    group by coalesce(b.poster_id, b.user_id)
  ),
  posted_completed as (
    select coalesce(b.poster_id, b.user_id) as id, count(*) as n
    from public.bounties b
    where coalesce(b.poster_id, b.user_id) = any(target_user_ids)
      and b.status = 'completed'
    group by coalesce(b.poster_id, b.user_id)
  ),
  hunter_completed as (
    select b.accepted_by as id, count(*) as n
    from public.bounties b
    where b.accepted_by = any(target_user_ids)
      and b.status = 'completed'
    group by b.accepted_by
  ),
  rating_stats as (
    select r.to_user_id as id, round(avg(r.rating), 2) as avg_rating, count(*) as n
    from public.ratings r
    where r.to_user_id = any(target_user_ids)
    group by r.to_user_id
  )
  select
    ids.id,
    coalesce(posted.n, 0)::int,
    coalesce(posted_completed.n, 0)::int,
    coalesce(hunter_completed.n, 0)::int,
    posted.first_posted_at,
    rating_stats.avg_rating,
    coalesce(rating_stats.n, 0)::int
  from ids
  left join posted           on posted.id = ids.id
  left join posted_completed on posted_completed.id = ids.id
  left join hunter_completed on hunter_completed.id = ids.id
  left join rating_stats     on rating_stats.id = ids.id;
$$;

REVOKE ALL ON FUNCTION public.get_profile_activity_stats_batch(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_activity_stats_batch(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_profile_activity_stats_batch(uuid[]) IS
  'Batched sibling of get_profile_activity_stats for lists of users (e.g. a bounty''s applicants). Same columns/semantics, including rating_avg/rating_count added 2026-09-14. authenticated-only.';

-- ============================================================================
-- 2. Single 24h-later "you approved this hunter but never rated them" nudge.
-- ============================================================================

ALTER TABLE public.completion_submissions
  ADD COLUMN IF NOT EXISTS poster_rating_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.completion_submissions.poster_rating_reminder_sent_at IS
  'Set once fn_remind_pending_hunter_ratings has enqueued the single 24h "rate your hunter" nudge for this submission -- never set twice, so the reminder cannot repeat. NULL for every row approved before this column existed, which is what keeps this migration from retroactively bulk-nudging posters about long-finished work: reviewed_at (see below) was never populated before this change either, so those rows are excluded by that filter regardless.';

-- completion-service.ts's approveCompletion did not previously set
-- reviewed_at when flipping status to 'approved' -- the column existed but
-- was always NULL. It is now stamped client-side in the same update as the
-- status change (lib/services/completion-service.ts). That makes
-- "reviewed_at IS NOT NULL" a free watermark: every row approved before this
-- deploy has reviewed_at NULL and is permanently excluded from the reminder,
-- exactly the request_lifecycle_enabled_at pattern from 20260913000000, with
-- no extra config column needed.

CREATE OR REPLACE FUNCTION public.fn_remind_pending_hunter_ratings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  -- FOR UPDATE OF cs ... SKIP LOCKED claims each eligible submission for the
  -- duration of this function's transaction. Without it, two overlapping
  -- cron invocations (this runs every 15 minutes, so overlap is possible if
  -- a run is ever slow) could both select the same NULL-sent_at row before
  -- either UPDATE below commits, and both enqueue a "rate your hunter"
  -- notification for it. SKIP LOCKED makes the second invocation simply skip
  -- any row the first has already locked, rather than block and duplicate.
  FOR r IN
    SELECT cs.id AS submission_id, cs.bounty_id, cs.hunter_id,
           COALESCE(b.poster_id, b.user_id) AS poster_id,
           b.title AS bounty_title, p.username AS hunter_username
    FROM public.completion_submissions cs
    JOIN public.bounties b ON b.id = cs.bounty_id
    LEFT JOIN public.profiles p ON p.id = cs.hunter_id
    WHERE cs.status = 'approved'
      AND cs.reviewed_at IS NOT NULL
      AND cs.reviewed_at < now() - interval '24 hours'
      AND cs.poster_rating_reminder_sent_at IS NULL
      AND COALESCE(b.poster_id, b.user_id) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.ratings rt
        WHERE rt.bounty_id = cs.bounty_id
          AND rt.from_user_id = COALESCE(b.poster_id, b.user_id)
          AND rt.to_user_id = cs.hunter_id
      )
    FOR UPDATE OF cs SKIP LOCKED
  LOOP
    BEGIN
      INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
      VALUES (
        jsonb_build_array(r.poster_id),
        'Rate your hunter',
        'How did ' || COALESCE(r.hunter_username, 'your hunter') || ' do on "' || left(COALESCE(r.bounty_title, 'your bounty'), 80) || '"? A quick rating helps other posters.',
        jsonb_build_object(
          'type', 'rating_reminder',
          'bounty_id', r.bounty_id,
          'bountyId', r.bounty_id,
          'hunter_id', r.hunter_id,
          'hunterId', r.hunter_id,
          'submission_id', r.submission_id
        ),
        r.bounty_id::text
      );

      UPDATE public.completion_submissions
      SET poster_rating_reminder_sent_at = now()
      WHERE id = r.submission_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_remind_pending_hunter_ratings: skipping submission % after error: %', r.submission_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_remind_pending_hunter_ratings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_remind_pending_hunter_ratings() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_remind_pending_hunter_ratings() TO service_role;

-- New outbox->notifications type, same mechanism as 20260913000000's
-- application_pending_reminder/application_expired additions.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
      'application', 'acceptance', 'completion', 'payment', 'message', 'follow',
      'cancellation_request', 'cancellation_accepted', 'cancellation_rejected',
      'dispute_created', 'dispute_resolved', 'workflow_dispute_created',
      'stale_bounty', 'stale_bounty_cancelled', 'stale_bounty_reposted',
      'update', 'review_needed', 'balance_update', 'bounty_nearby',
      'bounty_expiry', 'dispute_escalated', 'account_warning',
      'account_restricted', 'payout_paid', 'payout_failed', 'payout_canceled',
      'withdrawal_reversed', 'bank_disconnected', 'payout_method_changed',
      'verification_submitted', 'verification_verified', 'verification_rejected',
      'verification_canceled', 'marketing_promo',
      'reconciliation_alert', 'reconciliation_digest',
      'bounty_quality_nudge',
      'application_pending_reminder', 'application_expired',
      -- Ratings/reviews loop (this migration).
      'rating_reminder'
    ]::text[])
  );

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'remind-pending-hunter-ratings';
EXCEPTION WHEN OTHERS THEN
  NULL; -- cron schema not present (local/dev without pg_cron) -- schedule below then also no-ops safely.
END $$;

SELECT cron.schedule(
  'remind-pending-hunter-ratings',
  '*/15 * * * *',
  $$SELECT public.fn_remind_pending_hunter_ratings();$$
);

COMMIT;

NOTIFY pgrst, 'reload schema';
