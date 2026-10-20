-- Rollback for 20261020120000_first_time_poster_card_at_post.sql (SBA-05).
--
-- Prefer the kill switch, which needs no deploy and leaves the definition in
-- place for measurement:
--   UPDATE public.payment_experiment_config
--      SET card_at_post_scope = 'off', updated_at = now() WHERE id;
--
-- This file removes everything the migration added. The migration wrote no
-- rows. Builds that call fn_get_posting_card_requirement treat a missing
-- function as "no card required" (lib/services/bounty-funding-service.ts), so
-- they keep posting normally after this runs.
--
-- fn_can_defer_bounty_funding goes back to its previous body. Its client
-- EXECUTE grant comes back for authenticated only, which is what 20260827000000
-- granted; anon and PUBLIC had it only by default and never needed it.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_can_defer_bounty_funding(
  p_poster_id uuid,
  p_amount    numeric
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg         RECORD;
  v_prior_count bigint;
BEGIN
  IF p_poster_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN false;
  END IF;

  SELECT * INTO v_cfg FROM public.payment_experiment_config WHERE id LIMIT 1;
  IF NOT FOUND OR v_cfg.deferred_funding_enabled IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- NULL cap = uncapped.
  IF v_cfg.deferred_funding_max_amount IS NOT NULL
     AND p_amount > v_cfg.deferred_funding_max_amount
  THEN
    RETURN false;
  END IF;

  IF v_cfg.deferred_funding_scope = 'all_bounties' THEN
    RETURN true;
  END IF;

  SELECT count(*) INTO v_prior_count
  FROM public.bounties b
  WHERE COALESCE(b.poster_id, b.user_id) = p_poster_id;

  RETURN v_prior_count = 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_can_defer_bounty_funding(uuid, numeric) TO authenticated;

DROP FUNCTION IF EXISTS public.fn_get_posting_card_requirement(numeric);
DROP FUNCTION IF EXISTS public.fn_is_first_time_poster(uuid);

ALTER TABLE public.payment_experiment_config
  DROP CONSTRAINT IF EXISTS payment_experiment_config_card_at_post_scope_check;
ALTER TABLE public.payment_experiment_config
  DROP COLUMN IF EXISTS card_at_post_scope;

NOTIFY pgrst, 'reload schema';

COMMIT;
