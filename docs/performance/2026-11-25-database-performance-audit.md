# Database & backend performance audit — 2026-11-25

Production project `xwlwqzzphmmhghiqvkeu` (matches `lib/config/supabase-refs.json` → `production`).
Postgres 17.6, small compute (`max_connections` 60, `shared_buffers` 256 MB, 6 worker processes).
All numbers below were read from production on 2026-11-25 between 07:53 and 08:20 UTC. Every
experiment that could write ran inside a transaction that was rolled back.

## 1. Baseline: the report is cumulative, the load is not

`pg_stat_statements` was last reset **2025-09-26**, so the query-performance report is 14 months
of totals. To see what costs time *now*, call counters were snapshotted at 07:55:06 and diffed at
08:03:38 (8.5 min, off-peak ≈ 03:00 ET).

| Report rank | Statement | Lifetime share | Calls in 8.5 min | Status |
|---|---|---|---|---|
| 1, 7, 9, 11, 13 | `realtime.list_changes` (Realtime postgres_changes poller) | ~35 % | 0 | Traffic-driven: polls only while someone is subscribed (0 subscriptions at sample time) |
| 2, 3, 5 | Per-conversation last message / unread count (`messages` by `conversation_id`) | ~27 % | 0 | **Historical.** The inbox N+1 was replaced by `get_conversation_summaries()` (migration `20260916120000`); the per-conversation path is a fallback only |
| 4 | `fn_check_job_health()` | 8.7 % | 1 (445 ms) | Active, every 5 min |
| 6, 22 | `stripe._sync_obj_runs` cursor / stale-run update | 7.8 % | 0 | Dormant: Stripe Sync Engine no longer running; table is 59 MB / 270k rows |
| 8, 40 | `net._http_response` / `net.http_request_queue` cleanup (pg_net) | 6 % | 4 (1 ms) | Healthy now |
| 10, 14 | `drain_notifications_outbox()`, `drain_analytics_person_outbox()` | 2 % | 8 each | Active, every minute |
| 17 | service-role `UPDATE profiles SET balance` (147 ms mean) | 0.5 % | 0 | Historical (`services/api` wallet path) |
| 19 | `fn_escalate_stale_bounty_liquidity()` | 0.5 % | 1 (707 ms) | Active, every 20 min |
| 15, 16, 25 | `pg_timezone_names`, schema-introspection CTEs | ~2 % | 0 | PostgREST schema-cache reloads (one per DDL / `NOTIFY pgrst`); expected |

**Conclusion:** at steady state the database is dominated by **pg_cron**, not by user queries. The
tables are small (`messages` 1.1k rows, `profiles` 1.1k, `notifications` 4.6k). The two
structural costs that grow with users are Realtime fan-out and write amplification on hot tables.

## 2. Findings

### F1 — CRITICAL (financial integrity): Stripe payout reconciliation down since 2026-11-09

* `reconciliation_reports` has no row after **2026-11-09 22:45:40 UTC**.
* Every `stripe-payout-reconciliation-15min` run since then got
  `401 {"code":"UNAUTHORIZED_INVALID_JWT_FORMAT"}` from the **gateway** (4×/hour in `net._http_response`),
  as did the daily `reconciliation-invariant-sweep-daily` (same function).
* Cause: `reconciliation` had no `[functions.reconciliation]` block in `supabase/config.toml`, so
  the CI deploy at **22:49:39 UTC** (`deploy-edge-functions.yml`, deployed version timestamp
  `1794264579625`) set `verify_jwt = true`. pg_cron sends `reconciliation_cron_secret`, which is not
  a JWT. The function's own auth (cron secret or admin JWT) never ran.
* Both critical ops alerts open since then (`stripe-payout-reconciliation-15min`,
  `edge-auth-or-5xx`) are this one fault. Neither was acknowledged.
