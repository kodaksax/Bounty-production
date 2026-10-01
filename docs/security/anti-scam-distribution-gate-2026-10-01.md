# Anti-scam distribution gate: runbook (2026-10-01)

Implements trust-spine audit T1 (escalation amplifies scams), T2 (scanner misses
the scam families; reports don't act) and T21 (`report_submitted`) from
`docs/trust-spine-audit-2026-09-30.md`.

**Status:** verified on staging inside rolled-back transactions (92/92). **Not
applied to staging or production.** Staging lags production on the escalator's
prerequisites (`20260901140000`, `20260919120000`), so persisting it there would
make the staging escalation cron fail until those are applied.

## What changes

Migration `supabase/migrations/20261001140000_anti_scam_distribution_gate.sql`.

### Distribution (independent of detection)

`fn_bounty_distribution_gate(bounty, path, stage, require_credibility)` is the
one rule for every path that pushes a bounty to hunters.

| Check | Liquidity escalation | Insert-time "near you" (radius / zip / service area) |
|---|---|---|
| Moderation state not flagged / under_review / hidden / removed | required | required |
| No unresolved signals (score ≥ 2, the existing queue threshold) unless human-approved | required | required |
| No pending report on the bounty or on the poster (profile or another listing) | required | required |
| Poster account `active` | required | required |
| ≥ 1 credibility signal: completed transaction, Stripe Identity verified, escrow held on this bounty, human approval | **required** | not required |

New posters keep feed visibility and the local "near you" push. Only the broad
escalation (up to 60 hunters; every profile for online work) needs credibility.
A clean listing that lacks only credibility raises one `escalation_review` alert,
and approving it in moderation unlocks escalation on the next run. Skipped
listings are not stamped, so they are re-evaluated every run.

Every decision is a row in `bounty_distribution_decisions` (path, stage,
decision, reasons, credibility, eval_count).

### Detection

New `moderation_scan_content` families. Existing rules are unchanged.

| Signal | Weight | Fires on (examples) |
|---|---|---|
| `payment_proxy` | 5, auto-flags alone | "pay for a … order", KYC, "verify my account", "use your card/bank/identity", "receive packages for", card testing, reshipping |
| `purchase_on_behalf` | 3 | "complete an online purchase", "help me make a payment", gift cards |
| `off_platform_channel` | 3 | Signal, Kik, WeChat, Snapchat…, "call/email me at", "off the app" |
| `off_platform_payment` | 3 | Cash App, Zelle, Venmo, PayPal, wire transfer, "pay you in cash" |
| `employment_offer` | 3 | hiring, part-time, data entry, personal/virtual assistant, salary, "apply now" |
| `recurring_pay_rate` | 1, corroborating only | "$25/hr", "weekly pay" |
| `details_withheld` | 2 | "explain in the DMs", "see attached image", "PM me" |
| `details_in_attachment` | 1, corroborating only | attachments with < 40 characters of description |

"DM" on its own is not a new signal. On Bounty, "DMs" can mean in-app chat, and
the 09-25 audit found a real "Clean my yard … DM for more details" post.

Other detection changes:
- **Approval sticks.** Before, the sweep re-applied the same signals every 10
  minutes and the system could move `approved → flagged`. Now only a signal type
  that appears after approval re-opens a listing: flagged if the score is at
  least the threshold, otherwise back to `active`.
- **Reports act.** 2+ distinct reporters, or 1 report against a poster whose
  account is under 7 days old, moves the poster's live listing(s) to
  `under_review`. It records a system event and raises a `report_threshold`
  alert. Reports filed before a human approval don't count again. The poster's
  own reports are ignored.
- **Visibility hold.** A RESTRICTIVE SELECT policy (`bounties_select_moderation_hold`)
  hides flagged, under_review, hidden and removed listings from everyone except
  the poster, the accepted hunter, existing applicants and admins. Before this,
  moderation state changed nothing a hunter could see. Moving the listing to
  `archived` was not an option for a reversible review, because
  `fn_reject_pending_requests_on_bounty_close` auto-rejects every pending
  application.
- **Alert delivery.** `moderation-sweep` only delivered alerts created during its
  own run, so insert-time auto-flags, report actions and escalation reviews were
  never pushed to admins. `moderation_alerts.fanned_out_at` is now the delivery
  watermark.
- **`report_submitted`.** `moderation-sweep` forwards uncaptured reports to
  PostHog (distinct_id = reporter, uuid = report id) and marks them captured only
  after PostHog accepts. The server ledger already has
  `bounty_events.moderation.report_filed`; this is its PostHog counterpart, not a
  second concept.

Existing alerts and reports are treated as already delivered/captured
(`ADD COLUMN … DEFAULT now()` followed by `DROP DEFAULT`), so there is no
retroactive burst. No existing row is updated.

### Other files

- `supabase/functions/moderation-sweep/index.ts`, `supabase/functions/_shared/report-submitted-events.ts`
- `lib/types-admin.ts`: admin labels for the new signal types
- `supabase/security/rls-manifest.json`: registers the restrictive policy
- `supabase/rollbacks/production/20261001140000_anti_scam_distribution_gate.down.sql`

## Verification

| Check | Result |
|---|---|
| `node scripts/verify-anti-scam-gate.js` (staging, one rolled-back transaction) | **92/92** |
| `npx jest __tests__/unit/report-submitted-events.test.ts` | 8/8 |
| `deno check` moderation-sweep | pass |
| RLS CI rules (`analyze()`) on a migrated staging snapshot | 0 errors |
| Rollback restores prod's exact function bodies (md5 of `pg_get_functiondef`) | pass |
| migrate → rollback leaves functions, ACLs, policies, triggers, columns and indexes unchanged | identical |

The suite covers: 7 scam shapes detected; 17 legit listings with no blocking
new-rule hit; each gate reason in isolation; the escalator end to end (credible
listing pushed to 40, scam and new-poster listings not pushed, approval → pushed
next run); the zip/radius/service-area pushes; every report rule; the feed hold
as each role; applications are not auto-rejected; approval stickiness; sweep
delivery exactly once; the `report_submitted` feed; and privileges.

### Production replay (read-only, 2026-10-01)

```
node scripts/replay-anti-scam-gate.js --env production --days 90 --json replay-prod.json
```

Each push is evaluated as of the moment it went out. The first run found three
missed phrasings: "I'll provide payment first", "card selective" and "help
purchase a gift". I measured those patterns against all 187 production listings
(internal and external, full history), found 0 hits outside known scams, and
added them. Results after that:

| Question | Result |
|---|---|
| Audit scam escalations distributed under the gate | **0 / 7** |
| …ignoring account status (6 posters were banned *after* their push) | 0 / 7 |
| …blocked by content signals alone (no credibility or ban needed) | **7 / 7** |
| …also hidden from the feed (auto-flagged) | 3 / 7 (`0b9e1e8a`, `c1c869bb`, `4554d92a`) |
| Escalations later removed by moderation that would still have escalated | 0 / 6 |
| Completed external bounties (all 3 ever): new-rule hit / hidden / nearby push blocked | **0 / 0 / 0** |
| Completed external bounties whose escalation would have waited for approval | 3 / 3 (new posters, no credibility yet) |
| Legitimate escalation `11af999b` "Run to the store" | skipped, `no_credibility_signal` (it reached 1 hunter) |
| New-rule hits (weight ≥ 2) on non-scam listings in 90 days (41 listings) | 0 |
| Open listings held from the feed at deploy | 0 / 23 |
| Bounties eligible for escalation right now (first-run alert burst) | 0 |

Caveat: the rules were tuned with the scam texts in view and there is no
holdout set. The false-positive base is small (3 completed external bounties,
41 listings in 90 days, 187 total).

## Production rollout

DB first, then the edge function. The function tolerates a missing DB (it logs
the RPC error and continues), but the RLS manifest entry makes the pre-deploy
RLS gate expect the policy.

1. **Replay**: done 2026-10-01 (above). Both go/no-go numbers are 0. Re-run it
   right before applying if new listings have arrived.
2. **Deploy-time hold list** (replay section 4): empty on 2026-10-01.
3. **Confirm prod is unchanged since 2026-10-01.** The md5s in
   `PROD_FUNCTION_MD5` (`scripts/verify-anti-scam-gate.js`) must match:
   ```sql
   SELECT p.proname, md5(pg_get_functiondef(p.oid)) FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('fn_escalate_stale_bounty_liquidity',
     'fn_notify_radius_matched_bounty','fn_notify_service_area_matched_bounty','fn_notify_zip_matched_bounty',
     'moderation_apply_signals','moderation_scan_content','moderation_transition_allowed','run_moderation_sweep');
   ```
   If any changed, regenerate the rollback before continuing.
4. **Apply the migration** (explicit go). With MCP `apply_migration`, rename
   the local file to the recorded version afterwards.
5. **Deploy moderation-sweep:**
   `supabase functions deploy moderation-sweep --use-api --no-verify-jwt`
   (or merge, which auto-deploys).
6. **Observe. Done means rows:**
   - `bounty_distribution_decisions` has new rows within one escalation cron
     cycle, and skipped rows carry reasons.
   - `moderation_sweep_runs.succeeded = true` on the next run, and
     `moderation_alerts.fanned_out_at` is stamped on any pending alert.
   - The first report after deploy appears in PostHog as `report_submitted`, and
     `reports.analytics_captured_at` is set.
   - Within 21 days, escalation recipients on later-removed bounties
     (`bounty_hunter_notifications` stage ≥ 2 ⨝ `bounty_moderation` removed)
     should be 0.

```sql
-- Why distribution was skipped (last 7 days)
SELECT path, unnest(reasons) AS reason, count(*) FROM public.bounty_distribution_decisions
WHERE decision = 'skipped' AND last_evaluated_at > now() - interval '7 days' GROUP BY 1, 2 ORDER BY 3 DESC;

-- Clean listings waiting for a human before escalation
SELECT a.bounty_id, a.summary, a.created_at FROM public.moderation_alerts a
WHERE a.threshold_key = 'escalation_review' AND a.acknowledged_at IS NULL ORDER BY a.created_at;
```

Founder loop: an `escalation_review` alert means a clean bounty from a poster
with no credibility signal is ready to reach more hunters. Open it in
moderation and Approve (or leave it; it keeps its feed visibility and local
push). A `report_threshold` alert means a listing was hidden pending review.
Approve to restore it, or Hide/Remove.

## Rollback

1. Optional: redeploy the previous `moderation-sweep`. The new one logs and
   continues when the report RPCs are missing.
2. Run `supabase/rollbacks/production/20261001140000_anti_scam_distribution_gate.down.sql`
   (one transaction). It restores production's 2026-10-01 definitions, drops the
   policy, trigger, gate, table and watermark columns.
3. Delete the `20261001140000` row from `supabase_migrations.schema_migrations`.
4. Moderation state written while live (report-driven `under_review`,
   approvals) is not reverted. These are ordinary moderation decisions; clear
   them in the admin queue.

## Residual risks

- **Griefing:** two accounts can hide any listing, or one can hide a new
  poster's listing. Mitigations: it's reversible, admins are alerted, and an
  approval discounts earlier reports. Watch `report_threshold` alerts that end
  in approval.
- **Credibility via self-dealing:** a completed transaction between two
  colluding accounts (the 08-13 ring pattern) counts as credibility. The safety
  checks still apply.
- **Shared links** (`share-bounty`, `share-og-image`) read with the service
  role, so a held listing still renders for someone who already has its URL.
- **Text-only detection:** images are not OCR'd; only "see attached" phrasing
  and attachment-with-no-description are caught.
- **zip push has no recipient cap** (pre-existing; unchanged).
- **Staging parity:** apply `20260901140000` and `20260919120000` to staging
  before persisting this migration there.
