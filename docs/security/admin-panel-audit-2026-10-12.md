# Admin panel and trust-operations audit (2026-10-12)

Branch `admin-hardening/2026-10-12`. Every finding was confirmed against production
(`xwlwqzzphmmhghiqvkeu`) with read-only queries, or reproduced on staging inside a
rolled-back transaction. Nothing in this work has been applied to production or deployed.

## 1. Executive summary

The console's access control is mostly sound. Every `admin_*` RPC is gated by
`admin_assert_role()`, the admin edge functions check `app_metadata.role` server-side,
and the role cannot be self-granted. The weak points are elsewhere: money-moving
admin actions that can end in a state where funds are stranded, and screens that
report success, or show nothing, when the backend did something else.

**The five most consequential risks**

1. **Admins can strand or skip escrow.** `admin_set_bounty_status` checks only the
   lifecycle edge, and the lifecycle guard explicitly skips admins. On 2026-10-07 an
   admin cancelled bounty `5e96aaed` (reason: NULL). The poster's $35 Stripe payment
   is still `captured`, with no refund issued.
2. **Dispute resolution reports success when no money moved.** The decision is
   written first and the release/refund runs best-effort. The service returns `true`
   regardless, and the screen always said "Funds released to hunter." For Stripe
   (Phase 2) bounties the payment service rejects every admin release or cancel
   (`403 not_poster`), so those disputes can never settle from the console. Dispute
   #19 is `resolved_hunter_wins`, but its ledger holds only the escrow debit.
3. **About $172 is already stranded on 13 bounties in terminal states** (§6). Nine
   of the 13 have no owner, because account deletion nulled `poster_id` while the
   escrow was still held.
4. **Any signed-in user could send "security" notifications to anyone.**
   `send_system_notification` accepted free-text title and body with type
   `account_restricted`, which made it a phishing channel that looks like Bounty
   Trust & Safety. It was flagged on 10-02 and was still open.
5. **The console is blind to the ledger and the audit trail.** RLS returned zero
   rows, with no error, for `wallet_transactions` (0 of 332 rows have the
   `sender_id`/`receiver_id` the policy keys on), `admin_action_log`,
   `payout_audit_log`, `bounty_requests`, `completion_submissions`,
   `dispute_evidence` and `bounty_cancellations`. The dashboard showed $0 held
   escrow and 0 failed transactions, against 4 real failures. The Audit Logs screen
   was always empty.

**Immediate actions (each needs your go)**

1. Apply `20261012120000` and then `20261012120100` to production. Both are
   verified on staging (§5).
2. Merge the branch after the migrations are applied. The RLS deploy gate fails
   until they are, by design.
3. Decide the repairs in §6. Start with `5e96aaed` ($35 captured, external poster)
   and dispute #19.

## 2. Current-state capability matrix

