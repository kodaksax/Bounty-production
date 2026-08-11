# PostHog Self-driving Setup Report

**Project:** Bounty (BountyExpo) — project 461576
**Date:** 2026-08-11

## Summary

PostHog Self-driving has been configured for the Bounty marketplace. Session Replay,
Error Tracking, Support (Conversations), and Health Check signal sources are now wired
to the inbox, GitHub Issues is syncing, and a 8-scout troop (5 built-in, 3 custom)
is watching the product's key surfaces daily. Findings will start appearing in the
Self-driving inbox within ~30 minutes:
[https://us.posthog.com/project/461576/inbox](https://us.posthog.com/project/461576/inbox)

---

## AI Data Processing

**Status: Approved.** The PostHog organization-level AI data processing consent was
granted before this run — a prerequisite enforced by the wizard.

---

## GitHub

**Connected during this run.**

- Integration ID: 211440
- Organization: kodaksax
- Repository granted: kodaksax/Bounty-production

---

## Products Enabled

The `products-enable` MCP tool was not available on this deploy. Products must be
enabled manually. See Follow-ups.

| Product | Status | Notes |
|---|---|---|
| Session Replay | **Enabled (inert on mobile)** | Server flip applied. `enableSessionReplay: false` is set in `lib/posthog.ts:73` — mobile recordings won't capture until this is flipped `true` and sensitive-screen masking is added. Web recordings already exist (bountyfinder.net). |
| Error Tracking | **Enabled (inert — Sentry primary)** | Server flip applied. PostHog autocapture is disabled in `lib/posthog.ts:63–68` (`errorTracking.autocapture` all false) — Sentry is the chosen error reporter. Error Tracking signal sources are armed for when this changes. |
| Support (Conversations) | **Enabled (inert — no channel connected)** | Server flip applied. Tickets only arrive once an inbound channel (email / inbox / Slack) is connected in PostHog. See Follow-ups. |

> The server flip for all three was recorded as complete (idempotent). No `posthog-js`
> init was found — this is a React Native / Expo project with `posthog-react-native`.

---

## Signal Sources

| Source product | Source type | Action | Notes |
|---|---|---|---|
| `health_checks` | `health_issue` | **Enabled** | ID: 019fef79-8542-72b3-bffb-a2197460fe02 |
| `error_tracking` | `issue_created` | **Enabled** | ID: 019fef79-877d-7840-b79d-59988e88b4fa |
| `error_tracking` | `issue_reopened` | **Enabled** | ID: 019fef79-8a8a-7e20-8276-2959f18723e2 |
| `error_tracking` | `issue_spiking` | **Enabled** | ID: 019fef79-8d0f-7b60-a21a-8c1ee536fddb |
| `session_replay` | `session_analysis_cluster` | **Enabled** | ID: 019fef79-9359-7c75-ba84-bf7b9d3fda9a — sample rate 0.1 (server default) |
| `conversations` | `ticket` | **Enabled** | ID: 019fef79-9622-78d2-aeab-70b486dd21bd |
| `signals_scout` | `cross_source_issue` | **Skipped (on by default)** | Scout gate is ON by default; creating the row would opt-out |
| `replay_vision` | — | **Skipped** | Self-authorizing via `emits_signals` on each scanner — no config row needed |

---

## Connected Tools

| Tool | Status | Notes |
|---|---|---|
| GitHub Issues | **Connected by this setup** | Warehouse source ID: 019fef7b-2706-0000-debd-6167c2a9a0d4. Syncing `issues` table (incremental, keyed on `updated_at`). Responder `github/issue` enabled. More tables (PRs, commits) can be added in the PostHog UI. |
| Sentry | **Not used** | User did not select. No responder row created. |
| Linear | **Not used** | User did not select. No responder row created. |
| Jira | **Not used** | User did not select. No responder row created. |
| Zendesk | **Not used** | User did not select. No responder row created. |

---

## Scout Troop

**Run budget:** 100 runs/day (early access default, confirmed by `scout-metadata-get`).
Runs used today: 0. Remaining: 100.

**Banner:** *"Scouts are in early access. Each project gets up to 100 scout runs a day.
Contact team-self-driving@posthog.com if you need more."*

### Enabled (8 scouts)

| Scout | Reason enabled |
|---|---|
| `signals-scout-general` | Always-on; cross-product correlations and surfaces no specialist covers |
| `signals-scout-product-analytics` | Heavy custom event tracking, saved funnel support |
| `signals-scout-feature-flags` | `useFeatureFlag` confirmed in code; instant cash out gate |
| `signals-scout-revenue-analytics` | Stripe is core (bounty marketplace with real money flows) |
| `signals-scout-anomaly-detection` | Cross-product safety net for dashboards/insights |
| `signals-scout-bounty-posting-funnel` | **Custom** — see Custom Scouts section |
| `signals-scout-payment-health` | **Custom** — see Custom Scouts section |
| `signals-scout-onboarding-funnel` | **Custom** — see Custom Scouts section |

### Disabled (22 scouts)

| Scout | Reason |
|---|---|
| `signals-scout-error-tracking` | Covered by native `error_tracking` signal sources (step 4) |
| `signals-scout-session-replay` | Covered by native `session_replay` signal source (step 4) |
| `signals-scout-ai-observability` | No `$ai_*` events or LLM SDK found |
| `signals-scout-apm` | OpenTelemetry found in API service, but no PostHog APM spans configured |
| `signals-scout-surveys` | No surveys in use (0 found) |
| `signals-scout-logs` | PostHog logs product not in use |
| `signals-scout-csp-violations` | No CSP reporting configured (mobile-first app) |
| `signals-scout-customer-analytics` | B2C marketplace, no group/accounts analytics |
| `signals-scout-data-pipelines` | No CDP destinations or batch exports configured |
| `signals-scout-data-warehouse` | Only GitHub Issues connected — not a data-warehouse-heavy project |
| `signals-scout-experiments` | No A/B experiments running |
| `signals-scout-web-analytics` | Web presence thin (mobile-first app); re-enable if bountyfinder.net grows |
| `signals-scout-web-vitals` | No `$web_vitals` events captured |
| `signals-scout-replay-vision` | Scanners created this run — no accumulated observations yet for trend analysis |
| `signals-scout-observability-gaps` | No saved insights/dashboards to gap-check against yet |
| `signals-scout-conversations` | No Conversations data (no inbound channel connected yet) |
| `signals-scout-inbox-validation` | Fresh setup — no resolved reports to validate yet |
| `signals-scout-insight-alerts` | No configured insight alerts |
| `signals-scout-mcp-tool-calls` | No `$mcp_tool_call` events |
| `signals-scout-tasks` | No PostHog tasks/agent runs yet |
| `signals-scout-skills-store` | Skills store hygiene — low priority for now |
| `signals-scout-data-warehouse` | (duplicate entry removed) |

> **Re-enable follow-ups:** `signals-scout-web-analytics` if bountyfinder.net web
> traffic grows; `signals-scout-experiments` when A/B tests are launched;
> `signals-scout-apm` if OpenTelemetry spans are piped into PostHog.

---

## Custom Scouts

Three custom scouts were proposed and approved. Noise escape hatch: set `emit: false`
on any scout's config in PostHog to switch it to dry-run (runs but writes nothing to
the inbox).

