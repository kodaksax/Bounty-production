# RLS Audit — wallet_transactions and Related Tables

**Date:** 2026-04-13  
**Author:** Copilot security audit  
**Migration applied:** `supabase/migrations/20260413_enforce_wallet_rls.sql`

---

## 1. How to reproduce the policy query

Run the following against the production Supabase project (SQL Editor or `psql`):

```sql
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename IN (
  'wallet_transactions',
  'bounty_disputes',
  'dispute_evidence',
  'stripe_events'
)
ORDER BY tablename, cmd;
```

---

## 2. Pre-audit state (findings)

| Table | RLS Enabled | Policies present before this migration |
|---|---|---|
| `wallet_transactions` | ✅ (baseline schema) | **None** |
| `bounty_disputes` | ✅ | SELECT (own + respondent + admin), INSERT (participants + workflow), UPDATE (admin only) |
| `dispute_evidence` | ✅ | SELECT (own disputes), INSERT (own disputes) |
| `stripe_events` | ✅ | **None** |

### wallet_transactions — gap analysis

RLS was **enabled** but **no policies existed**.  Under PostgreSQL, enabling RLS without any permissive policy denies all access to non-superuser roles by default (the "default-deny" behaviour).  This meant:

- ✅ Service-role backend (bypasses RLS) — full access, as intended.
- ✅ Anon users — no access.
- ⚠️ Authenticated users — technically no access due to default-deny, but the intent was **not documented** and could silently break if a `GRANT` were added.  No SELECT policy meant even legitimate users could not read their own transaction history via the JS client.

### stripe_events — gap analysis

Same situation: RLS enabled, no policies.  This is **correct** (service-role only), but the intent was undocumented.

### bounty_disputes — gap analysis

Existing policies cover SELECT, INSERT, and UPDATE appropriately.  A **DELETE** policy was missing; under default-deny this is safe, but the explicit `USING (false)` deny was added for clarity.

### dispute_evidence — gap analysis

Existing policies cover SELECT and INSERT.  **UPDATE** and **DELETE** policies were missing; same reasoning as above — added explicit deny.

---

## 3. Policies applied by migration `20260413_enforce_wallet_rls.sql`

### 3.1 wallet_transactions

| Policy name | Command | Rule |
|---|---|---|
| `wallet_transactions_select_own` | SELECT | `user_id = auth.uid()` |
| `wallet_transactions_insert_deny` | INSERT | `WITH CHECK (false)` |
| `wallet_transactions_update_deny` | UPDATE | `USING (false)` |
| `wallet_transactions_delete_deny` | DELETE | `USING (false)` |

**Effect:** Authenticated users can only read their own rows.  All writes from the client are rejected with error code `42501`.  The service role (backend APIs, Edge Functions, RPCs with `SECURITY DEFINER`) continues to operate normally.

### 3.2 bounty_disputes

| Policy name | Command | Rule |
|---|---|---|
| `bounty_disputes_delete_deny` | DELETE | `USING (false)` |

All other existing policies remain untouched.

### 3.3 dispute_evidence

| Policy name | Command | Rule |
|---|---|---|
| `dispute_evidence_update_deny` | UPDATE | `USING (false)` |
| `dispute_evidence_delete_deny` | DELETE | `USING (false)` |

Evidence is immutable once submitted.  Only the service role may modify evidence records (e.g., for admin correction).

### 3.4 stripe_events

| Policy name | Command | Rule |
|---|---|---|
| `stripe_events_deny_all_clients` | ALL | `USING (false) WITH CHECK (false)` |

No authenticated user should read or write Stripe event records.  The webhooks Edge Function uses the service role and bypasses RLS.

---

## 4. Write paths that remain valid

All legitimate writes to `wallet_transactions` go through one of these service-role or `SECURITY DEFINER` paths:

| Operation | Code path |
|---|---|
| Deposit (Stripe webhook) | `supabase/functions/webhooks/index.ts` → service role |
| Deposit (apply_deposit RPC) | `supabase/migrations/20260310_apply_deposit.sql` — `SECURITY DEFINER` |
| Escrow on bounty accept | `fn_accept_bounty_request` RPC — `SECURITY DEFINER` |
| Withdrawal | `services/api/src/services/consolidated-wallet-service.ts` — service role |
| Platform fee ledger | `server/index.js` / Fastify API — service role |

None of these paths are affected by the new client-side deny policies.

---

## 5. Integration test

See `__tests__/integration/rls-wallet-transactions.test.ts`.

The test runs in two modes:

- **MOCK mode** (default in CI): Uses a Jest mock that simulates RLS behaviour — cross-user queries return empty arrays and direct INSERT returns a `42501` error.
- **LIVE mode** (manual / security CI): Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `RLS_TEST_USER_A_EMAIL`, `RLS_TEST_USER_A_PASSWORD`, `RLS_TEST_USER_B_EMAIL`, `RLS_TEST_USER_B_PASSWORD` in the environment to run against a real project.

### Assertions covered

1. User A can read their own `wallet_transactions`.
2. User A querying `wallet_transactions` filtered to User B's `user_id` returns an empty result (RLS filters rows silently).
3. An authenticated client attempting a direct `INSERT` into `wallet_transactions` receives error code `42501`.
4. An unauthenticated (anon) client receives zero rows from `wallet_transactions`.
5. An authenticated client receives zero rows from `stripe_events`.

---

## 6. Recommendations for future audits

1. Run the policy query above after every migration that creates a new table.
2. Add a check in CI that asserts `ALTER TABLE … ENABLE ROW LEVEL SECURITY` is present for every new table added to the public schema.
3. Consider a periodic automated audit script (`scripts/check-rls.sql`) that fails if any public table has RLS disabled or has no policies.