| Capability | Status before this work | Where | Risk | Next step |
|---|---|---|---|---|
| Admin gate (UI) | Works; UX only | `app/admin/_layout.tsx`, `lib/admin-context.tsx` | Low | None |
| Admin gate (server) | Works, but trusts the JWT claim alone, so revocation lags up to token TTL | `admin_assert_role()`, admin-* fns | P1 | **Fixed for RPCs**: live `auth.users` check |
| Grant/revoke admin | Works, audited, no self-change | `admin-profiles` `updateRole` | P2 | MFA / step-up (not done) |
| User search/detail | Works via service role; `getById` returns `select('*')` | `admin-profiles` | P2 | Trim the column set |
| Suspend/ban/restore | Works, audited, reason required; admin could change own status | `admin-profiles` `updateStatus` | P2 | **Fixed**: self-change blocked. Suspension still leaves listings live (known) |
| Bounty status override | **Strands or skips escrow**; reason optional | `admin_set_bounty_status` | **P0** | **Fixed**: escrow guard + reason required |
| Approve cancellation (refund) | Works, transactional, idempotent | `admin_approve_bounty_cancellation` | Low | None |
| Moderation takedown | Works, audited (`bounty_moderation_events`); takedown of a funded listing strands escrow | `admin_moderation_transition` | P1 | Refund-on-takedown design (not done) |
| Dispute list/detail | Works; internal notes, resolutions and appeals blocked by dead policies; evidence invisible | `app/admin/disputes/*`, dispute_* RLS | P1 | **Fixed** (policies) |
| Dispute resolve | **Reports success when money didn't move**; v2 settlement impossible for admins | `lib/services/dispute-service.ts`, `bounty-payments` | **P0** | **Fixed** honest outcome + retry; v2 admin path needs approval |
| Dispute escalate | **Always failed** (`escalated_at` column does not exist); "admins notified" false (`admin_notifications` table missing) | `dispute-service.escalateDispute` | P1 | **Fixed** button; admin notification delivery not built |
| ID verification review | Works but unaudited; could approve with no submission; self-review possible; no concurrency check | `admin-review-id` | P1 | **Fixed** |
| Transactions view | **Empty** (RLS) | `adminDataClient.fetchAdminTransactions` | P1 | **Fixed** (admin SELECT) |
| Escrow/failed metrics | **Wrong** ($0 / 0) | `fetchAdminMetrics` | P1 | **Fixed** (same policy) |
| Withdrawal recovery | Works, audited; manual adjustment **non-atomic, non-idempotent, ledger insert always rejected**, self-credit possible | `admin-withdrawals` | **P0 (latent, 0 uses)** | **Fixed**: atomic RPC |
| Reverse transfer / mark settled / force retry | Work, audited; could target own withdrawal | `admin-withdrawals` | P2 | **Fixed**: self-target blocked |
| Reconciliation | Runs; 44 open findings; `record_reconciliation_finding` was client-callable (could overwrite `details`) | `reconciliation`, DB | P1 | **Fixed** grant |
| Audit log screen | **Empty** (RLS on `admin_action_log`, `payout_audit_log`) | `audit-log-service.ts` | P1 | **Fixed** (admin SELECT) |
| Audit log integrity | Service role could UPDATE/DELETE `admin_action_log` | table | P2 | **Fixed**: append-only trigger |
| Command Center / anomalies / timeline | Works (`bounty_events` live, 5,868 rows) | `commandCenterClient` | Low | Add a stranded-escrow anomaly (§4) |
| Review queue (72h window) | RPC does not exist on prod (`20261002120100` unapplied); screen shows an error state | `review-queue.tsx` | P2 | Apply that migration when approved |
| Feedback reports admin | Dead `profiles.role` policies (known) | `feedback_reports` | P2 | Switch to `is_admin()` |

## 3. Findings and remediation plan

Each entry gives the failure, evidence, impact, remediation and how it is tested.
"Fixed" means fixed on this branch and verified (§5), not yet live.

### P0

**A1. Admin status change strands or skips escrow.** *Fixed.*
- Evidence: `admin_set_bounty_status` validates only `admin_bounty_status_transition_allowed`.
  `fn_bounties_guard_lifecycle` returns early for admins and for SECURITY DEFINER callers.
  `bounty_events` shows `admin.status_changed open→cancelled` on `5e96aaed`, reason
  NULL, actor internal. `bounty_payments.status` is still `captured`.
- Impact: posters lose access to their money with no refund path in the console.
  "Mark completed" closes a job without paying the hunter. The confirmation copy
  told admins refunds were "handled on the Transactions and Disputes screens";
  Transactions is read-only, and nothing refunds an open bounty.
- Remediation: `fn_bounty_unsettled_escrow_reason()` (wallet escrow without a
  release or refund; `bounty_payments` authorized, captured, release_pending,
  refund_pending or disputed; v3 funding held). Ending, archiving or reopening is
  refused with SQLSTATE `55000` until the money is settled. A reason is required,
  the row is locked `FOR UPDATE`, and the client maps the error to `ESCROW_UNSETTLED`.
- Test: staging §9 (11 checks): held escrow is refused for cancel, archive and
  complete; allowed after a recorded release or refund; the `5e96aaed` shape is
  refused; the reason lands on `bounty_events`.

**A2. Dispute resolution claims money moved when it didn't.** *Fixed (honesty + retry). Not fixed: v2 admin settlement.*
- Evidence: `dispute-service.resolveDispute` swallowed every escrow error and
  returned `true`. `bounty-payments/index.ts:847,1208,1475` return `403 not_poster`
  to non-posters. Dispute #19 is `resolved_hunter_wins` with ledger
  `escrow:-1.00` and no release. None of the 6 disputes has `resolved_by` set.
- Impact: hunters "win" and are not paid; posters are told they were refunded.
  Admins have no signal that anything is wrong.
