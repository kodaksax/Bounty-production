BEGIN;

DROP TRIGGER IF EXISTS trg_bounties_a_paid_completion_guard ON public.bounties;
DROP FUNCTION IF EXISTS public.fn_bounties_guard_paid_completion();
DROP FUNCTION IF EXISTS public.fn_bounty_has_confirmed_release(uuid);

COMMIT;
