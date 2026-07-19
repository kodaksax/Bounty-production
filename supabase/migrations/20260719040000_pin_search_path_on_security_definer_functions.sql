-- Migration: Pin search_path on SECURITY DEFINER functions missing it
-- Created: 2026-07-19
--
-- Fresh database schema audit (docs/withdrawals/09-security-audit-findings-2026-07-19.md
-- documented that the previous pass's DB audit agent hit its own session
-- limit and never produced findings). This pass queried pg_proc directly for
-- every SECURITY DEFINER function in public and checked proconfig for a
-- search_path setting.
--
-- Found 5 with none: handle_bounty_request_notification,
-- handle_new_message_notification, handle_user_deletion_cleanup,
-- is_conversation_creator, validate_new_user_email. Every SECURITY DEFINER
-- function added or fixed elsewhere this project already pins
-- `SET search_path = public` (get_my_profile, fn_close_dispute_hold,
-- fn_accept_bounty_request, etc.) -- these five predate that convention.
--
-- Risk: a SECURITY DEFINER function without a pinned search_path resolves
-- unqualified identifiers using the CALLING session's search_path, not a
-- fixed one -- the standard Postgres SECURITY DEFINER footgun (if a caller's
-- search_path could ever place another schema ahead of public, an unqualified
-- reference inside the function could resolve to an attacker-controlled
-- object instead of the intended public.* one). Checked all 5 function
-- bodies via pg_get_functiondef before writing this migration:
-- handle_bounty_request_notification, handle_new_message_notification,
-- handle_user_deletion_cleanup, and validate_new_user_email already
-- fully-qualify every internal reference with `public.` (this fix is
-- defense-in-depth for those four, matching the project's own established
-- convention elsewhere). is_conversation_creator(uuid) does NOT --
-- `SELECT 1 FROM conversations WHERE id = p_conv_id AND created_by = ...`
-- references `conversations` unqualified, so this fix closes a real
-- (if narrow -- Supabase's default grants don't let `authenticated`/`anon`
-- create schemas or objects ahead of public in their own search_path)
-- instance of the pattern, not just a best-practice tidy-up.
--
-- Pure ALTER FUNCTION ... SET search_path -- no function body changes, no
-- behavior change, fully additive/reversible (ALTER FUNCTION ... RESET
-- search_path; to undo).

ALTER FUNCTION public.handle_bounty_request_notification() SET search_path = public;
ALTER FUNCTION public.handle_new_message_notification() SET search_path = public;
ALTER FUNCTION public.handle_user_deletion_cleanup() SET search_path = public;
ALTER FUNCTION public.is_conversation_creator(uuid) SET search_path = public;
ALTER FUNCTION public.validate_new_user_email() SET search_path = public;
