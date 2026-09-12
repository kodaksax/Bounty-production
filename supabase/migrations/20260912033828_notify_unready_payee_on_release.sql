-- =====================================================================
-- ADR 0001 §4.3 (option B3), items 2 and 5 — tell the hunter.
--
-- The failure on bounty 53656a8b ("Walk my cat") was not that $73.60 moved to
-- a hunter who could not withdraw it. That is recoverable: the money is in
-- their balance and becomes withdrawable the moment they finish Connect
-- onboarding. The failure was that NOBODY TOLD THEM. Both parties read
-- "completed" and reasonably concluded there was nothing left to do.
--
-- WHY A TRIGGER RATHER THAN APPLICATION CODE
-- There are three release paths, and only one of them is TypeScript:
--
--   1. POST /wallet/release                     (wallet Edge Function, v1)
--   2. POST /bounty-payments/release            (v2 — already hard-gated on
--                                                payouts_enabled, so a release
--                                                to an unready hunter cannot
--                                                happen there at all)
--   3. fn_release_wallet_escrow_for_dispute()   (PL/pgSQL, SECURITY DEFINER,
--                                                inserts the release row
--                                                directly, bypasses /wallet
--                                                entirely)
--
-- Path 3 was missed by the original audit and is unreachable from any
-- application-layer change. Attaching this to the ledger row itself means the
-- notification fires for every release ever written, including any future
-- fourth path, without that path having to remember.
--
-- DELIVERY
-- notifications_outbox is service-role only (RLS enabled, no policies) and is
-- drained every minute by the drain-notifications-outbox cron job, producing
-- both an in-app entry and a push. See docs/notifications.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_notify_unready_payee_on_release()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ready   boolean;
  v_amount  numeric;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(stripe_connect_account_id IS NOT NULL
                  AND COALESCE(stripe_connect_payouts_enabled, false), false)
    INTO v_ready
  FROM public.profiles
  WHERE id = NEW.user_id;

  -- Payout-ready hunters need no prompt: the money behaves as they expect.
  IF COALESCE(v_ready, false) THEN
    RETURN NULL;
  END IF;

  v_amount := ABS(COALESCE(NEW.amount, 0));

  INSERT INTO public.notifications_outbox (recipients, title, body, data)
  VALUES (
    jsonb_build_array(NEW.user_id),
    'Payment added to your balance',
    '$' || TO_CHAR(v_amount, 'FM999999990.00')
        || ' is in your Bounty balance. Finish payout setup to move it to your bank account.',
    jsonb_build_object(
      'kind',        'release_pending_payout_setup',
      'bounty_id',   NEW.bounty_id,
      'amount',      v_amount,
      'transaction_id', NEW.id
    )
  );

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A notification failure must never roll back a release that already moved
  -- money in the ledger. Warn loudly and let the release stand: the same
  -- fail-open discipline the reconciliation alerting uses.
  RAISE WARNING 'fn_notify_unready_payee_on_release failed for tx %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.fn_notify_unready_payee_on_release IS
  'AFTER INSERT on wallet_transactions for completed releases. Notifies a payee who cannot yet receive payouts that funds are waiting and onboarding unlocks them. Covers all release paths including the PL/pgSQL dispute release. See ADR 0001 §4.3.';

-- TWO triggers, because the two release paths reach `completed` differently and
-- a single AFTER INSERT would silently cover only one of them:
--
--   * The dispute path inserts the row already `completed` -> INSERT fires.
--   * /wallet/release inserts `pending` first and promotes via apply_release_tx
--     so a crash cannot leave a credited balance behind an uncommitted status
--     -> only the UPDATE fires.
--
-- The UPDATE variant is guarded on the transition (OLD was not already
-- completed) so a later metadata edit on a settled row cannot re-notify. A
-- WHEN clause cannot reference OLD on INSERT, which is why this is two
-- triggers rather than one with a TG_OP branch.

DROP TRIGGER IF EXISTS trg_wallet_tx_notify_unready_payee ON public.wallet_transactions;
CREATE TRIGGER trg_wallet_tx_notify_unready_payee
  AFTER INSERT ON public.wallet_transactions
  FOR EACH ROW
  WHEN (NEW.type = 'release'::wallet_tx_type_enum AND NEW.status = 'completed'::wallet_tx_status_enum)
  EXECUTE FUNCTION public.fn_notify_unready_payee_on_release();

DROP TRIGGER IF EXISTS trg_wallet_tx_notify_unready_payee_on_promote ON public.wallet_transactions;
CREATE TRIGGER trg_wallet_tx_notify_unready_payee_on_promote
  AFTER UPDATE ON public.wallet_transactions
  FOR EACH ROW
  WHEN (
    NEW.type = 'release'::wallet_tx_type_enum
    AND NEW.status = 'completed'::wallet_tx_status_enum
    AND OLD.status IS DISTINCT FROM 'completed'::wallet_tx_status_enum
  )
  EXECUTE FUNCTION public.fn_notify_unready_payee_on_release();
