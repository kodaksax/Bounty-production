-- ROLLBACK for 20261001120200_bounties_policy_consolidation
-- Generated 2026-10-01T18:16:31.781Z from the LIVE pre-migration state of staging (gwumwpoomwvkjyibdmpj).
-- It restores that environment exactly, including the vulnerable policies;
-- run it only to back the migration out.

BEGIN;


-- drop the policies this migration created, then restore the exact pre-migration set
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='bounties' LOOP EXECUTE format('DROP POLICY %I ON public.bounties', p.policyname); END LOOP; END $$;
CREATE POLICY "Authenticated can select bounties" ON public.bounties AS PERMISSIVE FOR SELECT TO public
  USING (((status IS NULL) OR (status <> 'archived'::bounty_status_enum) OR (auth.uid() = COALESCE(poster_id, user_id)) OR (auth.uid() = hunter_id)));
CREATE POLICY "Authenticated users can insert own bounties" ON public.bounties AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (((auth.uid() IS NOT NULL) AND ((user_id = auth.uid()) OR (poster_id = auth.uid()))));
CREATE POLICY "Authenticated users can view all bounties" ON public.bounties AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (true);
CREATE POLICY "Owners can delete their own bounties" ON public.bounties AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((auth.uid() = poster_id));
CREATE POLICY "Owners can update their own bounties" ON public.bounties AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((auth.uid() = poster_id))
  WITH CHECK ((auth.uid() = poster_id));
CREATE POLICY "Service role can manage bounties" ON public.bounties AS PERMISSIVE FOR ALL TO public
  USING (((auth.jwt() ->> 'role'::text) = 'service_role'::text))
  WITH CHECK (((auth.jwt() ->> 'role'::text) = 'service_role'::text));
CREATE POLICY "Users can create bounties" ON public.bounties AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = poster_id) AND is_account_active(auth.uid())));
CREATE POLICY "Users can insert bounties" ON public.bounties AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((auth.uid() = COALESCE(poster_id, user_id)));
CREATE POLICY "Users can update their bounties" ON public.bounties AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((auth.uid() = COALESCE(poster_id, user_id)))
  WITH CHECK ((auth.uid() = COALESCE(poster_id, user_id)));
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
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bounties TO authenticated;

REVOKE ALL ON public.completion_submissions FROM anon, authenticated;
GRANT SELECT ON public.completion_submissions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.completion_submissions TO authenticated;

COMMIT;
