-- Migration: Add structured schedule fields to the bounties table
-- Phase 1: Time as a first-class citizen in the Bounty platform.
--
-- These columns are all nullable so existing rows are unaffected.
-- Downstream systems (notifications, search ranking, matching) can start
-- reading these columns immediately; the mobile app will populate them for
-- all new bounties created after this migration is applied.

ALTER TABLE bounties
  ADD COLUMN IF NOT EXISTS schedule_type        VARCHAR(20)   CHECK (schedule_type IN ('asap', 'scheduled', 'flexible')),
  ADD COLUMN IF NOT EXISTS start_date           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_date             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS latest_arrival_time  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duration_minutes     INTEGER       CHECK (duration_minutes > 0),
  ADD COLUMN IF NOT EXISTS conditional_end_note TEXT;

-- Index end_date to support efficient "expiring soon" queries and sorting
-- bounties by urgency in the discovery feed.
CREATE INDEX IF NOT EXISTS idx_bounties_end_date
  ON bounties (end_date)
  WHERE end_date IS NOT NULL;

-- Index schedule_type for filtering by urgency category.
CREATE INDEX IF NOT EXISTS idx_bounties_schedule_type
  ON bounties (schedule_type)
  WHERE schedule_type IS NOT NULL;

COMMENT ON COLUMN bounties.schedule_type        IS 'High-level schedule category: asap, scheduled, or flexible.';
COMMENT ON COLUMN bounties.start_date           IS 'Earliest/preferred start time (UTC).';
COMMENT ON COLUMN bounties.end_date             IS 'Hard deadline or latest finish time (UTC). Always set alongside conditional_end_note as a safety-net.';
COMMENT ON COLUMN bounties.latest_arrival_time  IS 'Latest time the hunter may begin the job (distinct from end_date when a conditional end condition is also set).';
COMMENT ON COLUMN bounties.duration_minutes     IS 'Estimated task duration in minutes.';
COMMENT ON COLUMN bounties.conditional_end_note IS 'Human-readable conditional end condition, e.g. "until the first Associate arrives".';
