-- Close an anon EXECUTE grant on the legacy withdrawal RPCs.
--
-- 20260828195302_atomic_legacy_withdrawals.sql revoked EXECUTE from PUBLIC and
-- authenticated, but not from anon, so the project's default privileges left
-- anon holding EXECUTE. These are SECURITY DEFINER functions that take
-- p_user_id as a parameter and move money, so an unauthenticated PostgREST
-- call could reserve a withdrawal against any user's balance, or credit a
-- balance via fail_legacy_withdrawal. They are only ever invoked by the
-- connect edge function using the service_role key.
--
-- Matches the grants already on the sibling money functions
-- public.withdraw_balance and public.update_balance (service_role only).

REVOKE ALL ON FUNCTION public.begin_legacy_withdrawal(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.retry_failed_withdrawal(UUID, UUID, NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION public.fail_legacy_withdrawal(UUID, UUID, TEXT, TEXT, JSONB) FROM anon;
