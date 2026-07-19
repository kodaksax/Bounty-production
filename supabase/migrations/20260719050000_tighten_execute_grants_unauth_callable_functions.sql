-- Migration: Revoke EXECUTE from anon/PUBLIC on functions with no internal auth check
-- Created: 2026-07-19
--
-- Fresh database schema/security audit. Queried every SECURITY DEFINER
-- function in public granted EXECUTE to `anon` (i.e. callable by a
-- completely unauthenticated client), then read each body to check for an
-- internal auth.uid()/role guard. Three have none, and none of their real
-- callers (grepped across lib/, supabase/functions/, app/) need anon access:
--
-- 1. unfreeze_profile_if_no_open_disputes(uuid) -- HIGHEST severity. No auth
--    check at all; unconditionally clears profiles.balance_frozen for the
--    given user id if they have no open 'stripe_dispute' rows. Its only real
--    caller anywhere in the codebase is supabase/functions/webhooks/index.ts
--    (service_role). Left reachable via anon/authenticated, this is a direct
--    RPC-callable bypass of a fraud/dispute financial safety mechanism --
--    anyone could call it for any user id and lift their balance freeze
--    outside the intended webhook-driven flow. Restricted to service_role only.
--
-- 2. send_system_notification(uuid, text, text, text, jsonb) -- has an
--    allow-list of notification types (defense against arbitrary spam
--    content) but no check on who's calling or whether they should be
--    notifying that particular user. Real callers ARE client-side
--    (lib/services/dispute-service.ts, app/(admin)/verifications.tsx) under
--    a regular authenticated session, so `authenticated` access must stay --
--    but `anon` access serves no legitimate purpose and lets a fully
--    unauthenticated caller inject fake dispute-notification rows for any
--    user id. Revoked from anon/PUBLIC only.
--
-- 3. has_stripe_connect(uuid) -- no auth check, and (grepped) has ZERO
--    live callers anywhere in the current app -- only referenced in this
--    function's own defining migration and archived docs. Dead code that
--    happens to also leak, to any unauthenticated caller, whether an
--    arbitrary user has completed Stripe Connect onboarding. Restricted to
--    service_role only since nothing else calls it; flagged separately as a
--    dead-code removal candidate.
--
-- Deliberately NOT touched: is_user_participant(uuid, uuid) and
-- is_conversation_creator(uuid), which also lack an internal auth check and
-- are anon-EXECUTE-granted -- verified via pg_policies that both are called
-- FROM WITHIN existing RLS policies on conversation_participants (as the
-- querying `authenticated` role), so revoking authenticated's EXECUTE would
-- break conversation participant reads/inserts entirely. Their anon grant is
-- inert in practice (auth.uid() is null for anon, so both simply return
-- false) and left alone rather than risk an RLS regression for a low-severity,
-- read-only, participant-existence-boolean leak.

REVOKE EXECUTE ON FUNCTION public.unfreeze_profile_if_no_open_disputes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unfreeze_profile_if_no_open_disputes(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.send_system_notification(uuid, text, text, text, jsonb) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.has_stripe_connect(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_stripe_connect(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
