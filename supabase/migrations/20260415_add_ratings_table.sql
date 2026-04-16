-- Migration: add_ratings_table
-- Date: 2026-04-15
-- Problem: The `ratings` table (primary) and `user_ratings` table (legacy fallback)
--          were never created via migration, causing "Could not find the table
--          'public.user_ratings' in the schema cache" errors in staging when the
--          fallback insert path in completion-service.ts and ratings.ts is reached.
-- Fix:
--   1. Create the canonical `ratings` table.
--   2. Create a `user_ratings` compatibility VIEW (legacy column aliases) so that
--      all existing fallback code paths and `hasRated()` continue to work without
--      further code changes.
--   3. Add an INSTEAD OF INSERT trigger so legacy inserts into the view are
--      transparently forwarded to the underlying `ratings` table.
--   4. Apply RLS policies and grant necessary privileges.
-- Idempotent: safe to run on production, staging, preview, and local dev.

-- ============================================================================
-- 1. Primary ratings table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ratings (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  bounty_id    UUID        REFERENCES public.bounties(id)  ON DELETE SET NULL,
  from_user_id UUID        REFERENCES public.profiles(id)  ON DELETE SET NULL,
  to_user_id   UUID        REFERENCES public.profiles(id)  ON DELETE SET NULL,
  rating       NUMERIC(3,1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent a user from rating the same bounty recipient twice
CREATE UNIQUE INDEX IF NOT EXISTS ratings_bounty_from_to_uidx
  ON public.ratings (bounty_id, from_user_id, to_user_id);

-- Performance: look up all ratings received by a user
CREATE INDEX IF NOT EXISTS ratings_to_user_idx
  ON public.ratings (to_user_id);

-- ============================================================================
-- 2. Row-level security
-- ============================================================================
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read ratings (used in profile / listing views)
DROP POLICY IF EXISTS "ratings_select" ON public.ratings;
CREATE POLICY "ratings_select"
  ON public.ratings FOR SELECT
  TO authenticated
  USING (true);

-- A user may only insert a rating where they are the rater (from_user_id)
DROP POLICY IF EXISTS "ratings_insert" ON public.ratings;
CREATE POLICY "ratings_insert"
  ON public.ratings FOR INSERT
  TO authenticated
  WITH CHECK (from_user_id = auth.uid());

-- Ratings are immutable for end users; admins can update/delete via service_role.

-- ============================================================================
-- 3. Compatibility view: user_ratings
--    Exposes the same column names used by the legacy fallback code paths:
--      user_id   → to_user_id
--      rater_id  → from_user_id
--      score     → rating
-- ============================================================================
CREATE OR REPLACE VIEW public.user_ratings AS
SELECT
  id,
  to_user_id   AS user_id,
  from_user_id AS rater_id,
  bounty_id,
  rating       AS score,
  comment,
  created_at
FROM public.ratings;

-- Allow authenticated users to read the view
GRANT SELECT ON public.user_ratings TO authenticated, anon;

-- ============================================================================
-- 4. INSTEAD OF INSERT trigger on the view
--    Allows legacy fallback inserts (into user_ratings) to be transparently
--    forwarded to the canonical ratings table.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._fn_user_ratings_instead_insert()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER (default): INSERT into ratings runs under the caller's
-- identity so that RLS policies on ratings still apply correctly.
AS $$
BEGIN
  INSERT INTO public.ratings (bounty_id, from_user_id, to_user_id, rating, comment)
  VALUES (NEW.bounty_id, NEW.rater_id, NEW.user_id, NEW.score, NEW.comment);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS _trg_user_ratings_insert ON public.user_ratings;
CREATE TRIGGER _trg_user_ratings_insert
  INSTEAD OF INSERT ON public.user_ratings
  FOR EACH ROW EXECUTE FUNCTION public._fn_user_ratings_instead_insert();

-- ============================================================================
-- 5. Explicit grants on the base table
--    PostgREST / authenticated role needs INSERT + SELECT to function correctly.
-- ============================================================================
GRANT SELECT, INSERT ON public.ratings TO authenticated;