- Remediation: `resolveDisputeWithOutcome()` returns
  `{ resolved, settlement: released | refunded | already_settled | nothing_held | not_applicable | failed }`,
  and the screen shows "Decision saved, money NOT moved" with the reason.
  `retryDisputeSettlement()` re-runs only the money step, through the existing
  idempotent wallet RPCs. Each resolution and retry is written to
  `dispute_audit_log` with the actor. The "Funds Released" label became
  "Decided for".
- **Needs your approval:** a service-role admin entry point in `bounty-payments`
  for `/release` and `/cancel` on disputed bounties. This changes who may move
  Stripe money, so it was not built.
- Test: `__tests__/unit/dispute-resolution-outcome.test.ts` (9 tests), including
  the 403 path and the dispute #19 shape.

**A3. Manual balance adjustment.** *Fixed. Latent: 0 uses in prod.*
- Evidence: the ledger insert uses type `admin_adjustment`, which prod's
  `wallet_transactions_type_check` does not allow. The balance changed in a
  separate call before the insert; there was no idempotency key; `userId ===
  adminUser.id` was allowed.
- Impact: the first real use would have moved a balance with no ledger row while
  reporting "Adjustment applied". A timeout followed by a retry credits twice. An
  admin could credit themselves and then withdraw.
- Remediation: `admin_apply_balance_adjustment()` (service_role only) writes the
  balance, ledger row and audit row in one transaction, keyed by `(user_id,
  idempotency_key)` with a unique index. A replay returns `replayed: true`; reusing
  a key for a different amount is refused, as is self-adjustment. The redundant
  CHECK is dropped (the enum still constrains the column). The screen keeps one
  key per intended adjustment, so a retry is safe.
- Test: PGlite 12/12 (credit, replay, conflict, overdraft, unknown user, rollback
  when the audit insert fails, debit). Staging covers the validation paths.

**A4. `send_system_notification` phishing channel.** *Fixed.*
- Evidence: SECURITY DEFINER, executable by `authenticated`, no caller check.
  Reproduced on staging: a stranger sent `account_restricted` "Verify at
  evil.example" to another user.
- Remediation: admins and backend contexts keep full control. Signed-in
  non-admins may only send `dispute_created`, `workflow_dispute_created` or
  `dispute_resolved`, only between parties of a bounty that has a dispute, and
  the title, body and data are server-composed. Every existing client call
  already passes `bountyId`, so current app builds keep working.
- Test: staging §7 (10 checks).

**A5. Money already stranded.** *Not repaired; dry run in §6.*

**A6. Cross-reference: the paid-completion guard is not on prod.**
`20261005010000_require_paid_bounty_release_before_completion` is not applied
(`fn_bounties_guard_paid_completion` does not exist), so posters can still mark
paid bounties complete without a release. This is outside the admin scope but
compounds A1. Apply it with explicit approval.

### P1

- **B1. Revocation lag.** *Fixed for RPCs and the new policies.* `public.is_admin()`
  requires the JWT claim and the live `auth.users` role to agree, and
  `admin_assert_role()` uses it. Staging: a token that claims admin without the
  live role is refused, and an admin whose role is revoked mid-session is refused
  immediately. Still JWT-only (lag up to token TTL): inline policies on `reports`,
  `bounty_disputes` UPDATE, `bounty_events`, the moderation tables and
  `dispute_audit_log`. Converting them is a follow-up.
- **B2. Console blind to records.** *Fixed.* SELECT-only admin policies on seven
  tables. Staging: the admin sees every row, and strangers and forged tokens still
  see none.
- **B3. Dead dispute policies.** *Fixed.* These used `auth.jwt() ->> 'role'`,
  which is always `authenticated`. Staging: the admin can write internal notes and
  resolutions; parties cannot write them and cannot read the notes.
- **B4. `record_reconciliation_finding` client-callable.** *Fixed.* It could
  insert fake findings or overwrite `details` on open ones. Its only callers are
  service_role and two SECURITY DEFINER functions owned by `postgres` (verified).
- **B5. ID review.** *Fixed.* Approve now requires `pending`; reject or revoke
  requires `pending` or `verified`. Self-review is blocked, the update is
  compare-and-set, and each decision writes `admin_action_log`
  (`id_verification_review`, with old and new status).
- **B6. Escalate.** *Button fixed; notifications not built.* There is no
  `admin_notifications` table, so `notifyAdminsOfDispute` has always failed. The
  copy no longer claims admins were notified.
- **B7. Self-targeting.** *Fixed.* Admins cannot act on their own withdrawal
  (force retry, settle, reverse), balance, account status or ID review.
