-- ROLLBACK for 20261001120200_bounties_policy_consolidation
-- Generated 2026-10-01T18:18:50.192Z from the LIVE pre-migration state of production (xwlwqzzphmmhghiqvkeu).
-- It restores that environment exactly, including the vulnerable policies;
-- run it only to back the migration out.

BEGIN;


-- drop the policies this migration created, then restore the exact pre-migration set
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='bounties' LOOP EXECUTE format('DROP POLICY %I ON public.bounties', p.policyname); END LOOP; END $$;
CREATE POLICY "Authenticated users can view all bounties" ON public.bounties AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (true);
CREATE POLICY "Owners can delete their own bounties" ON public.bounties AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((auth.uid() = poster_id));
CREATE POLICY "Owners can update their own bounties" ON public.bounties AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((auth.uid() = poster_id))
  WITH CHECK ((auth.uid() = poster_id));
CREATE POLICY "Users can create bounties" ON public.bounties AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = poster_id) AND is_account_active(auth.uid())));
CREATE POLICY "bounties_delete_own" ON public.bounties AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = poster_id));
CREATE POLICY "bounties_insert_own" ON public.bounties AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((( SELECT auth.uid() AS uid) = poster_id));
CREATE POLICY "bounties_select_all" ON public.bounties AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (true);
CREATE POLICY "bounties_update_own" ON public.bounties AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = poster_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = poster_id));

REVOKE ALL ON public.bounties FROM anon, authenticated;
GRANT INSERT ON public.bounties TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.bounties TO authenticated;

REVOKE ALL ON public.completion_submissions FROM anon, authenticated;
GRANT SELECT ON public.completion_submissions TO anon;
GRANT INSERT, SELECT, UPDATE ON public.completion_submissions TO authenticated;

COMMIT;
