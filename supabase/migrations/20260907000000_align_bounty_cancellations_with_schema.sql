-- Align public.bounty_cancellations with database/schema.sql.
--
-- Production's copy of this table predates the cancellation service and is
-- missing three columns the app reads and writes on every request, which made
-- the insert in lib/services/cancellation-service.ts fail with
--   PGRST204: Could not find the 'refund_amount' column of 'bounty_cancellations'
-- and left the bounty stranded in `cancellation_requested` with no row to
-- respond to.
--
-- Every statement is additive and idempotent, and the table is empty in
-- production, so this neither rewrites nor drops any data.

-- 1. Columns the service writes on insert (refund_amount) and on
--    accept/reject (response_message, refund_amount).
ALTER TABLE public.bounty_cancellations
  ADD COLUMN IF NOT EXISTS response_message text,
  ADD COLUMN IF NOT EXISTS refund_amount numeric(10,2);

-- 2. updated_at. The trg_bounty_cancellations_updated_at trigger already exists
--    and calls set_updated_at(), which assigns NEW.updated_at — without the
--    column every UPDATE (accept/reject) would raise
--    "record new has no field updated_at".
ALTER TABLE public.bounty_cancellations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 3. created_at had no default, so inserts landed NULL and
--    getCancellationByBountyId's `order by created_at desc` had nothing to sort
--    on. Timestamps become timestamptz to match the rest of the schema (and so
--    PostgREST hands the client an unambiguous instant).
ALTER TABLE public.bounty_cancellations
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at SET DEFAULT now();

UPDATE public.bounty_cancellations SET created_at = now() WHERE created_at IS NULL;

ALTER TABLE public.bounty_cancellations
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE public.bounty_cancellations
  ALTER COLUMN resolved_at TYPE timestamptz USING resolved_at AT TIME ZONE 'UTC',
  ALTER COLUMN requested_at TYPE timestamptz USING requested_at AT TIME ZONE 'UTC';

-- 4. requested_by is a legacy NOT NULL column with no default that nothing in
--    the codebase writes; it would have been the next insert failure after
--    refund_amount. Left in place (unused) but no longer required.
ALTER TABLE public.bounty_cancellations
  ALTER COLUMN requested_by DROP NOT NULL;
