-- =====================================================================
-- profiles.withdrawal_count / last_withdrawal_at were added to the schema
-- but nothing ever wrote to them: the webhook that promotes a withdrawal to
-- 'completed' (payout.paid) and the admin mark_externally_settled action
-- (manually_paid) both close the wallet_transactions row and stop there.
-- Every hunter who has ever successfully withdrawn shows 0 withdrawals /
-- never withdrawn on their profile.
--
-- This adds the atomic counter RPC the two call sites now use, and backfills
-- the columns from the existing ledger so history is not lost.
-- =====================================================================

-- withdrawal_count / last_withdrawal_at are guarded by
-- prevent_client_writes_to_protected_profile_columns() (BEFORE UPDATE trigger
-- on public.profiles — see 20260719120000_fix_profile_guard_blocks_trusted_writes.sql),
-- which rejects any write to them unless auth.role() = 'service_role' or the
-- app.bypass_profile_guard transaction-local flag is set. This function is
-- called from Edge Functions via service_role, which already satisfies the
-- guard — but the flag is set anyway (matching update_balance/withdraw_balance's
-- own convention) so this function also works when invoked from a migration
-- or another SECURITY DEFINER caller that isn't running as service_role.
CREATE OR REPLACE FUNCTION public.increment_withdrawal_counter(
  p_user_id UUID,
  p_completed_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  UPDATE public.profiles
  SET
    withdrawal_count = COALESCE(withdrawal_count, 0) + 1,
    -- GREATEST guards against an out-of-order webhook/admin-action replay
    -- moving the timestamp backwards.
    last_withdrawal_at = GREATEST(COALESCE(last_withdrawal_at, p_completed_at), p_completed_at)
  WHERE id = p_user_id;

  PERFORM set_config('app.bypass_profile_guard', 'off', true);
END;
$$;

COMMENT ON FUNCTION public.increment_withdrawal_counter(UUID, TIMESTAMPTZ) IS
  'Atomically bumps profiles.withdrawal_count and last_withdrawal_at. Called exactly once per withdrawal that reaches a paid-out terminal state (completed via payout.paid, or manually_paid via mark_externally_settled) — never for failed/pending withdrawals.';

REVOKE ALL ON FUNCTION public.increment_withdrawal_counter(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_withdrawal_counter(UUID, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_withdrawal_counter(UUID, TIMESTAMPTZ) TO service_role;

-- ---------------------------------------------------------------------
-- Backfill: every hunter who has already withdrawn successfully at least
-- once, using the terminal statuses that represent a real payout
-- ('completed' and 'manually_paid' — never 'pending'/'failed').
-- ---------------------------------------------------------------------
SELECT set_config('app.bypass_profile_guard', 'on', true);

WITH paid_withdrawals AS (
  SELECT
    user_id,
    COUNT(*) AS withdrawal_count,
    MAX(COALESCE(completed_at, created_at)) AS last_withdrawal_at
  FROM public.wallet_transactions
  WHERE type = 'withdrawal'
    AND status IN ('completed', 'manually_paid')
    AND user_id IS NOT NULL
  GROUP BY user_id
)
UPDATE public.profiles p
SET
  withdrawal_count = pw.withdrawal_count,
  last_withdrawal_at = pw.last_withdrawal_at
FROM paid_withdrawals pw
WHERE p.id = pw.user_id;

SELECT set_config('app.bypass_profile_guard', 'off', true);
