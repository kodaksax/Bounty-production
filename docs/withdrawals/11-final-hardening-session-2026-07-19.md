# Final Hardening Session — 2026-07-19

> Follow-on to `10-continuation-session-2026-07-19.md`. This session's mandate was to independently re-verify every claim in that document (not trust it), investigate the edge-function deployment gap's root cause, and safely finish what could be finished. **One new, higher-severity finding was discovered mid-session** (see §1 below) — per the working principles, this is documented first and prominently.

## 0. Headline: nothing in this doc has been applied to production without your say-so

Every DB-level item below is either (a) already verified live, or (b) a migration file committed to the repo but **blocked by the auto-mode safety classifier when applying to production** — same as the previous session. Four migrations are now staged and ready, in the order they must be applied. No production data, balances, payouts, or Stripe behavior were touched.

---

## 1. NEW CRITICAL FINDING — anon (unauthenticated) can currently read every column of every row in `profiles`

This is more severe than the already-known, already-documented gap ("any *authenticated* user can read all columns of `profiles`" — the subject of migration #2 below). This one requires **no login at all**.

**What's live in production right now:**

Two RLS policies on `public.profiles` were found that were never created by any tracked migration (untracked drift):

- `"Enable read access for all users"` — `FOR SELECT USING (true)`, no role restriction
- `"Public profiles are viewable by everyone"` — `FOR SELECT USING (true)`, no role restriction

Both apply to `PUBLIC` (every role, including `anon`). Independently confirmed via `pg_policy` that `anon` also holds a table-level `SELECT` grant on `profiles` (`information_schema.role_table_grants`). Since Postgres OR's all applicable permissive RLS policies together, this combination means **an unauthenticated caller with just the public anon key can run `select * from profiles` and read every user's `balance`, `balance_on_hold`, `email`, `phone`, `stripe_customer_id`, `stripe_connect_account_id`, `risk_score`, and `risk_level`, for every row in the table.**

Likely origin: `"Enable read access for all users"` is the literal canned policy name/text Supabase Studio's table-creation wizard offers — this looks like a leftover default policy from early prototyping that was never cleaned up, sitting alongside (and silently overriding the intent of) every subsequent, properly-scoped RLS migration.

**Why the pending column-REVOKE migration (§2.B) doesn't fully fix this on its own:** that migration revokes table-wide `SELECT` from `authenticated`/`anon` and re-grants only safe columns at the column level — column-level grants apply on top of whatever RLS allows through. If these two `true`-for-everyone policies remain, re-granting even the "safe" column list to `anon` at the column level would still let anon read balance-adjacent metadata... actually the column list already excludes `balance`/`stripe_*`/`risk_*`/`email`/`phone`, so the *column*-level fix in §2.B would still meaningfully narrow exposure — but the row-level hole (any anon call succeeding at all against the raw table) should be closed independently and first, since it's the more direct fix and has zero dependency on the other three migrations.

**The intended design already has two proper mechanisms that remain fully intact if these two policies are dropped:**
1. `profiles_select_authenticated` (tracked, `20260303_add_profiles_rls_policies.sql`) — `authenticated`-only, to be column-narrowed by §2.B.
2. `public.public_profiles` view (tracked, `20260718235500_formalize_public_profiles_view.sql`) — a curated safe-columns view already `GRANT`ed to `anon` + `authenticated`, which is the documented intended path for any cross-user/pre-login profile display.

No anon-facing feature in the app queries `public.profiles` directly (the app requires authentication before any profile-adjacent screen), so dropping these two policies should have zero application-visible effect.

**Fix prepared:** `supabase/migrations/20260719060000_drop_untracked_permissive_anon_profiles_policies.sql` — drops both policies. Rollback (re-exposes the same data — only use if something breaks):
```sql
CREATE POLICY "Enable read access for all users" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
```

**Status: written, committed, blocked by the classifier on `apply_migration` — needs your explicit authorization.** Given the severity (live, zero-auth PII/financial-identifier exposure), this should be treated as the single highest-priority item in this entire document.

**Related, lower-severity, NOT acted on:** the same "`true`-for-everyone-including-anon" pattern also exists on `public.users` (a 2-row, code-dead legacy table — no `.from('users')` call exists anywhere in the app) via a policy named `users_select_all`, and on `ratings`/`user_ratings`/`skills`/`restricted_business_categories` (all four appear to be intentionally-public lookup/review data, not a concern). `users` is worth cleaning up for hygiene but is not urgent given zero rows of consequence and zero app usage — flagged here, not bundled into the critical fix, to keep that migration minimal and reviewable.

---

## 2. Re-verified: the 3 previously-blocked migrations (still blocked, still needed)

Independently re-queried live production state for every claim — none of these were assumed from the prior doc.

**A. `20260719020000_restore_fn_close_dispute_hold_security_definer.sql`**
Confirmed via `pg_proc.prosecdef`: `fn_close_dispute_hold(integer, text)` is still `SECURITY INVOKER` in production (`prosecdef: false`, `proconfig: null` — no search_path pinned either). Read the live function body directly: it does contain its own `auth.role() = 'authenticated'` + admin-JWT-claim authorization guard (so it isn't wide open), but its `UPDATE public.profiles SET balance_on_hold = ...` / `SET balance = ...` statements run as `SECURITY INVOKER`, meaning they execute with the *calling* role's own column privileges. Once migration §2.B (below) revokes `authenticated`'s direct `SELECT`/access to `balance`/`balance_on_hold`, this function would start failing for admin callers unless it's `SECURITY DEFINER` again. **Must be applied before §2.B**, confirmed still true.

**B. `20260719020500_revoke_sensitive_profile_columns_select.sql`**
Confirmed via `information_schema.role_table_grants`: `authenticated` and `anon` both still hold table-wide `SELECT` on `profiles`. Not yet applied. All the app-side prerequisite work this migration depends on (self-read/write via `get_my_profile()` RPC) was independently re-verified as live and correct — see §4.

**C. `20260719050000_tighten_execute_grants_unauth_callable_functions.sql`**
Independently re-queried `information_schema.role_routine_grants` and read the live function body for the highest-severity item:

- `unfreeze_profile_if_no_open_disputes(uuid)` — confirmed `SECURITY DEFINER`, `search_path=public` (already pinned), and **confirmed via direct read of its body that it performs zero identity/authorization check on its `p_user_id` argument** — it just does `SELECT balance_frozen FROM profiles WHERE id = p_user_id FOR UPDATE`, checks for open `stripe_dispute` rows, and if none exist, sets `balance_frozen = false` for that arbitrary user ID. Grants confirm `PUBLIC`, `anon`, and `authenticated` all currently hold `EXECUTE`. **This means literally anyone, unauthenticated, can call this RPC with any user's UUID and unfreeze their balance**, provided that user has no open Stripe dispute at the time. Confirmed still exploitable, unchanged from the prior finding.
- `has_stripe_connect` and `send_system_notification` — grants to `anon`/`PUBLIC` also confirmed still present.

**Rollback SQL for all three (if any breaks something after applying):**
```sql
-- A: revert to current live (SECURITY INVOKER) state
-- (see the exact current definition captured in this session's SQL logs;
--  simplest safe rollback is CREATE OR REPLACE removing `SECURITY DEFINER` and
--  the `SET search_path` clause, restoring plain SECURITY INVOKER.)

-- B:
GRANT SELECT ON public.profiles TO authenticated, anon;

-- C:
GRANT EXECUTE ON FUNCTION public.unfreeze_profile_if_no_open_disputes(uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_system_notification(uuid, text, text, text, jsonb) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_stripe_connect(uuid) TO PUBLIC, anon, authenticated;
```

**Application order once authorized: §1 (any order relative to the rest) → A → B → C.** A must precede B; §1 and C are independent of the others and of each other.

---

## 3. Edge-function deployment gap — root cause found

Independently confirmed via `get_edge_function` (full deployed source) that **`payments` (v31) and `apple-pay` (v20) are still stale in production** — the deployed `payments` source has no ACH/idempotency-key handling at all (no `idempotencyKey` destructuring, no ACH route), and deployed `apple-pay` has no `idempotencyKey` parameter either. Both match the previous session's finding exactly; nothing changed since.

**Root cause: there has never been an automated deployment pipeline for edge functions in this repo.**

- `.github/workflows/ci.yml` has a Supabase-related job ("Check Supabase Edge Functions (Deno)"), but it only runs `deno check` / `deno lint` — validation only, no `supabase functions deploy` step anywhere. It also only covers a hardcoded subset: `connect`, `webhooks`, `wallet`, `admin-withdrawals`. `payments` and `apple-pay` aren't even in that lint list.
- No other workflow file (`deploy-pages.yml`, `eas-deploy.yml`, `fastlane-eas.yml`, etc.) touches Supabase functions.
- `package.json` has `deploy:functions:dev` / `deploy:functions:staging` npm scripts, but both target **different project refs** (`ajsbkocnixpwbrjokvnq`, `gwumwpoomwvkjyibdmpj`) than this production project (`xwlwqzzphmmhghiqvkeu`) — and **there is no `deploy:functions:production` script at all.**

Conclusion: production edge-function deployment has always been a fully manual, ad hoc process — a human or agent explicitly deploying specific functions by slug (via dashboard or CLI), never a blanket "redeploy everything on push." The functions with recent, correct deployed source (`connect`, `webhooks`, `wallet`, `admin-withdrawals`, `admin-profiles`, `stripe-mode-check`) are recent precisely because a prior session's explicit `deploy_edge_function` calls targeted them by name. `payments` and `apple-pay` were coded and committed but never included in any such explicit deploy call — there was no pipeline to catch the omission.

**This is not a pipeline bug to fix — there's no pipeline to fix.** The immediate remediation is simply to deploy the two functions explicitly (source is already correct and tested in git). The longer-term fix, if wanted, would be adding an actual CI deploy step scoped to the real production project ref — out of scope for this session unless requested.

**Action needed:** authorize an explicit `deploy_edge_function` call for `payments` and `apple-pay` against project `xwlwqzzphmmhghiqvkeu` (blocked by the classifier when attempted this session, consistent with all Stripe-payment-code production changes). Rollback: redeploying the previous version is possible via the Supabase dashboard's function version history (both functions' deploy history shows v31/v20 as current — a rollback would target v30/v19 respectively), or by re-running `deploy_edge_function` with the current (pre-fix) git blob if the fix needs to be reverted.

---

## 4. Verified-complete items (independently re-checked, not just re-read from the prior doc)

- **`get_my_profile()` RPC**: live, `SECURITY DEFINER`, `search_path=public` pinned. `auth-profile-service.ts`'s four self-read/write paths confirmed still routed through it in the current repo state.
- **Profiles RLS self-read migration**: `edit-profile-flow.test.ts` (22 tests) + `profile-loading.test.ts` (6 tests) re-run this session — all pass.
- **Stripe idempotency code**: confirmed present in `stripe-service.ts`, `payment-methods-service.ts`, `payment-error-handler.ts`, and both edge function source files in git — but confirmed (again, see §3) **not live** in the two edge functions that matter.
- **Offline-queue dedupe**: `bounty-service.ts`'s pre-insert dedupe check confirmed present in current repo state; `__tests__/unit/services/bounty-service.test.ts` + `lib/services/__tests__/bounty-service.test.ts` (23 tests total) re-run — all pass.
- **Skillset persistence fix**: `skillset-edit-screen.tsx` confirmed still wired to `useAuthProfile()`'s `updateProfile`, not `useUserProfile()`'s.
- **Admin suspend/ban plumbing**: `profiles.account_status` column confirmed live (`information_schema.columns`), `admin-profiles` function's `updateStatus` action confirmed present in current deployed source (v2, `updated_at` recent). **Gap noted:** no automated test coverage exists for this feature (`__tests__/**` has zero references to `admin-profiles`, `updateUserStatus`, or `account_status`) — functional but untested.
- **`search_path` pinning (5 functions)**: re-queried `pg_proc.proconfig` directly — all 5 (`handle_bounty_request_notification`, `handle_new_message_notification`, `handle_user_deletion_cleanup`, `is_conversation_creator`, `validate_new_user_email`) confirmed still pinned to `search_path=public`.
- **57-file dead-code list**: independently re-verified in full this session (all 57, not a ~25-file sample) using the Grep tool with a per-file "final path segment of any quoted import" pattern, cross-checked against a known-live control file (`components/ui/button.tsx`, which correctly returned 5 references) to validate the methodology isn't producing false negatives. Zero barrel/index re-export files exist under `components/`, `components/ui/`, or `components/social-auth-controls/`. No dynamic `import()`/`require()` pattern anywhere in the repo resolves to a `components/*` path. **All 57 confirmed genuinely dead, zero found to be false positives.** `git rm` itself still blocked by the classifier as a destructive action — awaiting authorization.

---

## 5. Validation results (this session)

- `tsc --noEmit`: clean, zero errors.
- `npm run lint` (ESLint, `app/**` + `lib/**`): **0 errors, 204 warnings** — all pre-existing (unused-var/require-import/eqeqeq/exhaustive-deps style warnings across ~35 files, none touched this session).
- Targeted test suites re-run: `edit-profile-flow.test.ts` (22), `profile-loading.test.ts` (6), `stripe-service-facade.test.ts` (35), `bounty-service.test.ts` ×2 files (23) — **63 + 23 = 86 tests, 100% pass.**
- `list_migrations` (live): confirmed the 3 original blocked migrations plus the new §1 migration are **not** present in the applied-migrations list — matches expectation, none were applied.
- No app code was modified this session — only new migration files (all pending authorization) and this documentation were added.

---

## 6. Production deployment checklist (once authorized)

In order:
1. Apply `20260719060000_drop_untracked_permissive_anon_profiles_policies.sql` (§1 — highest priority, closes live zero-auth exposure)
2. Apply `20260719020000_restore_fn_close_dispute_hold_security_definer.sql` (§2.A)
3. Apply `20260719020500_revoke_sensitive_profile_columns_select.sql` (§2.B)
4. Apply `20260719050000_tighten_execute_grants_unauth_callable_functions.sql` (§2.C)
5. Deploy `payments` and `apple-pay` edge functions from current git source (§3)
6. `git rm` the 57 confirmed-dead files (§4) — purely a repo cleanliness item, zero production risk, can happen independently of 1–5
7. After 1–4: spot-check a real profile edit, onboarding flow, and an admin dispute-resolution action in whatever environment you validate in, to confirm no regression before/shortly after

## 6a. Phase 2 execution results — all 4 migrations APPLIED to production

Executed on explicit executive approval, one at a time, each independently verified before proceeding to the next. No verification failures occurred.

1. **`20260719060000_drop_untracked_permissive_anon_profiles_policies`** — Applied. Verified via `pg_policy`: both dangerous policies gone; every remaining policy is either `TO authenticated` or gated by `auth.uid() = id` (evaluates false for anon). Anon can no longer read any row of `profiles`.
2. **`20260719020000_restore_fn_close_dispute_hold_security_definer`** — Applied. Verified via `pg_proc`: `prosecdef=true`, `proconfig=[search_path=public]`, owner `postgres`, EXECUTE limited to `authenticated`/`service_role`.
3. **`20260719020500_revoke_sensitive_profile_columns_select`** — Applied. Verified via `information_schema.role_table_grants` (no table-level SELECT remains for `anon`/`authenticated`) and `information_schema.column_privileges` (authenticated's column-level SELECT list is exactly the 52 intended columns — the 10 excluded columns confirmed absent).
4. **`20260719050000_tighten_execute_grants_unauth_callable_functions`** — Applied. Verified via `information_schema.role_routine_grants`: `unfreeze_profile_if_no_open_disputes` and `has_stripe_connect` now `postgres`/`service_role` only; `send_system_notification` retains `authenticated` (still needed by `dispute-service.ts`/admin verifications) but lost `anon`/`PUBLIC`.

**Verification method note:** all four were verified against the live privilege/policy model directly (exact grant/policy diff before → after), not by exercising the deployed app end-to-end — this environment has no way to authenticate as a real app user against production. A manual smoke test of profile view/edit and an admin dispute resolution is recommended as a follow-up, though the privilege-model verification leaves no ambiguity about what changed.

**Remaining from the original 4-migration set: none — all applied.** Remaining production-impacting work: edge function deployment (§3) and dead-code deletion (§4), both still pending separate authorization.

## 7. Suggested next priorities (beyond this session)

- Add test coverage for the admin suspend/ban `updateStatus` action (currently zero).
- Decide whether to build a real CI deploy step for edge functions against the actual production project ref (`xwlwqzzphmmhghiqvkeu`) — right now there is no automated path at all, meaning this exact gap (code fixed, never deployed) can recur for any function.
- Clean up the `users` legacy table (2 rows, no code references, same permissive-policy pattern as `profiles` but far lower stakes).
- Full 5-hook profile-state consolidation (`useUserProfile`/`useAuthProfile`/etc.) — still open, still out of scope per prior explicit user decision to defer.
