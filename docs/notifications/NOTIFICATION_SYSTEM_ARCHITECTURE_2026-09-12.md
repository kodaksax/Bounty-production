# Notification System Architecture (as of 2026-09-12)

This is the current-state reference for the notification system after the
2026-09-12 audit and overhaul. Earlier docs in this folder describe specific
past fixes and may be stale; this file describes what is live today.

## 1. Pipeline

```
trigger (DB trigger, edge function, or client RPC)
  -> INSERT public.notifications_outbox (recipients, title, body, data, status='pending')
  -> pg_cron 'drain-notifications-outbox' (every minute)
  -> HTTP POST process-notification edge function
       -> resolves category from data.type (TYPE_CATEGORY, hand-mirrored
          from lib/config/notification-taxonomy.ts)
       -> per recipient: checks notification_channel_preferences
          (category x channel) and quiet hours (profiles.quiet_hours_*)
       -> writes public.notifications row(s) for in-app (unless data.skipInApp)
       -> POSTs to send-notification-email for the email-channel subset
       -> sends push via Expo Push API for the push-channel subset
       -> captures PostHog events (see section 5)
```

`public.notifications_outbox` is service-role only (RLS enabled, zero
policies) -- nothing writes to it directly from client code. All producers
are either `SECURITY DEFINER` Postgres functions/triggers or edge functions
using the service-role key.

## 2. Producers (what creates an outbox row)

| Event | Producer | Notes |
|---|---|---|
| Bounty posted, geo match | `fn_notify_zip_matched_bounty`, `fn_notify_radius_matched_bounty`, `fn_notify_service_area_matched_bounty` (all `AFTER INSERT ON bounties`) | Candidate-finding unchanged from before the overhaul; final send now goes through `fn_score_and_dispatch_bounty_notification` (relevance scoring + cap + dedup) |
| Bounty stale (2h / 12h, zero applications) | `fn_escalate_stale_bounty_liquidity` (pg_cron, every 20 min) | Broadens the notified pool (2x radius -> Anywhere hunters for paid jobs -> flat 50mi); stops permanently once the bounty has any application. For `work_type='online'` bounties the candidate pool is bounded to profiles active in the last 90 days, capped at 500, ordered by recency (`20260912152257_bound_online_liquidity_escalation_candidates.sql`) rather than aggregating every profile in the table |
| Bounty low-quality at post time | `fn_bounty_quality_score_and_nudge` (`AFTER INSERT ON bounties`) | Fires once, only if `quality_score < 50` |
| Bounty still low-quality, zero applications at 2h | Folded into `fn_escalate_stale_bounty_liquidity` | Fires once, only if `quality_score < 70` and hasn't fired before |
| Application received / accepted | `handle_bounty_request_notification` | Unchanged |
| Message received | `handle_new_message_notification` | Unchanged, bundled per conversation |
| Completion submitted / reviewed | `handle_completion_submission_notification`, `handle_completion_review_notification` | Unchanged |
| Payout paid/failed/canceled, chargeback disputes | `webhooks/index.ts` (`enqueuePushEmailFanout`) | Unchanged |
| Verification submitted/verified/rejected/canceled | `identity-webhooks/index.ts` | Unchanged |
| Dispute created/resolved/escalated, account warnings | `send_system_notification()` RPC, called from `dispute-service.ts` | **Fixed 2026-09-12**: previously inserted only into `notifications` (in-app bell), never reached push/email. Now also enqueues an outbox row with `skipInApp:true` |
| Unready payee on wallet release | `fn_notify_unready_payee_on_release` | Applied live 2026-09-12 (existed in git since 08-24, never applied) |
| Reconciliation critical finding / daily digest | `fn_alert_on_critical_finding`, `fn_digest_unresolved_findings` | Applied live 2026-09-12 (existed in git since 08-24, never applied); admin-only |

## 3. Hunter relevance scoring (`fn_score_and_dispatch_bounty_notification`)

Every bounty-nearby send (post-time and escalation) funnels through this one
function. Given a bounty id and a candidate hunter-id array, it:

1. Excludes anyone already notified about this bounty, ever, any stage
   (`bounty_hunter_notifications`, PK `(bounty_id, hunter_id)`).
2. Excludes anyone who already applied (`bounty_requests`).
3. Excludes anyone already notified about 5+ other bounties in the last hour
   (anti-burst).
4. Scores the remainder: `category_score*0.35 + activity_score*0.2 +
   reliability_score*0.15 + distance_score*0.3` (each component 0-1).
   - Category: 1.0 if `bounties.category` is in the hunter's
     `profiles.skill_categories`, 0.5 if the hunter has no categories set
     (neutral, not penalized), 0.0 if they have categories and this isn't
     one.
   - Activity: based on `profiles.last_session_at` recency.
   - Reliability: penalized by `profiles.cancellation_count`.
   - Distance: `ST_Distance` between bounty and hunter geo, decaying to 0 at
     25km (neutral 0.5 if either lacks geo data).
5. Sends only the top N by score, where N scales with the reward
   (`is_for_honor`: 15, `>=$100`: 60, `>=$40`: 40, else 25).
6. Logs every sent recipient to `bounty_hunter_notifications` with the full
   score breakdown in `reasons` (jsonb) -- this is the audit trail for "why
   was this hunter notified" without needing an admin UI.

## 4. Bounty quality score (`fn_compute_bounty_quality_score`)

