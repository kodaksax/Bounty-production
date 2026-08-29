-- =====================================================================
-- ADR 0001 §2.4 — the storage-level backstop.
--
-- The trigger derives settlement_state; this constraint guarantees
-- independently that the column can never overclaim, even if the trigger is
-- dropped, replaced, or a future migration writes the column directly.
-- Application discipline AND storage-level enforcement, not one or the other —
-- the same posture as wallet_transactions_completed_withdrawal_requires_payout.
--
-- NOTE WHAT IS ABSENT: a date-based escape clause.
--
-- The 2026-08-16 constraint had to grandfather 25 rows created before
-- 2026-08-15, because it asserted something about them that was not true. This
-- one needs no exemption, because the honest classification of those same rows
-- — ledger_only — satisfies it. Truth needs no grandfathering, and that is the
-- main argument for this design over tightening the existing constraint.
--
-- A consequence worth stating: the grandfathering clause in the 2026-08-16
-- constraint keys off the ROW's created_at, not the update time, which is why
-- the admin force_retry path could still silently write a completed withdrawal
-- with no payout id against a legacy row (audit NEW-1). This constraint closes
-- that hole from the other side: force_retry's write is now rejected by the
-- evidence check regardless of how old the row is.
-- =====================================================================

ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_settlement_state_requires_evidence;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_settlement_state_requires_evidence
  CHECK (
    settlement_state <> 'stripe_settled'
    OR stripe_payout_id         IS NOT NULL
    OR stripe_transfer_id       IS NOT NULL
    OR stripe_charge_id         IS NOT NULL
    OR stripe_payment_intent_id IS NOT NULL
    OR stripe_refund_id         IS NOT NULL
  );

COMMENT ON CONSTRAINT wallet_transactions_settlement_state_requires_evidence
  ON public.wallet_transactions IS
  'A row may only claim stripe_settled when it carries at least one Stripe object id. No date exemption is needed or wanted: every historical row satisfies this once classified honestly. See ADR 0001 §2.4.';

-- The type-specific half. A withdrawal's evidence is a payout; a release's is a
-- transfer. Cross-type evidence must not satisfy the claim — without this, the
-- 2026-08-13 incident (a withdrawal marked settled on the strength of a
-- Transfer) would still pass the general constraint above, because a transfer
-- id is "some Stripe object".
ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_settled_withdrawal_requires_payout;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_settled_withdrawal_requires_payout
  CHECK (
    type <> 'withdrawal'::wallet_tx_type_enum
    OR settlement_state <> 'stripe_settled'
    OR stripe_payout_id IS NOT NULL
  );

COMMENT ON CONSTRAINT wallet_transactions_settled_withdrawal_requires_payout
  ON public.wallet_transactions IS
  'A Transfer moves money into a connected account; it puts nothing in a bank. Only a Payout settles a withdrawal. This is the 2026-08-13 incident expressed as a constraint with no grandfathering clause.';

ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_settled_release_requires_transfer;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_settled_release_requires_transfer
  CHECK (
    type <> 'release'::wallet_tx_type_enum
    OR settlement_state <> 'stripe_settled'
    OR stripe_transfer_id IS NOT NULL
  );

COMMENT ON CONSTRAINT wallet_transactions_settled_release_requires_transfer
  ON public.wallet_transactions IS
  'A release may only claim settlement with a Stripe Transfer behind it. v1 releases never have one and correctly remain ledger_only; v2 releases get theirs from the transfer.created webhook.';