### signals-scout-bounty-posting-funnel

**What it watches:** `post_started → payment_attached → post_published` conversion
rate and the funding-escape rate (`post_funding_skipped_to_honor`, `post_abandoned`).

**Discriminator:** `post_published / post_started` ratio and `post_funding_skipped_to_honor / post_started` escape rate. When escapes rise, funded publishes fall — these move inversely.

**Why no built-in covers it:** `signals-scout-product-analytics` watches saved funnel
insights only. On a fresh project with no saved funnels, the posting funnel is
invisible to it. This scout watches the raw events directly, and knows the domain
meaning of `post_funding_skipped_to_honor` (the named "known biggest revenue leak" in
`lib/services/analytics-service.ts`).

**Surfaces considered and ruled out:** Hunter claim funnel (`bounty_claim_started →
bounty_claim_submitted`) — ruled out because it's a narrower subset of the same
conversion surface; merged into the posting funnel's context. Dispute funnel — ruled
out (insufficient distinct event pair to discriminate signal from noise at low volume).

### signals-scout-payment-health

**What it watches:** `payment_failed / payment_initiated` ratio (deposits) and
`payout_failed / payout_initiated` ratio (payouts), plus `apple_pay_unavailable`
absolute count.

**Discriminator:** Failure ratio step-change above baseline. `apple_pay_unavailable`
should be near zero post-fix — any sustained non-zero count is independently
report-worthy.

