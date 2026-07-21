-- Follow-up fix: the previous migration's REVOKE ... FROM anon did not fully
-- close the gap for four functions because Postgres grants EXECUTE to the
-- PUBLIC pseudo-role by default when a function is created, and anon (like
-- every role) implicitly inherits PUBLIC grants. Revoking from anon alone
-- does not remove a PUBLIC grant. Explicitly revoke from PUBLIC as well so
-- anon (and any other non-explicitly-granted role) truly loses access.
-- authenticated and service_role retain access via their own explicit grants
-- (confirmed present from the original apply_dispute_loss_transaction,
-- fn_close_dispute_hold, fn_open_dispute_hold(integer),
-- assert_profile_balance_not_frozen grants) so legitimate admin/service
-- callers are unaffected.
--
-- Recovered from production during the 2026-07 migration drift audit: this
-- migration was applied live to production via a direct SQL execution but
-- the file itself was never committed to the repository. Reconstructed
-- verbatim from supabase_migrations.schema_migrations.statements so replays
-- (e.g. rebasing a Staging/preview branch) are reproducible going forward.

REVOKE EXECUTE ON FUNCTION public.apply_dispute_loss_transaction(uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_profile_balance_not_frozen(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_close_dispute_hold(integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_open_dispute_hold(integer) FROM PUBLIC;

-- Explicitly re-affirm the intended callers retain access (idempotent no-op
-- if already granted; ensures this migration cannot accidentally lock out
-- legitimate authenticated-admin or service_role callers).
GRANT EXECUTE ON FUNCTION public.apply_dispute_loss_transaction(uuid, numeric, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_profile_balance_not_frozen(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_close_dispute_hold(integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_open_dispute_hold(integer) TO authenticated, service_role;
