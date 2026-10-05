-- Prevent authenticated clients from completing paid bounties without release
-- evidence, while retaining completion after a recorded payout release.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_bounty_has_confirmed_release(p_bounty_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.bounties b
     WHERE b.id = p_bounty_id
       AND COALESCE(b.user_id, b.poster_id) = auth.uid()
       AND (
         EXISTS (
           SELECT 1
             FROM public.wallet_transactions wt
            WHERE wt.bounty_id = b.id
              AND wt.type::text = 'release'
              AND wt.status::text = 'completed'
         )
         OR EXISTS (
           SELECT 1
             FROM public.bounty_payments bp
            WHERE bp.bounty_id = b.id
              AND bp.status = 'released'
              AND bp.stripe_transfer_id IS NOT NULL
         )
         OR EXISTS (
           SELECT 1
             FROM public.bounty_v3_funding bf
            WHERE bf.bounty_id = b.id
              AND bf.state = 'released'
              AND bf.stripe_transfer_id IS NOT NULL
         )
       )
  );
$$;

REVOKE ALL ON FUNCTION public.fn_bounty_has_confirmed_release(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_bounty_has_confirmed_release(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_bounties_guard_paid_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon')
     OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status::text = 'in_progress'
     AND NEW.status::text = 'completed'
     AND OLD.is_for_honor IS DISTINCT FROM TRUE
     AND NOT public.fn_bounty_has_confirmed_release(OLD.id)
  THEN
    RAISE EXCEPTION 'paid_bounty_completion_requires_release'
      USING ERRCODE = '42501',
            HINT = 'Release the bounty payment before completing a paid bounty.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounties_a_paid_completion_guard ON public.bounties;
CREATE TRIGGER trg_bounties_a_paid_completion_guard
  BEFORE UPDATE OF status ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.fn_bounties_guard_paid_completion();

COMMIT;
