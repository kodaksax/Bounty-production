-- Migration: dedupe bounty_requests and enforce unique constraint on (bounty_id, hunter_id)
-- WARNING: Back up your database before running.
BEGIN;

-- 1) Create a backup of duplicate rows (just in case)
CREATE TABLE IF NOT EXISTS backup_bounty_requests_duplicates AS
SELECT * FROM bounty_requests WHERE FALSE; -- create empty table with same structure

INSERT INTO backup_bounty_requests_duplicates
SELECT * FROM bounty_requests br
WHERE EXISTS (
  SELECT 1 FROM bounty_requests br2
  WHERE br2.bounty_id = br.bounty_id
    AND (br2.hunter_id IS NOT DISTINCT FROM br.hunter_id)
    AND br2.id <> br.id
);

-- 2) Remove duplicate rows, keeping the newest by created_at (and id as tie-breaker)
WITH ranked AS (
  SELECT id, bounty_id, hunter_id,
    ROW_NUMBER() OVER (PARTITION BY bounty_id, hunter_id ORDER BY created_at DESC, id DESC) rn
  FROM bounty_requests
)
DELETE FROM bounty_requests
USING ranked
WHERE bounty_requests.id = ranked.id
  AND ranked.rn > 1;

-- 3) If an old unique constraint on (bounty_id, user_id) exists, drop it
ALTER TABLE IF EXISTS bounty_requests
  DROP CONSTRAINT IF EXISTS unique_bounty_user;

-- 4) Add canonical unique constraint on (bounty_id, hunter_id)
ALTER TABLE IF EXISTS bounty_requests
  ADD CONSTRAINT IF NOT EXISTS unique_bounty_hunter UNIQUE (bounty_id, hunter_id);

COMMIT;

-- Notes:
--  - This migration assumes the production schema uses `hunter_id` as the canonical applicant column.
--  - If your DB still relies on `user_id` for uniqueness, consider adapting the script to migrate values from `hunter_id` -> `user_id` or vice versa before adding constraints.
--  - Test this on a staging DB before running in production.
