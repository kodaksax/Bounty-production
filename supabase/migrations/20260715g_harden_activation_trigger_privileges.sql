-- Hardens the activation-moment trigger infrastructure added in
-- 20260714f_activation_event_triggers.sql. The Supabase security advisor
-- flagged that new SECURITY DEFINER functions are, by default, executable
-- directly by `anon`/`authenticated` via PostgREST RPC — not just from
-- inside their intended trigger context. For fn_enqueue_activation_moment /
-- fn_mark_activation_moment_completed specifically this was a real
-- privilege-escalation gap: any signed-in client could have called them
-- directly to write an activation-moment row for an arbitrary user_id,
-- bypassing user_activation_moments' own RLS (which the SECURITY DEFINER
-- context ignores by design). Revoking PUBLIC/anon/authenticated EXECUTE
-- does not affect the triggers themselves — trigger functions and the
-- PERFORM calls between them execute as the owning role regardless of
-- grants on those functions.

REVOKE EXECUTE ON FUNCTION public.fn_enqueue_activation_moment(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_mark_activation_moment_completed(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_bounty_posted_activation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_bounty_accepted_activation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_bounty_completed_activation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_large_payout_activation() FROM PUBLIC, anon, authenticated;

-- Also close the search_path lint on the pre-existing
-- set_user_activation_moments_updated_at trigger function
-- (20260714d_add_user_activation_moments.sql) — same hardening, no behavior
-- change.
CREATE OR REPLACE FUNCTION public.set_user_activation_moments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
