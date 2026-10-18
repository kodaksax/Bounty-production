-- Account deletion was blocked by FKs to profiles/auth.users that had drifted
-- to NO ACTION in prod (e.g. bounty_disputes_resolved_by_fkey, which
-- 20260109_comprehensive_dispute_system.sql declared ON DELETE SET NULL).
-- All four columns are nullable audit/attribution pointers: keep the rows,
-- null the reference.

ALTER TABLE public.bounty_disputes
  DROP CONSTRAINT IF EXISTS bounty_disputes_resolved_by_fkey,
  ADD CONSTRAINT bounty_disputes_resolved_by_fkey
    FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.bounty_cancellations
  DROP CONSTRAINT IF EXISTS bounty_cancellations_responder_id_fkey,
  ADD CONSTRAINT bounty_cancellations_responder_id_fkey
    FOREIGN KEY (responder_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.reconciliation_known_exceptions
  DROP CONSTRAINT IF EXISTS reconciliation_known_exceptions_user_id_fkey,
  ADD CONSTRAINT reconciliation_known_exceptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_reviewer_id_fkey,
  ADD CONSTRAINT profiles_id_reviewer_id_fkey
    FOREIGN KEY (id_reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL;
