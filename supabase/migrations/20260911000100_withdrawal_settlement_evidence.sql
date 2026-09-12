-- A completed withdrawal must be PROVABLY settled, not just believed settled.
--
-- WHY
-- ---
-- On 2026-09-10 the launch-readiness audit found that of 31 production
-- withdrawals shown to users as "completed", exactly ONE carries
-- settlement_state='stripe_settled'. Five sit at 'stripe_pending' forever and
-- 25 at 'ledger_only'.
--
-- The five are the live defect. Traced on `d164ae8b` ($10, created 09-07):
--
--   09-08 12:15  a reconciliation pass verified the payout against Stripe and
--                wrote status='completed', recording payout_status:'paid' in
--                METADATA but not in the stripe_payout_status COLUMN.
--   09-08 12:41  Stripe's own payout.paid webhook arrived and was stored with
--                processed=true.
--                Its promotion is a compare-and-set on status='pending'
--                (supabase/functions/webhooks/index.ts), so it matched zero
--                rows and wrote nothing.
--
-- settlement_state is derived from stripe_payout_status and nothing else, so
-- the row is stuck at 'stripe_pending' permanently. Nobody lost money — Stripe
-- did pay — but the column built specifically to detect a payout that did NOT
-- arrive is now wrong on rows where it did, which is worse: it can no longer
-- tell the two apart.
--
-- The webhook side is fixed in code (it now stamps settlement on an
-- already-completed row, and decidePayoutEventAction no longer lets a
-- prematurely-completed row absorb a payout.failed without refunding). This
-- migration closes the storage side so no writer can create the state again.
--
-- PREREQUISITE
-- ------------
-- `stripe_payout_status` arrives with the ADR-0001 settlement migrations.
-- Production has it; staging does not (verified 2026-09-11 — the column is
-- simply absent there), the same environment drift that made the payment
-- oracle schema-gate its `completed_at` check. Every section below is
-- therefore conditional: on a project that has not caught up this migration
-- is a no-op with a NOTICE, rather than a hard failure that would block every
-- migration behind it. Re-run it once the settlement columns land.

-- ---------------------------------------------------------------------------
-- 1. The constraint
-- ---------------------------------------------------------------------------
--
-- Follows the shape of the existing
-- `wallet_transactions_completed_withdrawal_requires_payout`, which
-- grandfathers history with a created_at cutoff rather than NOT VALID. Same
-- idea, stronger requirement: a payout id is not evidence of payment, a
-- settled payout status is.
--
-- `manually_paid` is deliberately untouched — it is the admin escape hatch for
-- money moved outside Stripe, and it is a different status value.

DO $$
DECLARE
  v_stamped integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wallet_transactions'
      AND column_name = 'stripe_payout_status'
  ) THEN
    RAISE NOTICE 'SKIPPED 20260911000100: wallet_transactions.stripe_payout_status does not exist here. Apply the ADR-0001 settlement migrations, then re-run.';
    RETURN;
  END IF;

  ALTER TABLE public.wallet_transactions
    DROP CONSTRAINT IF EXISTS wallet_transactions_completed_withdrawal_requires_settlement;

  ALTER TABLE public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_completed_withdrawal_requires_settlement
    CHECK (
      type <> 'withdrawal'::wallet_tx_type_enum
      OR status <> 'completed'::wallet_tx_status_enum
      -- Explicitly typed to match wallet_transactions_stripe_payout_status_valid's
      -- own convention ('paid'::text, ...) rather than an untyped literal, so
      -- this keeps comparing correctly (or fails loudly at creation instead of
      -- misbehaving silently) if the column is ever changed from `text` to an
      -- enum. It is `text` today (20260824010000_add_stripe_payout_status_column.sql).
      OR stripe_payout_status = 'paid'::text
      OR created_at < '2026-09-11 00:00:00+00'::timestamptz
    );

  COMMENT ON CONSTRAINT wallet_transactions_completed_withdrawal_requires_settlement
    ON public.wallet_transactions IS
    'A withdrawal may only read `completed` once a Stripe Payout has been observed paid. A payout id alone is not evidence — five rows reached completed with an id and no settled status. Rows created before 2026-09-11 are grandfathered; see the backfill in this migration.';

  -- ---------------------------------------------------------------------------
  -- 2. Backfill the stranded rows from evidence already in the database
  -- ---------------------------------------------------------------------------
  --
  -- Every one of the five has a payout.paid event sitting in `stripe_events`.
  -- This reads Stripe's own statement and stamps the column the derive trigger
  -- keys off. It moves no money, touches no balance, and does not alter status
  -- or completed_at — it records a settlement that already happened.
  --
  -- Idempotent: only matches rows still missing the stamp.
  --
  -- NOTE ON THE JSON PATH: `stripe_events.event_data` holds the Stripe OBJECT
  -- (the payout), not the event envelope — so the id is at `->>'id'`, not at
  -- `#>>'{data,object,id}'` as Stripe's webhook payload would suggest. The
  -- envelope path silently returns NULL and matches nothing, which is how a
  -- backfill can report success and stamp zero rows.

  WITH paid_payouts AS (
    SELECT DISTINCT e.event_data ->> 'id' AS payout_id
    FROM public.stripe_events e
    WHERE e.event_type = 'payout.paid'
      AND e.event_data ->> 'id' IS NOT NULL
      AND e.event_data ->> 'status' = 'paid'
  )
  UPDATE public.wallet_transactions w
     -- Same explicit typing as the CHECK constraint above, for the same reason.
     SET stripe_payout_status = 'paid'::text,
         updated_at = now(),
         metadata = coalesce(w.metadata, '{}'::jsonb)
                    || jsonb_build_object(
                         'payout_status', 'paid',
                         'settlement_backfilled_at', now(),
                         'settlement_backfill_source', 'stripe_events.payout.paid'
                       )
    FROM paid_payouts p
   WHERE w.stripe_payout_id = p.payout_id
     AND w.type = 'withdrawal'::wallet_tx_type_enum
     AND w.status = 'completed'::wallet_tx_status_enum
     AND w.stripe_payout_status IS NULL;

  GET DIAGNOSTICS v_stamped = ROW_COUNT;
  RAISE NOTICE 'Settlement backfill stamped % withdrawal row(s) from stripe_events (expected 5 on production as of 2026-09-11).', v_stamped;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. What this migration deliberately does NOT touch
-- ---------------------------------------------------------------------------
--
-- The 25 `ledger_only` withdrawals (2026-07-16 to 08-14, $526.65 total) have
-- no Stripe payout id at all. They are the known legacy fallback rows whose
-- disposition is still an open decision — were they paid by another route, or
-- are they owed? That is a money question with a human answer, not something a
-- migration should guess at. They stay grandfathered by the created_at cutoff
-- above and remain visible as `settlement_state = 'ledger_only'`.
--
-- After applying, this should return zero rows:
--
--   SELECT id, amount, created_at, stripe_payout_id
--     FROM public.wallet_transactions
--    WHERE type = 'withdrawal'
--      AND status = 'completed'
--      AND stripe_payout_id IS NOT NULL
--      AND stripe_payout_status IS DISTINCT FROM 'paid'::text;
