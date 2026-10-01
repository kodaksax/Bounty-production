# Trust-spine P0 hardening — deployment runbook (2026-10-01)

Implements the server-side fixes for T4/S2/S4 (escrow commitment), T5/S1 (dispute
authorization), T12/S6 (suspended posting), S5/S7 (ratings, client grants) and the
policy-CI recommendation from `docs/trust-spine-audit-2026-09-30.md`.

**Status:** applied and verified on **staging** (`gwumwpoomwvkjyibdmpj`). **Production
(`xwlwqzzphmmhghiqvkeu`) is untouched.** No migration modifies row data.

## What changes

| Migration | Fixes |
|---|---|
| `20261001120000_dispute_authorization_lockdown` | Only bounty participants can open a dispute, only on an accepted bounty, only `open` and undecided. Only admins / server paths can update; nobody deletes. Guard trigger `trg_bounty_disputes_guard`. `request_dispute_escalation()` replaces the participant `status → under_review` write. Audit log attributes admins correctly and is participant/admin-only. Anon grants removed. |
| `20261001120100_bounty_lifecycle_guard_and_refund_gate` | `trg_bounties_guard_lifecycle`: direct client writes can no longer reassign a hunter, cancel/reopen/delete a bounty a hunter is committed to, or forge `cancellation_requested`. `fn_owner_refund_block_reason()`: the single refund rule used by both edge functions. |
| `20261001120200_bounties_policy_consolidation` | One policy per command on `bounties`; INSERT requires an active account and `user_id` = caller. Anon write grants removed. |
| `20261001120300_ratings_transaction_integrity` | Ratings only from a party of a completed bounty about the other party, once, 1–5, immutable. |
| `20261001120400_bounty_cancellations_responder_policy_fix` | Fixes the self-referencing UPDATE policy that made every poster response to a hunter cancellation fail ("infinite recursion"), which stranded refunded bounties in `cancellation_requested`. Separable; recommended. |

Edge functions: `wallet` (`/refund`) and `bounty-payments` (`/cancel`) call
`_shared/owner-refund-gate.ts` before moving escrow back to the poster. The gate
**fails closed** (503 `refund_gate_unavailable`) if the DB function is missing.

Client: the dispute screen's "Request escalation" calls the new RPC (ships with the
next OTA/build; old clients' button becomes a silent no-op, see Remaining risks).

CI: `scripts/check-rls-policies.js` + `supabase/security/rls-manifest.json`,
workflow `.github/workflows/rls-policy-check.yml`, and a pre-deploy gate in
`deploy-edge-functions.yml`.

## Verification done on staging

- `t_security` suite (rolled-back transactions, PostgREST-equivalent roles and JWT
  claims): 51/55 exploit + legit checks reproduced **before**; **66/66 after**.
- HTTP end-to-end against deployed staging functions with real user JWTs: **26/26**.
- Rollback round-trip (migrate → rollback → fingerprint) restores staging exactly.
- Starting from prod's exact protected-table state (prod rollbacks replayed on
  staging), the migrations converge to the reviewed state: **52 → 0** policy errors.
- `node scripts/check-rls-policies.js --env production` (read-only) today: **52 errors**,
  the list of open holes. Staging: **OK**.

## Production deployment sequence

Order matters: **database first, then edge functions.** Merging the PR triggers the
production edge-function deploy.

1. **Configure secrets** (once): `PRODUCTION_DATABASE_URL` in the `production`
   environment and `STAGING_DATABASE_URL` in the repository. Without the production
   secret, the deploy gate only warns.
2. **Re-check prod is unchanged since 2026-10-01** (read-only):
   `node scripts/check-rls-policies.js --env production` must show the same 52 errors.
   If prod's policies or functions moved, regenerate `supabase/rollbacks/production/`
   before going further.
3. **Apply the five migrations to production in order**, each on its own, with an
   explicit go for each (they DROP and recreate policies). With the Supabase MCP
   `apply_migration`, rename each local file to the version it was recorded under
   afterwards (that tool records a fresh timestamp).
4. **Verify immediately:** `node scripts/check-rls-policies.js --env production` → OK.
5. **Merge the PR.** The deploy workflow runs the RLS gate, then deploys `wallet` and
   `bounty-payments`. Confirm the deployed source matches git (`get_edge_function`).
6. **Observe (done = observed rows):**
   - `wallet_transactions` `type='refund'` on bounties with an accepted hunter and no
     hunter cancellation: expect 0 new rows.
   - `dispute_audit_log` `action='status_changed'` with `actor_type='user'`: expect 0
     new rows. Admin decisions now log `actor_type='admin'`.
   - `bounty_cancellations` with `responder_id` set by a poster: expect the first
     client-side acceptance to succeed. It previously failed on every attempt.
7. Ship the client change (escalation RPC) with the next OTA/build.

## Rollback

1. **Edge functions first:** revert the PR's `supabase/functions/**` changes on `main`,
   or run the deploy workflow on the previous commit. If you drop the DB function
   first, the deployed gate fails closed and refunds return 503.
2. **Then the database, newest first:** run
   `supabase/rollbacks/production/20261001120400…down.sql` → `…120000…down.sql`.
   Each file is a single transaction generated from prod's live pre-migration state,
   so it restores the previous, **vulnerable** policies, grants and functions exactly.
   The CHECK constraint and unique index on `ratings` are dropped only because prod
   did not have them before.
3. Remove the corresponding rows from `supabase_migrations.schema_migrations`.
4. No data restore is needed; none of the migrations write rows.

Staging has its own rollbacks in `supabase/rollbacks/staging/`, because staging's
pre-migration policy set differed from prod's.

## Remaining risks (not addressed here)

- **S3 address exposure is still open.** Revoking `location/latitude/longitude` would
  break every shipped client that selects those columns, and client OTA is blocked.
  It needs a coordinated client release.
- Dispute **money** settlement is still client-orchestrated by the admin app (T13).
  Status is now admin-only, but release/refund after a decision is still best-effort.
- Old clients: "Request escalation" now silently updates 0 rows, so the user sees
  "Escalated" while the dispute isn't flagged, until the client change ships. Poster
  Cancel/Delete on accepted bounties now returns an error (intended).
- Prod `bounty_cancellations` INSERT policy (`insert_related`) still lets posters file
  cancellations directly, unlike the 09-08 hunter-only design. After this change that
  moves no money without the hunter's consent, but it is drift.
- Ratchet baseline: 34 known prod findings (duplicate permissive policies on
  `profiles`, `payment_methods`, `reports`…, unguarded self-only UPDATE on `messages`,
  `remediation_workflows`, `user_activation_moments`) are accepted, not reviewed.
- Legacy rows: 1 prod `open` bounty still carries `accepted_by`. A poster can't cancel
  it directly; use the admin RPCs. 4 legacy unverifiable ratings still count in
  aggregates.
