-- ROLLBACK for 20261001120000_dispute_authorization_lockdown
-- Generated 2026-10-01T18:18:46.803Z from the LIVE pre-migration state of production (xwlwqzzphmmhghiqvkeu).
-- It restores that environment exactly, including the vulnerable policies;
-- run it only to back the migration out.

BEGIN;


DROP TRIGGER IF EXISTS trg_bounty_disputes_guard ON public.bounty_disputes;

DROP FUNCTION IF EXISTS public.fn_bounty_disputes_guard();

DROP FUNCTION IF EXISTS public.request_dispute_escalation(integer);

-- drop the policies this migration created, then restore the exact pre-migration set
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='bounty_disputes' LOOP EXECUTE format('DROP POLICY %I ON public.bounty_disputes', p.policyname); END LOOP; END $$;
CREATE POLICY "Admin manage" ON public.bounty_disputes AS PERMISSIVE FOR ALL TO "authenticated"
  USING (((auth.jwt() ->> 'role'::text) = 'admin'::text))
  WITH CHECK (((auth.jwt() ->> 'role'::text) = 'admin'::text));
CREATE POLICY "Admins can view all disputes" ON public.bounty_disputes AS PERMISSIVE FOR SELECT TO public
  USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));
CREATE POLICY "Bounty participants can create workflow disputes" ON public.bounty_disputes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((initiator_id = auth.uid()) AND (dispute_stage = ANY (ARRAY['in_progress'::text, 'review_verify'::text])) AND (EXISTS ( SELECT 1
   FROM bounties b
  WHERE ((b.id = bounty_disputes.bounty_id) AND (b.status = 'in_progress'::bounty_status_enum) AND ((b.poster_id = auth.uid()) OR (b.accepted_by = auth.uid())))))));
CREATE POLICY "Initiator delete" ON public.bounty_disputes AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = initiator_id));
CREATE POLICY "Initiator update" ON public.bounty_disputes AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = initiator_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = initiator_id));
CREATE POLICY "Only admins can update disputes" ON public.bounty_disputes AS PERMISSIVE FOR UPDATE TO public
  USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));
CREATE POLICY "Participants insert" ON public.bounty_disputes AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((( SELECT auth.uid() AS uid) = initiator_id));
CREATE POLICY "Participants select" ON public.bounty_disputes AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM bounties b
  WHERE ((b.id = bounty_disputes.bounty_id) AND ((b.poster_id = ( SELECT auth.uid() AS uid)) OR (b.accepted_by = ( SELECT auth.uid() AS uid))))))));

REVOKE ALL ON public.bounty_disputes FROM anon, authenticated;
GRANT INSERT, SELECT, UPDATE ON public.bounty_disputes TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.bounty_disputes TO authenticated;

REVOKE ALL ON SEQUENCE public.bounty_disputes_id_seq FROM authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.bounty_disputes_id_seq TO authenticated;

-- drop the policies this migration created, then restore the exact pre-migration set
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='dispute_audit_log' LOOP EXECUTE format('DROP POLICY %I ON public.dispute_audit_log', p.policyname); END LOOP; END $$;
CREATE POLICY "Admins can view all audit logs" ON public.dispute_audit_log AS PERMISSIVE FOR SELECT TO public
  USING (((auth.jwt() ->> 'role'::text) = 'admin'::text));
CREATE POLICY "dispute_audit_log_insert_authenticated" ON public.dispute_audit_log AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (true);

REVOKE ALL ON public.dispute_audit_log FROM anon, authenticated;
GRANT SELECT ON public.dispute_audit_log TO anon;
GRANT INSERT, SELECT ON public.dispute_audit_log TO authenticated;

REVOKE ALL ON public.dispute_evidence FROM anon, authenticated;
GRANT INSERT, SELECT ON public.dispute_evidence TO anon;
GRANT INSERT, SELECT ON public.dispute_evidence TO authenticated;

CREATE OR REPLACE FUNCTION public.update_dispute_last_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE bounty_disputes
  SET last_activity_at = NOW(),
      updated_at = NOW()
  WHERE id = NEW.dispute_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_dispute_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM log_dispute_audit(
      NEW.id,
      'status_changed',
      auth.uid(),
      CASE WHEN (auth.jwt() ->> 'role') = 'admin' 
           THEN 'admin' ELSE 'user' END,
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_dispute_audit_log_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required to write a dispute audit log entry'
      USING ERRCODE = '42501';
  END IF;

  NEW.actor_id := auth.uid();
  NEW.actor_type := CASE WHEN (auth.jwt() ->> 'role') = 'admin' THEN 'admin' ELSE 'user' END;
  NEW.created_at := now();

  RETURN NEW;
END;
$function$;

COMMIT;
