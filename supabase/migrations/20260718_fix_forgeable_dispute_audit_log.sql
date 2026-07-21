-- Migration: Fix forgeable dispute_audit_log entries
-- Created: 2026-07-18
-- Purpose:
--   dispute_audit_log's live INSERT RLS policy is `WITH CHECK (true)`
--   (unconditionally permissive), drifted from the original 2026-01-09
--   migration's admin-only check outside any tracked migration — the same
--   untracked-drift pattern already found and fixed on `profiles` (see
--   20260717_revoke_client_writes_on_sensitive_profile_columns.sql) and on
--   the `connect` edge function (see docs/payments/WITHDRAWAL_SYSTEM_RUNBOOK.md).
--
--   This matters because dispute_audit_log rows are trusted evidence: they
--   record who did what, and eventually gate balance_frozen/balance_on_hold
--   outcomes via dispute resolution. lib/services/dispute-service.ts's
--   logAuditEvent() legitimately inserts directly from the mobile client
--   (supabase.from('dispute_audit_log').insert({..., actor_id, actor_type})),
--   trusting whatever actor_id/actor_type the calling code passes — so simply
--   locking the table down would both break that legitimate, actively-used
--   code path (9+ call sites) AND wasn't even the actual hole: the hole is
--   that nothing validates the *actor* is who they claim to be, whether the
--   insert comes from a malicious direct client call or from the legitimate
--   helper being handed a spoofed value.
--
--   Fix: a BEFORE INSERT trigger that overwrites actor_id/actor_type/
--   created_at with server-derived values (auth.uid()/auth.jwt()->>'role')
--   on every insert, regardless of what the caller supplied — this neutralizes
--   forgery without requiring any change to dispute-service.ts or its call
--   sites. service_role (edge functions, future scheduled jobs) is exempted
--   and trusted to supply these fields directly (e.g. actor_type='system').
--   RLS is additionally tightened to require authentication, as defense in
--   depth alongside the trigger.
--
--   Also drops log_dispute_audit_2(uuid, ...) — a second, broken overload
--   (dispute_audit_log.dispute_id is `integer`; this function's signature
--   takes `uuid`, so it could never have successfully inserted against the
--   current schema) with zero references anywhere in git history or the
--   live schema (no trigger, no app code, confirmed via repo-wide grep).

CREATE OR REPLACE FUNCTION public.enforce_dispute_audit_log_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role (edge functions / scheduled jobs) may supply actor_id/
  -- actor_type directly (e.g. actor_type = 'system'); trusted by definition.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required to write a dispute audit log entry'
      USING ERRCODE = '42501';
  END IF;

  -- Always overwrite actor_id/actor_type/created_at with server-derived,
  -- trustworthy values. A client — or a value forwarded from client input
  -- through lib/services/dispute-service.ts's logAuditEvent(), which today
  -- trusts its actorId/actorType parameters — can no longer claim to be a
  -- different user, claim 'admin'/'system', or backdate an entry.
  NEW.actor_id := auth.uid();
  NEW.actor_type := CASE WHEN (auth.jwt() ->> 'role') = 'admin' THEN 'admin' ELSE 'user' END;
  NEW.created_at := now();

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_dispute_audit_log_actor() IS
  'Overwrites actor_id/actor_type/created_at on every non-service-role insert into dispute_audit_log with server-derived values from auth.uid()/auth.jwt(), preventing a client from forging the actor or backdating an entry.';

DROP TRIGGER IF EXISTS trg_enforce_dispute_audit_log_actor ON public.dispute_audit_log;
CREATE TRIGGER trg_enforce_dispute_audit_log_actor
  BEFORE INSERT ON public.dispute_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_dispute_audit_log_actor();

-- Defense in depth: require authentication at the RLS layer too (the
-- trigger above is the primary control and is authoritative regardless).
DROP POLICY IF EXISTS "System can insert audit logs" ON public.dispute_audit_log;

CREATE POLICY dispute_audit_log_insert_authenticated
  ON public.dispute_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP FUNCTION IF EXISTS public.log_dispute_audit_2(uuid, text, uuid, text, jsonb);
