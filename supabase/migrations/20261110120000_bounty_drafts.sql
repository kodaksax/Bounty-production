-- Migration: server copy of the bounty composer's draft (public.bounty_drafts)
-- Created: 2026-11-10
--
-- PROBLEM
--   The composer's draft lived only in device storage (AsyncStorage key
--   bounty-draft-v1:<userId>). A poster who started a post on a phone and
--   opened the app on a tablet found nothing there (seen 2026-11-07).
--
-- WHAT THIS DOES
--   One row per user: the latest draft, the composer step it was left on, the
--   client's edit time, and the device that wrote it. The client writes its
--   local copy first, upserts here debounced by 2 s, keeps whichever copy has
--   the newer updated_at when it loads, and deletes the row on publish and on
--   "Start over" (app/hooks/useBountyDraft.ts, lib/services/bounty-draft-sync.ts).
--
--   `draft` can hold the exact pin (latitude/longitude) of an in-person task,
--   so the table is owner-only: authenticated users can read and write only
--   their own row, anon has no grants at all, and nothing here is exposed to
--   analytics. The service role keeps its default access. Rows go away with
--   the auth user (ON DELETE CASCADE).
--
--   updated_at is the CLIENT's edit time, not now(): the merge compares it with
--   the device's own copy, so both sides have to come from the same kind of
--   clock.
--
-- Verify: scripts/verify-bounty-drafts-rls-pglite.mjs
-- Rollback: supabase/rollbacks/production/20261110120000_bounty_drafts.down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.bounty_drafts (
  user_id     uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  draft       jsonb       NOT NULL,
  last_step   smallint    NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  device_name text,
  CONSTRAINT bounty_drafts_draft_is_object CHECK (jsonb_typeof(draft) = 'object'),
  -- A draft is a few hundred bytes of form fields. The cap stops the row from
  -- being used as free blob storage.
  CONSTRAINT bounty_drafts_draft_size CHECK (pg_column_size(draft) <= 32768),
  -- Loose on purpose: the composer has 3 steps today, and a client that adds
  -- one must not start failing writes. The client clamps on read.
  CONSTRAINT bounty_drafts_last_step_range CHECK (last_step BETWEEN 1 AND 20),
  CONSTRAINT bounty_drafts_device_name_length CHECK (device_name IS NULL OR char_length(device_name) <= 100)
);

COMMENT ON TABLE public.bounty_drafts IS
  'Owner-only server copy of the composer draft, for cross-device resume. May hold exact coordinates: never read it into analytics.';
COMMENT ON COLUMN public.bounty_drafts.updated_at IS
  'Client edit time of this copy. Newer wins against the device copy on load.';

ALTER TABLE public.bounty_drafts ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges grant ALL (including TRUNCATE, TRIGGER and
-- REFERENCES) to anon and authenticated on new tables. Start from nothing and
-- grant back only what the owner policies need.
REVOKE ALL ON TABLE public.bounty_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bounty_drafts TO authenticated;

DROP POLICY IF EXISTS bounty_drafts_select_own ON public.bounty_drafts;
CREATE POLICY bounty_drafts_select_own
  ON public.bounty_drafts
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS bounty_drafts_insert_own ON public.bounty_drafts;
CREATE POLICY bounty_drafts_insert_own
  ON public.bounty_drafts
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS bounty_drafts_update_own ON public.bounty_drafts;
CREATE POLICY bounty_drafts_update_own
  ON public.bounty_drafts
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS bounty_drafts_delete_own ON public.bounty_drafts;
CREATE POLICY bounty_drafts_delete_own
  ON public.bounty_drafts
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMIT;