- **B8. Moderation takedown of a funded listing strands escrow.** *Not fixed.*
  Takedown must stay possible for safety. This needs a refund-on-removal design.
- **B9. Account deletion leaves held escrow with no owner.** *Not fixed.* Nine of
  the §6 rows have `poster_id` NULL. Deletion should settle held escrow or refuse.
- **B10. Suspension leaves listings live.** *Not fixed* (known from the 10-02
  re-audit).

### P2

- **C1.** `admin_action_log` is append-only, including for service_role (UPDATE,
  DELETE and TRUNCATE are blocked). *Fixed.*
- **C2.** `increment_withdrawal_counter` was executable by `anon`. *Fixed.*
- **C3.** There is one flat admin role: any admin can grant admin, adjust up to
  $10,000, or reverse transfers, with no MFA or step-up. Leaked-password
  protection is off in Auth. Recommendation: require `aal2` (MFA) in
  `is_admin()` once admins enrol, and turn leaked-password protection on. Defer a
  separate finance role until there are more than two admins.
- **C4.** `admin-profiles getById` returns `select('*')`. Trim it to the fields
  the screen renders.
- **C5.** Status-change reasons are generated from the button label. Add a reason
  input.
- **C6.** The audit trail is split across five tables, and the Audit Logs screen
  merges four of them. `bounty_events` admin rows and moderation events are not on
  that screen.
- **C7.** The review-queue screen depends on the unapplied `20261002120100`.
- **C8.** `feedback_reports` admin policies use the dead `profiles.role` pattern.

### P3

- `admin-*` functions also accept `app_metadata.roles` arrays; the DB checks only
  `role`. This is harmless because only service_role can write app_metadata.
- `assert_profile_balance_not_frozen` is client-callable, which leaks whether a
  profile exists and whether it is frozen.
- The advisor flags `public_bounties` and `public_profiles` as SECURITY DEFINER
  views; review them separately.

## 4. Implementation (this branch)

| File | Change |
|---|---|
| `supabase/migrations/20261012120000_admin_authorization_hardening.sql` | `is_admin()`, `admin_assert_role()`; fixed dispute policies; admin SELECT on 7 tables; append-only `admin_action_log` + `id_verification_review` type; caller-aware `send_system_notification`; revoke client EXECUTE on `record_reconciliation_finding`, `increment_withdrawal_counter` |
| `supabase/migrations/20261012120100_admin_financial_action_guards.sql` | `fn_bounty_unsettled_escrow_reason()`; escrow guard + required reason in `admin_set_bounty_status`; drop stale `wallet_transactions_type_check`; `admin_apply_balance_adjustment()` + idempotency index |
| `supabase/rollbacks/production/20261012120000_*.down.sql`, `20261012120100_*.down.sql` | Restore the captured prod definitions. Deliberately not restored: the revoked grants and the dropped CHECK (they reopen holes without restoring function) |
| `supabase/functions/admin-withdrawals/index.ts` | Manual adjustment via RPC with required `idempotencyKey`; self-target blocks on adjust, retry, settle, reverse |
| `supabase/functions/admin-review-id/index.ts` | Self-review block, state precondition, compare-and-set update, audit row |
| `supabase/functions/admin-profiles/index.ts` | Self status-change block |
| `lib/services/dispute-service.ts` | `resolveDisputeWithOutcome`, `retryDisputeSettlement`, `settleDisputeEscrow`; escalate column fix; audit insert errors logged |
| `app/admin/disputes/[id].tsx` | Honest outcome alerts, "Settle money" retry, "Decided for" label, escalate copy |
| `lib/admin/adminDataClient.ts`, `app/admin/bounty/[id]/index.tsx`, `hooks/useAdminBounties.ts` | `ESCROW_UNSETTLED` mapping; reasons passed; corrected confirmation copy |
| `app/admin/withdrawal-recovery.tsx` | Stable per-adjustment idempotency key; replay and timeout copy |
| `supabase/security/rls-manifest.json` | Baseline for 4 new multi-permissive SELECT findings; forbid-execute entries for 5 functions |
| `scripts/verify-admin-hardening.js`, `scripts/verify-admin-adjustment-pglite.js` | DB verification suites |
| `__tests__/unit/dispute-resolution-outcome.test.ts`, `__tests__/unit/admin-bounty-removal.test.ts` | Regression tests |

