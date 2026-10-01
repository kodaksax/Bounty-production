-- ROLLBACK for 20261001120400_bounty_cancellations_responder_policy_fix
-- Generated 2026-10-01T18:18:52.875Z from the LIVE pre-migration state of production (xwlwqzzphmmhghiqvkeu).
-- It restores that environment exactly, including the vulnerable policies;
-- run it only to back the migration out.

BEGIN;


-- drop the policies this migration created, then restore the exact pre-migration set
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='bounty_cancellations' LOOP EXECUTE format('DROP POLICY %I ON public.bounty_cancellations', p.policyname); END LOOP; END $$;
CREATE POLICY "bounty_cancellations_insert_related" ON public.bounty_cancellations AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (((( SELECT auth.uid() AS uid) = requester_id) AND (EXISTS ( SELECT 1
   FROM bounties
  WHERE ((bounties.id = bounty_cancellations.bounty_id) AND ((bounties.poster_id = ( SELECT auth.uid() AS uid)) OR (bounties.accepted_by = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "bounty_cancellations_select_related" ON public.bounty_cancellations AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (((( SELECT auth.uid() AS uid) = requester_id) OR (( SELECT auth.uid() AS uid) = responder_id) OR (EXISTS ( SELECT 1
   FROM bounties
  WHERE ((bounties.id = bounty_cancellations.bounty_id) AND ((bounties.poster_id = ( SELECT auth.uid() AS uid)) OR (bounties.accepted_by = ( SELECT auth.uid() AS uid))))))));
CREATE POLICY "bounty_cancellations_update_responder" ON public.bounty_cancellations AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) <> requester_id) AND (EXISTS ( SELECT 1
   FROM bounties
  WHERE ((bounties.id = bounty_cancellations.bounty_id) AND ((bounties.poster_id = ( SELECT auth.uid() AS uid)) OR (bounties.accepted_by = ( SELECT auth.uid() AS uid))))))))
  WITH CHECK (((requester_id = ( SELECT bounty_cancellations_1.requester_id
   FROM bounty_cancellations bounty_cancellations_1
  WHERE (bounty_cancellations_1.id = bounty_cancellations_1.id))) AND (( SELECT auth.uid() AS uid) = responder_id)));

REVOKE ALL ON public.bounty_cancellations FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE ON public.bounty_cancellations TO authenticated;

COMMIT;
