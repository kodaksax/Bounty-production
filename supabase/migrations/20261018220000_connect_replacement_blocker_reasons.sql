-- Payout-account replacement safety check: ignore bounty-matching findings and
-- report which blocker refused the replacement.
--
-- assert_connect_replacement_safe blocked on ANY open warning/critical
-- reconciliation finding for the user. Bounty-matching findings
-- (bounty_liquidity_no_candidates, bounty_location_not_geocoded,
-- bounty_geocode_result) describe a poster's listing, not money, yet they
-- blocked payout-account replacement — 10+ users in production on 2026-10-18.
--
-- Each refusal now carries a HINT reason code that the connect edge function
-- maps to user-facing copy, so a blocked hunter is told what to resolve
-- instead of a catch-all message. Exception texts are unchanged except that
-- the withdrawal and finding checks now raise separately, and the funded-bounty
-- check runs before the findings check because a stuck release usually also
-- produces a balance-drift finding and is the thing the hunter can act on.
--
-- Redefined from pg_get_functiondef in production (2026-10-18), not from the
-- 20261006230000 file, per the out-of-band migration history.

CREATE OR REPLACE FUNCTION public.assert_connect_replacement_safe(p_user_id uuid, p_account_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM connect_account_operations WHERE user_id = p_user_id AND state = 'active') THEN
    RAISE EXCEPTION 'A financial operation is in progress or requires reconciliation; contact support if it persists'
      USING HINT = 'operation_in_progress';
  END IF;
  IF EXISTS (
    SELECT 1 FROM wallet_transactions
    WHERE user_id = p_user_id AND type = 'withdrawal' AND (
      status = 'pending'
      OR (status = 'completed' AND (stripe_payout_id IS NULL OR stripe_payout_status IS DISTINCT FROM 'paid'))
      OR COALESCE(metadata->>'manual_reconciliation_required', 'false') = 'true'
      OR metadata ? 'payout_creation_failed'
      OR (status = 'failed' AND stripe_transfer_id IS NOT NULL AND stripe_payout_id IS NULL)
      OR (status = 'failed' AND stripe_payout_id IS NOT NULL
        AND (stripe_payout_status IS NULL OR stripe_payout_status NOT IN ('failed', 'canceled')))
    )
  ) THEN
    RAISE EXCEPTION 'Unresolved withdrawals must be settled before replacement'
      USING HINT = 'unsettled_withdrawal';
  END IF;
  -- Do not retarget a previously attempted release's Stripe idempotency key.
  IF EXISTS (SELECT 1 FROM bounty_payments WHERE hunter_id = p_user_id
      AND status NOT IN ('released', 'refunded', 'canceled'))
    OR EXISTS (SELECT 1 FROM bounty_v3_funding WHERE hunter_id = p_user_id
      AND state NOT IN ('released', 'canceled', 'expired'))
  THEN
    RAISE EXCEPTION 'Finish or resolve funded bounties before replacing the payout account'
      USING HINT = 'funded_bounty';
  END IF;
  IF EXISTS (
    SELECT 1 FROM reconciliation_findings
    WHERE resolved_at IS NULL AND severity IN ('warning', 'critical')
      AND finding_type NOT IN (
        'bounty_liquidity_no_candidates', 'bounty_location_not_geocoded', 'bounty_geocode_result'
      )
      AND (
        user_id = p_user_id OR details->>'accountId' = p_account_id
        OR details->>'stripe_account_id' = p_account_id
      )
  ) THEN
    RAISE EXCEPTION 'Unresolved reconciliation findings must be settled before replacement'
      USING HINT = 'reconciliation_finding';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_connect_replacement_safe(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_connect_replacement_safe(uuid, text) TO service_role;
