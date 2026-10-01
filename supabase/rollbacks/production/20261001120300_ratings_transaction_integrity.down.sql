-- ROLLBACK for 20261001120300_ratings_transaction_integrity
-- Generated 2026-10-01T18:18:51.312Z from the LIVE pre-migration state of production (xwlwqzzphmmhghiqvkeu).
-- It restores that environment exactly, including the vulnerable policies;
-- run it only to back the migration out.

BEGIN;


ALTER TABLE public.ratings DROP CONSTRAINT IF EXISTS ratings_rating_check;

DROP INDEX IF EXISTS public.ratings_bounty_from_to_uidx;

-- drop the policies this migration created, then restore the exact pre-migration set
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='ratings' LOOP EXECUTE format('DROP POLICY %I ON public.ratings', p.policyname); END LOOP; END $$;
CREATE POLICY "ratings_delete_rater" ON public.ratings AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = from_user_id));
CREATE POLICY "ratings_insert_rater" ON public.ratings AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = from_user_id));
CREATE POLICY "ratings_select_all" ON public.ratings AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "ratings_update_rater" ON public.ratings AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = from_user_id))
  WITH CHECK ((auth.uid() = from_user_id));

REVOKE ALL ON public.ratings FROM anon, authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.ratings TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.ratings TO authenticated;

COMMIT;
