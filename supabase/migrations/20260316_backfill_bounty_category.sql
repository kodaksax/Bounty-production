-- Backfill missing categories on existing bounties
-- Sets empty or NULL `category` to 'uncategorized'
-- Reversible down: resets 'uncategorized' back to NULL for bounties created before migration date

BEGIN;

-- Mark existing rows without category as 'uncategorized'
UPDATE public.bounties
SET category = 'uncategorized'
WHERE category IS NULL OR TRIM(category) = '';

COMMIT;

-- DOWN (revert): set category back to NULL for rows we just backfilled
-- This targets bounties created before the migration time so newly-created 'uncategorized'
-- bounties created after this migration are left untouched.
-- Note: adjust the timestamp below if running this migration at a different time.

-- To rollback, run:
-- BEGIN;
-- UPDATE public.bounties
-- SET category = NULL
-- WHERE category = 'uncategorized' AND created_at < '2026-03-16T00:00:00Z';
-- COMMIT;
