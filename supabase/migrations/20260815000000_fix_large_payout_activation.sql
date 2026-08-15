-- Make the payout prompt available before Connect onboarding is complete.
-- A positive unpaid balance is the eligibility signal; requiring payouts to
-- already be enabled creates a deadlock.

CREATE OR REPLACE FUNCTION public.trg_fn_large_payout_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.balance > 0
     AND COALESCE(NEW.stripe_connect_payouts_enabled, false) = false
     AND (
       TG_OP = 'INSERT'
       OR OLD.balance IS DISTINCT FROM NEW.balance
       OR OLD.stripe_connect_payouts_enabled IS DISTINCT FROM NEW.stripe_connect_payouts_enabled
     ) THEN
    PERFORM public.fn_enqueue_activation_moment(
      NEW.id,
      'large_payout_eligible',
      jsonb_build_object('balance', NEW.balance)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_large_payout_activation ON public.profiles;
CREATE TRIGGER trg_profiles_large_payout_activation
  AFTER INSERT OR UPDATE OF balance, stripe_connect_payouts_enabled ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_large_payout_activation();

-- Re-arm existing positive-balance users whose old trigger could not enqueue
-- because it required payouts_enabled first.
INSERT INTO public.user_activation_moments (user_id, moment_type, status, metadata)
SELECT id, 'large_payout_eligible', 'pending', jsonb_build_object('balance', balance)
FROM public.profiles
WHERE balance > 0
  AND COALESCE(stripe_connect_payouts_enabled, false) = false
ON CONFLICT (user_id, moment_type) DO UPDATE
SET status = CASE
  WHEN public.user_activation_moments.status IN ('dismissed', 'snoozed')
    THEN public.user_activation_moments.status
  ELSE 'pending'
END,
    metadata = public.user_activation_moments.metadata || EXCLUDED.metadata;