* **Same latent fault in three more functions**, still live only because they were last deployed by
  hand with `--no-verify-jwt`: `admin-withdrawals` (hourly Stripe *balance* reconciliation),
  `expire-bounty-requests` (cron), `identity-webhooks` (Stripe Identity webhooks). Their next CI
  deploy would have broken them the same way.
* Exposure in the gap: wallet ledger rows created since 2026-11-09 22:45 are 4 deposits, 6 escrows,
  6 releases, 2 admin adjustments and **2 failed withdrawals totalling $1,000.00**. There were no
  completed or pending withdrawals. The ledger↔Stripe payout match uses a 72-hour window
  (`RECONCILE_WINDOW_HOURS`), so the restored job will **not** re-examine the first ~13 days of the
  gap. The invariant sweep (unbounded) and the stuck-pending-withdrawal check (unbounded) will.

**Fixed (this change):** explicit `verify_jwt = false` for the four functions, each of which
authenticates inside the function (cron shared secret / admin JWT / Stripe signature), plus explicit
`verify_jwt = true` for the six that relied on the default, and a unit test
(`__tests__/unit/edge-function-verify-jwt-config.test.ts`) that fails if any function lacks a
declaration. The test fails against the old config (14 failures) and passes against the new one.

### F2 — pg_cron contention at the quarter-hour

About 9 jobs start together at :00/:15/:30/:45. Over 3 days, p50 duration per slot:

| Job | Other minutes | Quarter-hour |
|---|---|---|
| drain-notifications-outbox | 30 ms | 89 ms |
| drain-analytics-person-outbox | 17 ms | 66 ms |
| moderation-sweep-10min | 33 ms | 82 ms |
| check-push-receipts | 52 ms | 106 ms |
| job-health-check-5min | 235 ms | 354 ms |

Run alone the functions are cheap: `fn_remind_posters_of_pending_requests` takes 2–11 ms against a
246 ms cron average, and `drain_notifications_outbox` 3 ms against 43 ms. This is contention, not
query cost.

**Fixed (this change):** `20261125120100_stagger_cron_schedules.sql` moves 9 jobs off the shared
minutes using `cron.alter_job`, so commands and heartbeats are untouched. Each job keeps its
interval, so `job_health_expectations.max_silence` budgets still hold. None of the functions
depend on the wall-clock minute. Validated against production in a rolled-back transaction.

### F3 — 13 exact-duplicate indexes

These are byte-identical pairs: same columns, predicate and method, not unique, and not backing a
constraint. They sit on `profiles` (2), `notifications` (2), `wallet_transactions` (3), `bounties`,
`marketing_clicks`, `platform_reserves`, `risk_actions`, `risk_communications` and
`remediation_workflows`. Every write maintains both copies and logs WAL twice, and Realtime decodes
that WAL for `profiles`, `notifications` and `bounties`.

**Fixed (this change):** `20261125120000_drop_duplicate_indexes.sql` keeps the copy defined by an
earlier migration and drops a duplicate only when its keeper exists and is still identical in that
environment, so no environment can end up with neither. Dry-run against production: all 13 drop
as intended (rolled back).

### F4 — Realtime fan-out (recommendation, not changed)

* `subscribeToConversations` (`lib/services/supabase-messaging.ts`) listens to **unfiltered**
  `conversations` changes. Every message bumps `conversations.updated_at`
  (`update_conversation_on_message`), so each message costs one RLS evaluation per connected inbox,
  across every user, not only the participants. A per-user Broadcast topic would make this O(participants).
* `components/bounty-feed.tsx` listens to unfiltered `UPDATE`/`DELETE` on `bounties` for the same reason.
* `useBountyThread` subscribes to `bounty_cancellations` and `bounty_payments`, and a listener
  exists for `insufficient_funds_for_escrow`. **None of these is in the `supabase_realtime`
  publication, so those listeners never fire.** This is a functional gap; adding the tables to the
  publication would increase Realtime cost, so decide per table.
