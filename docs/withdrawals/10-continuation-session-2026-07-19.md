# Continuation Session — 2026-07-19

> Follow-on to `09-security-audit-findings-2026-07-19.md`. Covers: finishing Profiles RLS hardening, Stripe idempotency, offline-queue dedupe, the skillset data-loss bug, admin suspend/ban, a fresh DB audit, and a dead-code inventory. All application-code changes are committed and pushed to `main`. **Read the "Blocked, needs your authorization" and "Deployment gap" sections below before assuming everything here is live** — several DB and edge-function changes are prepared but not yet applied to production.

## Blocked migrations — need explicit authorization to apply

All of these were denied by the auto-mode safety classifier when attempted (production financial-table/function changes). Each is written, reviewed, and ready — applying them is a one-line `apply_migration` call once authorized.

1. **`supabase/migrations/20260719020000_restore_fn_close_dispute_hold_security_definer.sql`** — restores `SECURITY DEFINER` on `fn_close_dispute_hold(integer, text)`, which is currently `SECURITY INVOKER` in production despite both tracked migrations that define it saying `SECURITY DEFINER` (untracked drift). This one **must be applied before #2** — without it, #2 breaks admin dispute resolution (the function does `balance_on_hold - x` / `balance - x`, which needs SELECT on those columns for whichever role executes it).
2. **`supabase/migrations/20260719020500_revoke_sensitive_profile_columns_select.sql`** — the actual Profiles RLS step 5: revokes table-wide SELECT on `profiles` from `authenticated`/`anon`, re-grants column-level SELECT on every column except `balance`, `balance_on_hold`, `balance_frozen`, `stripe_connect_account_id`, `stripe_customer_id`, `stripe_connect_requirements`, `risk_level`, `risk_score`, `email`, `phone`. All legitimate self-read/write paths are already migrated to `get_my_profile()` and verified (see below) — this is the last step.
3. **`supabase/migrations/20260719050000_tighten_execute_grants_unauth_callable_functions.sql`** — revokes `EXECUTE` from `anon`/`PUBLIC` on three functions with no internal auth check: `unfreeze_profile_if_no_open_disputes` (highest severity — anon could currently clear any user's dispute-freeze flag directly), `send_system_notification` (anon could inject fake notifications for any user), `has_stripe_connect` (dead code, also leaks Stripe Connect status to anon).

## Deployment gap — P2's Stripe idempotency fix is not live

**This is the most important thing in this doc.** Verified via `get_edge_function` (reads the actual deployed source, not just `list_edge_functions`' metadata): production's `payments` and `apple-pay` edge functions are running an **old version that predates this session's idempotency fix — and, for `payments`, predates even the ACH/Financial-Connections work from a prior session**. The code in git is correct and tested; it simply hasn't been deployed.

This contradicts the working assumption from earlier sessions that "pushing to `main` triggers Supabase's GitHub integration to redeploy all edge functions." That may be true for some functions (`connect`, `webhooks`, `wallet`, `admin-withdrawals`, `admin-profiles`, `stripe-mode-check` all show recent `updated_at` timestamps matching this project's recent work) but is evidently **not** true for `payments` or `apple-pay` — their `updated_at` timestamps are old and shared with several other long-untouched functions, and their deployed source confirms it.

Manually deploying them via `deploy_edge_function` was attempted this session and **blocked by the same classifier** (Stripe payment code changes to production). This needs one of:
- Explicit authorization to deploy `payments` and `apple-pay` via the Supabase MCP tool, or
- A manual deploy from the Supabase dashboard / CLI, or
- Investigating why the GitHub integration isn't picking up these two functions specifically (worth its own look — every other function's redeploy history suggests the integration works, just not for these two).

**Practical implication:** don't assume any `supabase/functions/**` change is live just because it's on `main`. Verify with `get_edge_function` (full source) before relying on a fix in production, not `list_edge_functions` (metadata only) and not the git history.

## Verified-dead frontend code — deletion blocked by classifier

Ran a reference-count scan across `components/` (194 files), refined it after an initial pass produced false positives (barrel-export blind spot, ruled out — no `components/ui/index.ts` exists), then individually re-verified ~25 of the resulting 57 candidates with the Grep tool directly (not the bulk script) and found zero false positives. Also confirmed there is no dynamic (`import(\`...\`)` / `` require(`...`) ``) component-loading pattern anywhere in the codebase that could hide a live reference from static search.

Two are worth calling out specifically because they're **superseded duplicates**, not just orphans — a live file with a near-identical name exists and is the one actually used:
- `components/transaction-history.tsx` (dead) vs. `components/transaction-history-screen.tsx` (live, imported from `app/tabs/wallet-screen.tsx`)
- `components/dispute-modal.tsx` (dead) vs. `components/workflow-dispute-modal.tsx` (live, imported from 3 places)

`git rm` (both single-file and batched) was blocked by the classifier as a destructive action. The full 57-file list is ready to delete on your go-ahead — either authorize the deletion, or run it yourself:

```
components/add-deadline-screen.tsx
components/attachment-viewer-test-screen.tsx
components/bounty-request-item.tsx
components/bounty-request-notification.tsx
components/category-filter.tsx
components/connect-onboarding-wrapper.tsx
components/dashboard-page.tsx
components/database-initializer.tsx
components/dispute-modal.tsx
components/edit-profile-screen.tsx
components/escrow-status-card.tsx
components/in-progress-bounty-item.tsx
components/payment-receipt.tsx
components/rating-prompt-modal.tsx
components/search-screen.tsx
components/social-auth-controls/AppleSignInButton.tsx
components/social-auth-controls/sign-out-button.tsx
components/sql-initializer.tsx
components/SystemMessage.tsx
components/task-card.tsx
components/transaction-confirmation.tsx
components/transaction-history.tsx
components/ui/accessible-text.tsx
components/ui/accordion.tsx
components/ui/alert-dialog.tsx
components/ui/aspect-ratio.tsx
components/ui/badge.tsx
components/ui/binary-toggle.tsx
components/ui/breadcrumb.tsx
components/ui/calendar.tsx
components/ui/chart.tsx
components/ui/collapsible.tsx
components/ui/command.tsx
components/ui/context-menu.tsx
components/ui/dialog.tsx
components/ui/drawer.tsx
components/ui/dropdown-menu.tsx
components/ui/form.tsx
components/ui/hover-card.tsx
components/ui/input-otp.tsx
components/ui/loading-overlay.tsx
components/ui/menubar.tsx
components/ui/navigation-menu.tsx
components/ui/pagination.tsx
components/ui/popover.tsx
components/ui/progress.tsx
components/ui/radio-group.tsx
components/ui/resizable.tsx
components/ui/retry-button.tsx
components/ui/scroll-area.tsx
components/ui/select.tsx
components/ui/skeleton-wrapper.tsx
components/ui/slider.tsx
components/ui/switch.tsx
components/ui/table.tsx
components/ui/tabs.tsx
components/ui/toaster.tsx
components/ui/toggle-group.tsx
```

Not attempted: a fully exhaustive individual check of all 57 (only ~25 were individually re-verified via Grep beyond the bulk scan). Re-verify before deleting if picking this up cold.

## Profiles RLS — self-read migration, verified

`auth-profile-service.ts`'s `fetchAndSyncProfile`, `fetchFreshProfileInBackground`, `createMinimalProfile`, and `updateProfile` all now go through `get_my_profile()` (self-scoped RPC) or a minimal `select('id')` instead of `select('*')` / `UPDATE...RETURNING` on sensitive columns. `__tests__/integration/edit-profile-flow.test.ts` (22 tests) and `profile-loading.test.ts` (6 tests) rewritten to mock `supabase.rpc('get_my_profile')` instead of the old `.select().eq().single()` chain — all green, including the "onboarding loop" regression test. This is what unblocks migration #2 above.