**Why no built-in covers it:** `signals-scout-revenue-analytics` watches Stripe sync
stalls (data pipeline health), not event-level payment failure rates. The raw
`payment_failed` / `payout_failed` event stream is uncovered by any built-in scout.

**Surfaces considered and ruled out:** ACH-only scout — folded into payment-health
as Pattern 4 (separate scout not justified at current volume).

### signals-scout-onboarding-funnel

**What it watches:** `onboarding_auth_completed → onboarding_completed` conversion,
role-split (poster vs hunter paths diverge at `onboarding_role_selected`), and
step-level drop-off including location-based attrition (`onboarding_no_nearby_bounties`).

**Discriminator:** Completion / auth-completed ratio, 7d vs prior 7d.

**Why no built-in covers it:** Same gap as posting funnel — `signals-scout-product-analytics`
needs saved funnels. `general` is domain-blind to what `onboarding_role_selection_skipped`
or `unserviceable_region_shown` mean in context.

**Declined:** None.

---

## Replay Vision Scanners

Replay Vision scanners are LLMs that watch individual session recordings on a schedule
and push what they find directly to the Self-driving inbox. Findings arrive at half
weight — two independent findings on the same defect are needed before a report is
promoted. The scanners are the only part of this setup that spends Replay Vision credits.

> The `creating-replay-vision-scanners` skill was not seeded on this deploy, so credit
> spend was not verified against the org's remaining quota. The scanners are scoped
> conservatively and should not be a large fraction of the budget at current recording volumes.

| Scanner | Status | Query scope | Sampling | Estimated spend |
|---|---|---|---|---|
| **Broken experiences** | **Created** (ID: 019fef82-0a9f-721b-9c5f-7041c2365a8c) | `bountyfinder.net` URLs containing `post` — the key posting flow | 0.5 | 0 credits/mo (no matching sessions yet) |
| **User frustration** | **Created** (ID: 019fef82-4a3b-774f-b095-2f5640f3f98c) | Sessions with `$rageclick` events (any URL) | 1.0 | ~900 credits/mo (60 obs estimated) |

**Why posting flow for scanner 1:** Web recordings exist from `bountyfinder.net/#post`
(the bounty creation page). The posting flow is where a broken experience costs the
most — a silent defect here loses funded bounty revenue without throwing a JS exception.
Scanner 2 is gated on `$rageclick` (a different axis), so the queries don't overlap.

The project has recordings already (web, `bountyfinder.net`). Mobile session replay is
disabled in `lib/posthog.ts:73` — scanners will only watch web sessions until mobile
replay is enabled.

---

## Follow-ups

- [ ] **Enable products manually in PostHog** (the `products-enable` tool was unavailable):
  - Session Replay: PostHog Settings → Session replay → "Record user sessions"
  - Error Tracking: Settings → Error tracking → "Enable exception autocapture"
  - Support: Settings → Support (sidebar)
- [ ] **Enable mobile session replay** (when ready): flip `enableSessionReplay: false → true`
  in `lib/posthog.ts:73` and add sensitive-screen masking for Stripe/ACH/password
  screens first. Then rebuild and deploy.
- [ ] **Connect a Support/Conversations inbound channel** (email, inbox, or Slack) in
  PostHog so the `conversations/ticket` signal source starts producing findings.
- [ ] **Enable `signals-scout-web-analytics`** in PostHog if bountyfinder.net web
  traffic grows and you want to track channel attribution / landing-page health.
- [ ] **Enable `signals-scout-experiments`** in PostHog when A/B experiments are launched.
- [ ] **Enable `signals-scout-apm`** in PostHog if OpenTelemetry spans from `services/api`
  are piped into PostHog APM.
- [ ] **Verify Replay Vision credit budget** once the `creating-replay-vision-scanners`
  skill is available: run `vision-quota-retrieve` and `vision-scanners-estimate-create`
  to confirm the User frustration scanner's ~900 credits/mo fits the org budget.
- [ ] **Save onboarding and posting funnels as PostHog insights** so `signals-scout-product-analytics`
  can also watch them (the custom scouts cover the raw events, but saved funnels enable
  the built-in specialist too).

---

## What Happens Next

The scout coordinator picks up the new configs within ~30 minutes and runs the first
scans. Each enabled scout draws 1 run from the project's daily 100-run budget. Findings
cluster into reports in the Self-driving inbox; immediately-actionable reports can
spawn coding tasks automatically. Check the inbox at:

[https://us.posthog.com/project/461576/inbox](https://us.posthog.com/project/461576/inbox)