**Behavior changes to know about**
- Admin app builds older than this change call `admin_set_bounty_status`
  without a reason, so status changes from those builds fail with a generic
  error until the admin client updates. Manual adjustments from old builds are
  refused (no idempotency key). This is admin-only.
- The RLS deploy gate now fails on production until both migrations are applied
  (5 expected errors). That blocks the edge-function auto-deploy, which enforces
  "database first".

**Recommended next (not built)**
- Add a stranded-escrow row type to `admin_financial_anomalies`, using
  `fn_bounty_unsettled_escrow_reason()` on terminal bounties. It would have caught
  every row in §6.
- The v2 admin settlement path (A2), refund-on-takedown (B8), settle-on-deletion
  (B9), and MFA for admins (C3).

## 5. Verification

| Check | Result |
|---|---|
| `node scripts/verify-admin-hardening.js` (staging, one transaction, rolled back) | **66/66**. Includes 4 pre-fix reproductions of the findings, the RLS gate on the migrated schema, and both rollback files. Afterwards staging was confirmed unchanged (no new functions, policies or fixtures) |
| `node scripts/verify-admin-adjustment-pglite.js` | **12/12** |
| `npx jest` (full) | 397 suites passed, 2 skipped; 5,310 tests passed, 0 failed |
| `npx tsc --noEmit` | 9 errors, the same 9 as `main` (font module, typed routes); none in touched files |
| `deno check` admin-withdrawals, admin-review-id, admin-profiles | Pass |
| `check-rls-policies --env staging/production` today | Both OK before this change. With the new manifest, prod fails with the 5 expected errors until the migrations are applied |

Not verified: anything on production after apply; admin screens on a device;
Stripe-side state of the `refund_pending` rows in §6.

**Done means observed** (check these after apply and deploy):
`bounty_events` `admin.status_changed` rows with a non-null `metadata.reason`;
`admin_action_log` `id_verification_review` rows after the next ID review;
`dispute_audit_log` `resolved` rows with `details.settlement`; and a re-run of
the §6 query showing no new stranded rows.

**Deploy order** (explicit go at each production step):
1. Apply `20261012120000`, then `20261012120100`, to production. Rename the
   migration files to the ledger versions afterwards (see the migration-drift note).
2. `node scripts/check-rls-policies.js --env production`, expecting OK.
3. Merge. This auto-deploys the three edge functions. Confirm the deployed source
   with `get_edge_function`.
4. Ship the admin client (OTA or build).

## 6. Stranded money: dry run (no changes made)

Terminal-state bounties whose escrow was never released or refunded, as of
2026-10-12. Amounts come from the ledger and `bounty_payments`.

| Bounty | Status | Held | Kind | Owner | Notes |
|---|---|---|---|---|---|
| `5e96aaed` | cancelled | $35 | Stripe `captured` | external | Cancelled by an admin 10-07, no reason. **Refund the poster.** |
| `bdaa3028` | archived | $15 | Stripe `refund_pending` | external | Since 09-13; check in Stripe |
| `060079f5` | deleted | $5 | Stripe `captured` | deleted account | `bounty_payments.poster_id` identifies the payer |
| `213c13db` | deleted | $10 | Stripe `captured` | deleted account | same |
| `525defa2` | deleted | $15 | Stripe `refund_pending` | deleted account | Check in Stripe |
| `d252da67` | deleted | $15 | Stripe `refund_pending` | deleted account | Check in Stripe |
| `cb199e9d` | archived | $16 | wallet | deleted account | `wallet_transactions.user_id` identifies the payer |
| `9e16ecfe` | archived | $5 | wallet | deleted account | |
| `eccfddee` | archived | $5 | wallet | deleted account | |
| `5088d76c` | archived | $5 | wallet | deleted account | A hunter was accepted; possibly unpaid |
| `542ec452` | archived | $5 | wallet | deleted account | A hunter was accepted; possibly unpaid |
| `5ba1267c` | deleted | $40 | wallet | internal | Test account |
| `bba5e784` | completed | $1 | wallet | internal | Dispute #19, hunter won, never paid |

Totals: Stripe $95 ($50 captured, $45 refund_pending); wallet $77; **$172 overall**.
$41 of it belongs to internal accounts.

Each repair needs a per-row decision, because refund and release go to different
people, and deleted accounts may not be refundable in-app. For the Stripe rows,
first read the PaymentIntent and refund state in Stripe; `refund_pending` may
already be settled there with only the webhook missing. No balance, ledger or
Stripe object was changed during this audit.
