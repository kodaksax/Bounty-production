-- Postgres auto-grants EXECUTE to PUBLIC on newly created functions, and
-- REVOKE ... FROM PUBLIC does not remove anon's implicit grant. The initial
-- shadow-ledger migration revoked EXECUTE on the mapping function but not on
-- the trigger wrapper, leaving anon and authenticated holding EXECUTE on a
-- SECURITY DEFINER function. Revoke it by role name explicitly.
revoke all on function public.fn_mirror_wallet_transaction_to_ledger() from public, anon, authenticated;
