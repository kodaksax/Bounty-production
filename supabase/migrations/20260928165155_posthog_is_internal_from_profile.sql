-- PostHog person property `is_internal` from profiles.is_internal
--
-- enqueue_analytics_person_snapshot() derived `is_internal` from the hardcoded
-- email list in is_internal_analytics_email(). profiles.is_internal is the
-- single internal/QA flag (20260913010000). On 2026-09-28 prod had 14 internal
-- profiles and the email rule caught 3 of them, so the other 11 reached
-- PostHog as is_internal = false. Their traffic counted as real users in every
-- insight that filters on it.
--
-- The client now sets is_internal from the profile on each profile load
-- (lib/posthog.ts syncInternalFlag). Without this change the server snapshot
-- would write `false` back over it the next time the outbox drains.
--
-- The email rule stays in the OR only as a safety net. It adds no accounts
-- today: every address it matches already has is_internal = true.
--
-- This function body is copied from the LIVE prod definition (read
-- 2026-09-28), not from 20260808000000. That file's initial_utm_* /
-- initial_referrer / initial_landing_page / install_* keys were never
-- applied here (its ADD COLUMN statements don't exist on public.profiles --
-- confirmed against live prod, not just this repo's migration history) and
-- have no bearing on the current attribution model, which lives in
-- public.marketing_attribution (marketing_attribution_core_schema,
-- 2026-07-28). Adding those keys to v_properties fails outright against this
-- schema (42703: record "v_profile" has no field "initial_utm_source"),
-- confirmed by actually running it -- do not add them back on the strength of
-- a diff-only review that assumed 20260808000000 was live.
--
-- No schema or RLS change. Rollback: re-run this file with the is_internal
-- line changed back to public.is_internal_analytics_email(v_profile.email),
-- and drop is_internal from the trigger column list. The backfill SELECT
-- below is unaffected by that rollback.

CREATE OR REPLACE FUNCTION public.enqueue_analytics_person_snapshot(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_posted bigint;
  v_paid_posted bigint;
  v_claimed bigint;
  v_completed bigint;
  v_gmv numeric(14, 2);
  v_behavior_role text;
  v_properties jsonb;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    count(*) FILTER (WHERE metric = 'bounties_posted'),
    count(*) FILTER (WHERE metric = 'paid_bounties_posted'),
    count(*) FILTER (WHERE metric = 'bounties_claimed'),
    count(*) FILTER (WHERE metric = 'bounties_completed'),
    COALESCE(sum(amount) FILTER (WHERE metric = 'lifetime_gmv'), 0)
  INTO v_posted, v_paid_posted, v_claimed, v_completed, v_gmv
  FROM public.analytics_user_facts
  WHERE user_id = p_user_id;

  v_behavior_role := CASE
    WHEN v_posted > 0 AND v_claimed > 0 THEN 'both'
    WHEN v_posted > 0 THEN 'poster'
    WHEN v_claimed > 0 THEN 'hunter'
    ELSE v_profile.primary_role
  END;

  v_properties := jsonb_build_object(
    'role', v_behavior_role,
    'signup_date', v_profile.created_at,
    'onboarding_completed_at', v_profile.onboarding_completed_at,
    'bounties_posted', v_posted,
    'paid_bounties_posted', v_paid_posted,
    'bounties_claimed', v_claimed,
    'bounties_completed', v_completed,
    'lifetime_gmv', v_gmv,
    'is_identity_verified', (
      COALESCE(v_profile.stripe_identity_status = 'verified', false)
      OR COALESCE(v_profile.id_verification_status = 'verified', false)
    ),
    'has_payment_method', EXISTS (
      SELECT 1 FROM public.payment_methods WHERE user_id = p_user_id
    ),
    'has_stripe_connect', (
      COALESCE(v_profile.stripe_connect_charges_enabled, false)
      AND COALESCE(v_profile.stripe_connect_payouts_enabled, false)
    ),
    'home_region', public.coarse_analytics_region(v_profile.location),
    -- `false OR NULL` is NULL, and a NULL here would ship as JSON `null`
    -- rather than a boolean, breaking any PostHog filter/insight that expects
    -- true/false. v_profile.is_internal is NOT NULL DEFAULT false and
    -- is_internal_analytics_email() already COALESCEs its own argument (both
    -- verified against the live prod definitions on 2026-09-28), so this can
    -- never actually be NULL today -- the outer COALESCE is defense-in-depth
    -- against either of those assumptions changing later, not a live bug fix.
    'is_internal', COALESCE(
      COALESCE(v_profile.is_internal, false)
      OR public.is_internal_analytics_email(v_profile.email),
      false
    )
  );

  INSERT INTO public.analytics_person_outbox (
    user_id, properties, status, attempts, scheduled_at, last_error, updated_at
  ) VALUES (
    p_user_id, v_properties, 'pending', 0, NULL, NULL, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    properties = EXCLUDED.properties,
    status = 'pending',
    attempts = 0,
    scheduled_at = NULL,
    last_error = NULL,
    updated_at = EXCLUDED.updated_at;
END;
$function$;

-- Re-snapshot when an account is flagged or unflagged, not only when one of
-- the existing columns changes. The column list is otherwise identical to prod.
DROP TRIGGER IF EXISTS trg_queue_profile_analytics_snapshot ON public.profiles;
CREATE TRIGGER trg_queue_profile_analytics_snapshot
  AFTER INSERT OR UPDATE OF email, primary_role, onboarding_completed, onboarding_completed_at,
    stripe_identity_status, id_verification_status, stripe_connect_charges_enabled,
    stripe_connect_payouts_enabled, location, is_internal
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.queue_profile_analytics_snapshot();

-- Re-queue every existing profile through the corrected snapshot function.
-- Without this, the 14 already-flagged profiles keep the stale
-- is_internal = false outbox payload until an unrelated profile update or
-- fact event happens to touch them -- this rollout would fix nothing for the
-- population it targets.
SELECT public.enqueue_analytics_person_snapshot(id) FROM public.profiles;
