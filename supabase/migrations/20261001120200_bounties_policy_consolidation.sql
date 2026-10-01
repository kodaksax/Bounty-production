-- Suspended accounts can no longer post (trust-spine audit 2026-09-30, T12 / S6 / S7).
--
-- 20260726000000_enforce_account_status.sql added "Users can create bounties"
-- (auth.uid() = poster_id AND is_account_active(auth.uid())), but the older
-- permissive policy bounties_insert_own (auth.uid() = poster_id) was still
-- live. Permissive policies are OR'd, so the account-status check never
-- applied. Staging additionally carries "Users can insert bounties"
-- (COALESCE(poster_id, user_id)) and "Authenticated users can insert own
-- bounties" (user_id OR poster_id), which let a caller post with their own
-- user_id and somebody else's poster_id. Reproduced on staging 2026-10-01.
--
-- Every policy on public.bounties is rebuilt as exactly one policy per
-- command. SELECT / UPDATE / DELETE keep prod's current semantics (prod had
-- two identical policies for each); only INSERT gets stricter:
--   * poster_id must be the caller, user_id (dual-written legacy owner column,
--     which /wallet uses for ownership) must be the caller or NULL;
--   * the caller's account must be active.
-- Lifecycle restrictions on UPDATE / DELETE live in trg_bounties_guard_lifecycle
-- (20261001120100), which a future permissive policy cannot OR away.
--
-- Rollback (generated from each environment's live pre-migration state):
--   supabase/rollbacks/production/20261001120200_bounties_policy_consolidation.down.sql
--   supabase/rollbacks/staging/20261001120200_bounties_policy_consolidation.down.sql

BEGIN;

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'bounties'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.bounties', p.policyname);
  END LOOP;
END $$;

ALTER TABLE public.bounties ENABLE ROW LEVEL SECURITY;

CREATE POLICY bounties_select_authenticated
  ON public.bounties FOR SELECT TO authenticated
  USING (true);

CREATE POLICY bounties_insert_active_owner
  ON public.bounties FOR INSERT TO authenticated
  WITH CHECK (
    poster_id = (SELECT auth.uid())
    AND (user_id IS NULL OR user_id = (SELECT auth.uid()))
    AND public.is_account_active((SELECT auth.uid()))
  );

CREATE POLICY bounties_update_owner
  ON public.bounties FOR UPDATE TO authenticated
  USING (poster_id = (SELECT auth.uid()))
  WITH CHECK (poster_id = (SELECT auth.uid()));

CREATE POLICY bounties_delete_owner
  ON public.bounties FOR DELETE TO authenticated
  USING (poster_id = (SELECT auth.uid()));

-- anon never posts; TRUNCATE / TRIGGER / REFERENCES bypass or sidestep RLS
-- and were granted to authenticated on staging only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.bounties FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.bounties FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.completion_submissions FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.completion_submissions FROM authenticated;

COMMIT;
