-- Rollback for 20261019230000_posting_quality_rules.sql (SBA-03).
-- Removes the posting quality trigger and its switch column. Nothing else
-- reads either, and the migration wrote no rows. Builds with the step-1
-- "What exactly, and when?" field keep
-- asking for a description client-side; only the server backstop and the
-- new-account cap go away.

BEGIN;

DROP TRIGGER IF EXISTS trg_bounties_enforce_posting_quality ON public.bounties;
DROP FUNCTION IF EXISTS public.fn_bounties_enforce_posting_quality();
ALTER TABLE public.posting_policy_config DROP COLUMN IF EXISTS require_in_person_description;

COMMIT;