* `messages_broadcast_trigger` / `messages_broadcast_changes()` exist only in production (no
  migration). They write a `realtime.messages` row on topic `conversation:<id>` for every message
  change, but no client subscribes to that topic. Either finish that Broadcast migration (and drop
  the `postgres_changes` message listeners) or drop the trigger. Left in place because it looks
  like in-progress dashboard work.

### F5 — RLS policy hygiene (recommendation, not changed)

The advisor reports 149 `multiple_permissive_policies` and 128 `auth_rls_initplan` warnings. The
performance impact at the current table sizes is small (point lookups). One item is a **security
observation**:

* `profiles` UPDATE has three permissive policies. `profiles_update_own` checks
  `is_account_active(auth.uid())`, but permissive policies are OR'd and `Users can update own
  profile` / `allow_profiles_update_self` do not check it. As a result, **RLS does not stop a
  suspended account from updating its own profile row**. Column-level triggers such as
  `trg_prevent_client_writes_to_protected_profile_columns` still apply. `profiles` also has 3 identical SELECT and 4 identical INSERT
  policies. Consolidating them is a security-sensitive change; it needs an owner and its own review.

### F6 — Smaller items

* **Stripe Sync Engine** (`stripe` schema) is dormant. `_sync_obj_runs` holds 59 MB / 270k rows
  with 52k dead tuples and was last autovacuumed in Feb 2026. If the integration is retired,
  uninstall it. If it is meant to run, it is not running.
* **Auth connection pool** is fixed at 10 connections (`auth_db_connections_absolute`). Switch it
  to percentage-based before upgrading compute, or the upgrade will not help Auth.
* `public.backup_bounty_requests_duplicates` has no primary key. It looks like a one-off backup and
  can probably be dropped.
* `fn_check_job_health` runs `edge-auth-or-5xx.detail_sql` on every unhealthy pass (57 ms, joins
  `cron.job_run_details` by time range with no index). Fixing F1 clears that alert, which stops this cost.

## 3. Deploying

1. **Merge, then redeploy `reconciliation`.** A change to `config.toml` alone does not trigger
   `deploy-edge-functions.yml` (it is path-filtered to `supabase/functions/**`). Run it with
   *workflow_dispatch* → `functions: reconciliation`. `admin-withdrawals`, `expire-bounty-requests`
   and `identity-webhooks` are already live with `verify_jwt = false`; nothing to do for them.
2. **Apply the two migrations to production** (the usual manual step):
   `20261125120000_drop_duplicate_indexes.sql`, `20261125120100_stagger_cron_schedules.sql`.
   Rollbacks: `supabase/rollbacks/production/20261125120000_*.down.sql` and `…120100_*.down.sql`.
3. **Run one reconciliation by hand** to confirm, then **check the 2 failed withdrawals
   (2026-11-09 → 2026-11-22) in Stripe**: confirm no payout left and the balance was restored. They
   are outside the 72-hour window the job re-examines.
4. Acknowledge or resolve the two open critical ops alerts once green.
5. Optional: `select pg_stat_statements_reset();` after deploy, so the next report reflects current
   behaviour instead of 14-month totals.

## 4. Verifying

```sql
-- F1: reconciliation is running again (expect a row within 15 min of the redeploy)
select max(run_at) from public.reconciliation_reports where error is null;
select status_code, count(*) from net._http_response
 where created > now() - interval '1 hour' group by 1;          -- no 401s

-- F2: quarter-hour penalty gone (compare with the table in F2; run after 3 days)
select j.jobname,
       case when extract(minute from d.start_time)::int % 15 = 0 then 'quarter' else 'other' end slot,
       round(percentile_cont(0.5) within group (order by extract(epoch from d.end_time - d.start_time))::numeric * 1000) p50_ms
  from cron.job_run_details d join cron.job j using (jobid)
 where d.start_time > now() - interval '3 days'
   and j.jobname in ('drain-notifications-outbox','drain-analytics-person-outbox','job-health-check-5min')
 group by 1, 2 order by 1, 2;

-- F3: no duplicate indexes left (expect 0 rows from the advisor's duplicate_index lint)
```