Category-aware 0-100 completeness score, recomputed on insert and on any
edit to a scored field (`bounties.quality_score`). No structured category
taxonomy exists, so "does this job need real scope info" is inferred by a
keyword match against category+title (repair/install/plumbing/moving/etc.).
Weighted components (weight only counts toward the denominator if
applicable, so the score is always 0-100 regardless of which apply):

- Description length (25)
- Category set (10)
- Location, only for `work_type='in_person'` (20)
- Timing (schedule_type/start_date/deadline set) (15)
- Scope (skills/duration/detailed description) -- weight 20 if the keyword
  heuristic flags this as scope-sensitive, else 10
- Photos -- only weighted (15) for scope-sensitive jobs

`bounties.quality_nudge_stage` caps at 2: stage 1 nudge at post time
(`<50`), stage 2 follow-up at the 2h liquidity checkpoint (`<70`, zero
applications), never a third.

## 5. PostHog instrumentation (added 2026-09-12; previously none existed)

**Client** (`lib/posthog.ts` `capture()`):
- `notification_permission_result` -- fires only on a genuine status
  transition, not every foreground re-check.
- `notification_received` -- foreground push receipt.
- `notification_opened` -- fires from all three tap surfaces (push tap /
  cold start, Notification Center row tap, action-sheet "View"/"Add
  Details"), tagged with `surface`.
- `notification_dismissed` -- archive action.
- `notification_action_completed` -- e.g. `accept_application` from the
  action sheet.
- `notification_preference_toggled` -- category/channel settings changes.

**Server** (`process-notification/index.ts`, via PostHog's `/batch/` HTTP
capture endpoint, same pattern as `process-analytics-person`):
- `notification_generated` -- one event per recipient per outbox row,
  listing which channels they'll receive it through.
- `notification_sent` -- per push recipient, only for recipients who actually
  had a deliverable token and whose ticket came back non-error.
- `notification_failed` -- per push recipient, `reason: 'no_deliverable_token'`
  (that specific recipient had zero enabled tokens, independent of whether
  other recipients on the same row succeeded) or `'push_send_error'` (their
  specific ticket errored, or their chunk's HTTP request failed outright).

All events for one outbox-row invocation are queued in-process and flushed as
a **single** batched HTTP call (`schedulePostHogCapture`), fired via
`EdgeRuntime.waitUntil` (falls back to a detached un-awaited call if that
global isn't present) so the response is never blocked on PostHog network
latency. Best-effort throughout (wrapped in try/catch, never affects
delivery); requires `POSTHOG_PROJECT_API_KEY` (already configured).

## 6. Anti-spam rules currently enforced

- A hunter is never notified about the same bounty twice, any stage
  (`bounty_hunter_notifications` PK).
- A hunter notified about 5+ bounties in the last hour is skipped until the
  next round.
- A poster is nudged about bounty quality at most twice, ever, per bounty.
- Liquidity escalation stops permanently once a bounty has any application.
- Reconciliation alerts coalesce per `finding_type` per hour; the daily
  digest sends nothing when there's nothing to report.
- Quiet hours (per-user, IANA timezone) suppress non-urgent push; `security`
  category and a fixed `URGENT_TYPES` set bypass them.

## 7. Known gaps NOT addressed in this pass

These were found during the audit and are still open:

- **Email delivery**: `RESEND_API_KEY` was provisioned 2026-09-12 as part of
  this work, so email should now be live -- verify via
  `send-notification-email` logs / `notifications_outbox` rows with an
  email-channel recipient.
- **`notification_preferences` legacy table**: still live and still read by
  `services/api` (a separate Fastify backend) -- not dropped, needs a
  decision on whether that service is still deployed before it can be.
- **Deep-link analytics attribution inconsistency**: `navigation_source:
  'notification'` is still only wired for the marketplace category via a
  `?source=notification` query param; the new `notification_opened` event
  (section 5) is the more complete signal going forward, but the old
  mechanism wasn't removed.
- **Cold-start navigation** still uses a fixed 100ms `setTimeout` heuristic
  rather than an actual router-ready signal (`notification-context.tsx`,
  `ROUTER_READY_DELAY_MS`).
- **Legacy `data.senderId` fallback** in `handleNotificationTap` for
  pre-`type`-field payloads was not investigated/removed.
- **Notification experimentation framework** (A/B testing copy/timing) was
  not built.
- **Settings UI**: no new preference category was added for quality nudges
  or liquidity-escalation sends -- both ride the existing `marketplace`
  category toggle, which is an intentional simplification, not an oversight.
- **Device/platform testing**: none of this was verified on a real iOS or
  Android device in this pass (no device available in this environment).
  TypeScript compiles clean (`tsc --noEmit`, `deno check`) and the existing
  Jest suite passes, but that is not a substitute for on-device verification
  of push delivery, deep links, and cold-start behavior.
- **`bounties_open_implies_unassigned` data bug**: at least one live bounty
  (`2a39dbf2-e720-4cff-b95d-bbe8fb84523d`, "Move a couch") has `status='open'`
  with `accepted_by` already set, violating a `NOT VALID` constraint added
  2026-09-11. This is a bounty-lifecycle data-integrity bug, out of scope
  for the notification overhaul, but it means `fn_escalate_stale_bounty_
  liquidity` will log a warning and skip this specific bounty on every run
  until the underlying row is fixed.
