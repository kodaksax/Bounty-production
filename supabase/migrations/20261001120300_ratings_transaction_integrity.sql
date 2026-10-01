-- Ratings only from real transactions (trust-spine audit 2026-09-30, T7 / S5 / S7).
--
-- Prod ratings had only a PK and FKs: no range CHECK, no uniqueness, and an
-- INSERT policy of just auth.uid() = from_user_id, so anyone could rate anyone
-- with no bounty, or cite somebody else's bounty, and raters could UPDATE or
-- DELETE their rating afterwards. anon held INSERT / UPDATE / DELETE grants.
-- Reproduced on staging 2026-10-01.
--
-- After this migration a rating can only be written by one party of a
-- completed (or completed-then-archived) bounty about the other party, once
-- per (bounty, rater, ratee), with a 1-5 score, and it is immutable.
-- The client already rates only after approval (review-and-verify.tsx,
-- poster-review-modal.tsx) and never updates or deletes a rating.
--
-- Existing rows are left untouched (4 of 9 prod rows have no valid
-- transaction pairing; excluding them from aggregates is a separate change).
-- Prod has 0 duplicate (bounty, from, to) triples and 0 out-of-range scores,
-- so the CHECK validates and the unique index builds.
--
-- Rollback (generated from each environment's live pre-migration state):
--   supabase/rollbacks/production/20261001120300_ratings_transaction_integrity.down.sql
--   supabase/rollbacks/staging/20261001120300_ratings_transaction_integrity.down.sql

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ratings'::regclass AND conname = 'ratings_rating_check'
  ) THEN
    ALTER TABLE public.ratings
      ADD CONSTRAINT ratings_rating_check CHECK (rating >= 1 AND rating <= 5) NOT VALID;
    ALTER TABLE public.ratings VALIDATE CONSTRAINT ratings_rating_check;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ratings_bounty_from_to_uidx
  ON public.ratings (bounty_id, from_user_id, to_user_id);

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'ratings'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.ratings', p.policyname);
  END LOOP;
END $$;

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- Reviews are public (profile pages); unchanged from prod's ratings_select_all.
CREATE POLICY ratings_select_all
  ON public.ratings FOR SELECT TO public
  USING (true);

CREATE POLICY ratings_insert_transaction_party
  ON public.ratings FOR INSERT TO authenticated
  WITH CHECK (
    from_user_id = (SELECT auth.uid())
    AND bounty_id IS NOT NULL
    AND rating >= 1 AND rating <= 5
    AND EXISTS (
      SELECT 1 FROM public.bounties b
       WHERE b.id = ratings.bounty_id
         AND b.accepted_by IS NOT NULL
         -- Archived only counts when the work was actually approved; a
         -- bounty cancelled after acceptance can be archived too.
         AND (b.status::text = 'completed'
              OR (b.status::text = 'archived' AND EXISTS (
                    SELECT 1 FROM public.completion_submissions cs
                     WHERE cs.bounty_id = b.id AND cs.status = 'approved')))
         AND (
           (ratings.from_user_id = COALESCE(b.poster_id, b.user_id) AND ratings.to_user_id = b.accepted_by)
           OR (ratings.from_user_id = b.accepted_by AND ratings.to_user_id = COALESCE(b.poster_id, b.user_id))
         )
    )
  );

-- No UPDATE / DELETE policies: a rating is a record of a transaction.
REVOKE ALL ON public.ratings FROM anon;
REVOKE ALL ON public.ratings FROM authenticated;
GRANT SELECT ON public.ratings TO anon;
GRANT SELECT, INSERT ON public.ratings TO authenticated;

COMMIT;
