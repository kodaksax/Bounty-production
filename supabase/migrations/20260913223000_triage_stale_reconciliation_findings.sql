-- =====================================================================
-- One-time triage of reconciliation_findings left open by two already-
-- resolved incidents. acknowledged_at/resolved_at exist on every row but
-- have never been written by anything (0 of 629 findings acknowledged in a
-- 12-day window) — the admin-side acknowledge_finding action existed but
-- list_balance_findings hard-allowlisted 6 finding_types that excluded the
-- highest-severity ones (balance_drift, stuck_pending_withdrawal,
-- completed_withdrawal_without_payout*), so nobody could ever see these to
-- act on them. That allowlist is fixed in admin-withdrawals/index.ts
-- alongside this migration.
--
-- Resolved here, all independently verified against live data before
-- writing:
--
-- 1) stuck_pending_withdrawal x2, balance_drift x1 (critical), and
--    connect_account_balance_drift x1 all trace back to ONE incident: the
--    circular two-hop payout matcher bug (docs/withdrawals/18-two-hop-
--    payout-matcher-gap-2026-09-08.md). Transaction 205beb22-6d9f-4a25-
--    b8ff-49f7514b4f2d ($49.36) is now `completed`, stripe_payout_status
--    = 'paid', stripe_payout_id = po_1UB2dyJpXfRe26ucsYZclZ4b — Stripe
--    settled it. Transaction d164ae8b-8c93-4045-a538-3e4089c7c625 ($10) is
--    also `completed` with a real stripe_payout_id
--    (po_1UD9qGJFI0kXpnUQ42R0Ntdu), though its stripe_payout_status is still
--    NULL (promoted outside the payout.paid CAS path) — settlement_state
--    therefore still reads 'stripe_pending' despite the withdrawal being
--    done. Flagged in the resolution text as a follow-up needing a live
--    Stripe payout-status check before stamping; not guessed at here.
--
-- 2) completed_withdrawal_without_payout (singular, transaction
--    90aa8ae9-55c0-478f-b816-eb4a493a2ddd) and all 71
--    completed_withdrawal_without_payout_total rows are the pre-2026-09-01
--    shape of the SAME known 25-row instant-payout-fallback backlog
--    (2026-08-13 incident). reconciliation-logic.ts's
--    splitInvariantViolations()/INVARIANT_GRANDFATHER_CUTOFF_ISO, added
--    2026-09-01, now correctly re-files this same backlog as
--    completed_withdrawal_without_payout_grandfathered (INFO) instead —
--    confirmed live: all 25 violating rows predate the 2026-08-15 cutoff,
--    and neither finding_type has fired since 2026-09-02. These rows are
--    dead artifacts of the pre-fix code, not new information.
--
-- Deliberately NOT touched: the 2 orphan_stripe_payout findings from
-- 2026-08-16 (payout ids po_1U4sV2JU6XUMJosIWtxLou6l,
-- po_1U4sW2JFI0kXpnUQ0wOV5MLP) — verified live that no wallet_transactions
-- row exists for either payout id. These are genuinely unexplained and
-- stay open for investigation.
-- =====================================================================

UPDATE public.reconciliation_findings
SET
  acknowledged_at = NOW(),
  resolved_at = NOW(),
  resolution = 'Root-caused to the two-hop payout matcher bug (docs/withdrawals/18-two-hop-payout-matcher-gap-2026-09-08.md), fixed 2026-09-08. Transaction 205beb22-6d9f-4a25-b8ff-49f7514b4f2d ($49.36) verified completed with stripe_payout_status=paid. Transaction d164ae8b-8c93-4045-a538-3e4089c7c625 ($10) is completed with a real stripe_payout_id but stripe_payout_status is still NULL (settlement_state reads stripe_pending) — needs a live Stripe payout-status check before stamping; not corrected here since that requires Stripe API confirmation, not a data update.'
WHERE id IN (
  'a5ac3e2e-93b1-4527-bc81-5e9480144e9e', -- stuck_pending_withdrawal (d164ae8b tx)
  '90931ced-3daa-4858-bb6f-8c37c52fedb6', -- stuck_pending_withdrawal (205beb22 tx)
  '109380cd-b218-4b00-9321-4df385ab8aba', -- balance_drift (critical, 205beb22 tx)
  'de1f29b8-5158-4641-87ab-42b0528dfb89'  -- connect_account_balance_drift (205beb22 tx)
)
AND resolved_at IS NULL;

UPDATE public.reconciliation_findings
SET
  acknowledged_at = NOW(),
  resolved_at = NOW(),
  resolution = 'Superseded by the 2026-09-01 grandfathering fix (INVARIANT_GRANDFATHER_CUTOFF_ISO / splitInvariantViolations in reconciliation-logic.ts). This finding predates that fix; the same underlying backlog (25 rows from the 2026-08-13 instant-payout-fallback incident, all created before the 2026-08-15 cutoff) is now correctly re-filed as completed_withdrawal_without_payout_grandfathered (INFO) on every subsequent run. Neither finding_type has fired since 2026-09-02.'
WHERE finding_type IN ('completed_withdrawal_without_payout', 'completed_withdrawal_without_payout_total')
AND resolved_at IS NULL;
