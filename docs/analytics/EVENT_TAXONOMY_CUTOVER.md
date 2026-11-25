# Analytics Taxonomy Cutover

Date: 2026-08-08

## Investigation Findings (4-event gaps)

The observed count gaps are expected and not a silent ingestion bug.

1. `bounty_create` vs `bounty_created`

- `bounty_create` was emitted by timing instrumentation through `performanceService.startMeasurement/endMeasurement`.
- `bounty_created` is emitted only on successful create flow completion.
- Gap indicates failed/aborted attempts or rollbacks, not missing successful events.

2. `payment_initiate` vs `payment_initiated`

- `payment_initiate` was emitted by timing instrumentation.
- `payment_initiated` is the business event for beginning a real payment flow.
- Gap indicates attempted timing windows that did not complete business success paths.

3. `setup_intent_create` vs `setup_intent_created`

- `setup_intent_create` was emitted as timing instrumentation.
- `setup_intent_created` is emitted after backend SetupIntent creation succeeds.

4. `payment_confirm` vs `payment_completed`

- `payment_confirm` was emitted as timing instrumentation.
- `payment_completed` is emitted only when confirmation succeeds.

## User-facing failure behavior check

For bounty posting and payment flows, failures are surfaced to users via alerts/error banners and often followed by rollback (for example bounty deletion on payment/escrow failure). These are not fully silent failures.

## Cutover Changes (this release)

1. Stop duplicate startup event

- Removed manual `Page View` startup emit.
- Keep canonical startup business event `app_opened`.

2. Remove redundant moments intermediate event

- Removed `moment_queued` emission.
- Keep `moment_event_enqueued` and `moment_shown` as the queue/visibility lifecycle pair.

3. Separate timing telemetry from business events

- `trackTiming(...)` now emits a single event name: `performance_timing`.
- Previous timing name is preserved in properties: `timing_name` and `timingName`.
- This prevents collisions with business event names.

4. Property naming migration support

- Event properties now dual-send snake_case and camelCase keys when only one form is provided.
- Included both `user_id` and `userId` on tracked events. (`userId` retired 2026-11-24: events carry `user_id` only. See "Audit fixes — 2026-11-24".)

## Dashboard Risk and Migration Guidance

- Do not delete historical events from existing dashboards immediately.
- Apply a query cutover date at deployment time for `performance_timing` adoption.
- Update business dashboards to use canonical business events only:
  - `bounty_created`
  - `payment_initiated`
  - `setup_intent_created`
  - `payment_completed`
- Move latency and duration charts to `performance_timing` and filter by `timing_name`.

## Notes

- Historical event names remain in PostHog history; this cutover is forward-looking.
- If needed, keep dual property naming for one release, then retire camelCase from new emits after dashboard updates complete.

---

# Canonical rename — 2026-08-28

A client-wide instrumentation audit renamed the marketplace-lifecycle events
**in place** to a single canonical taxonomy. Old names stop being emitted as of
this release; historical events keep their old names in PostHog. Every existing
insight / funnel / dashboard / saved cohort and the three custom self-driving
scouts (`signals-scout-bounty-posting-funnel`, `-payment-health`,
`-onboarding-funnel`) that query the old names must be repointed, or split on
the 2026-08-28 boundary.

## Rename map (old → canonical)

| Old event | Canonical event | Emit site(s) |
|---|---|---|
| `post_flow_started` | `composer_opened` | `app/screens/CreateBounty/index.tsx`, `app/onboarding/details.tsx` (new for onboarding) |
| `post_started` | `bounty_started` | `app/screens/CreateBounty/index.tsx`, `app/onboarding/details.tsx` |
| _(new)_ | `bounty_submitted` | `app/screens/CreateBounty/useBountyPublish.ts`, `app/onboarding/details.tsx` |
| `post_published` **+** `bounty_published` (fired **both**, per publish) | `bounty_published` (single) | `app/screens/CreateBounty/index.tsx` `onPublished`, `app/onboarding/details.tsx` |
| `bounty_claim_started` | `application_started` | `components/bountydetailmodal.tsx`, `app/bounty/[id]/public.tsx`, `app/onboarding/details.tsx` |
| `bounty_claim_submitted` | `application_submitted` | same 3 |
| `bounty_claim_failed` | `application_failed` | same 3 |
| _(new)_ | `application_withdrawn` | `lib/services/application-withdrawal.ts` (shared by `app/tabs/postings-screen.tsx` + `app/tabs/inbox-screen.tsx`) — emitted success-only |
| `bounty_claimed` **+** `bounty_accepted` (dual-emit) | `application_accepted` (single) | `hooks/useAcceptRequest.ts` |
| _(new)_ | `work_started` | `hooks/useAcceptRequest.ts` (with `application_accepted`) |
| _(new)_ | `completion_submitted` | `lib/services/completion-service.ts` `submitCompletion` |
| `dispute_opened` | `dispute_started` | `lib/services/dispute-service.ts` `createDispute` **and** `createWorkflowDispute` (was silent) |
| `onboarding_role_selected` | `role_selected` | `app/onboarding/role-select.tsx` (was `welcome.tsx` until role selection moved after sign-up) |
| `user_signed_up` | `signup_completed` | Server since SBA-13: `process-analytics-person`, one per new profile, every sign-in method (see below). Was `app/auth/sign-up-form.tsx`, email only. |
| _(new)_ | `poster_activated` | `lib/analytics/lifecycle.ts` — first successful publish, once per device |
| _(new)_ | `hunter_activated` | `lib/analytics/lifecycle.ts` — first submitted application, once per device |

Unchanged (already canonical): `bounty_viewed`, `bounty_cancelled`,
`bounty_completed`, `onboarding_completed`.

Out of scope (kept as-is — distinct service-level meaning, not in the lifecycle
set): `bounty_created`, `bounty_queued`, `bounty_details_added`,
`auth_signup_started` / `auth_signup_success` / `auth_signup_failed` (diagnostic
detail; `signup_completed` is the conversion event), `post_step_viewed`,
`post_step_completed`, `post_step_abandoned`, `post_abandoned`,
`post_field_focused`, `post_title_typed`, `amount_set`, `payment_attached`, etc.

## Duplicate / misleading firing fixed

1. **`post_published` + `bounty_published` both fired on every create_flow
   publish.** They were the terminal events of two overlapping funnels. Folded
   into a single `bounty_published` emitted once by the surface layer
   (`index.tsx onPublished`), merging the business payload (from
   `useBountyPublish`'s `meta`) with the flow-timing payload.
2. **`bounty_claimed` + `bounty_accepted` dual-emit** on every poster accept
   (`useAcceptRequest.ts`) — the second was a back-compat alias. Collapsed to
   one `application_accepted`.
3. **`createWorkflowDispute` emitted nothing** — in-progress / review-verify
   disputes were invisible. Now emits `dispute_started` with `stage`.
4. **`completionService.submitCompletion` had zero analytics** — the hunter
   submitting work for review was untracked. Now emits `completion_submitted`,
   only for a genuinely new submission row (not the dedupe-return path).
5. Already-fixed before this pass (noted for context): `post_started` firing
   from the composer mount effect on every Post-tab focus (fixed 2026-08-24 —
   see the doc comment in `lib/services/analytics-service.ts`).

## Standard properties on canonical events

Where known, every canonical event carries: `bounty_id`, `amount`,
`application_id`, `role` (`'poster'` | `'hunter'`), `surface`
(`'create_flow'` | `'onboarding'` | `'modal'` | `'public_route'` | `'inbox'` |
`'my_postings'`), `source` / referrer, and — on lifecycle events —
`lifecycle_stage` (`'signed_up'` | `'onboarded'`). Never attached: raw
message/description/proof text, emails, precise coordinates.

## Operational-truth boundary

PostHog carries behavioural analytics only. "Has this user ever posted /
applied / completed" is answered by the Supabase row state (the
`bounty_events` ledger and table counts), never by these events. The
`poster_activated` / `hunter_activated` guard is device-local (AsyncStorage),
so a returning user on a new device can re-emit once — use a first-touch /
min-timestamp aggregation in PostHog if a strict once-per-person figure is
needed.

---

# Duplicate-family cleanup — 2026-09-25

One canonical event per concept. Old names keep their history in PostHog;
builds that predate this release keep sending them until users update, so
expect a tail rather than an immediate stop.

| Retired | Canonical | How |
|---|---|---|
| `post_published` | `bounty_published` | Already folded in on 08-28 (see above); dark since 09-04. This pass repointed the consumers that were never updated. |
| `payment_error` | `payment_failed` | `logPaymentError()` no longer emits. It fired 3ms after `payment_failed` for the same failure, so every decline counted twice. |
| `screen_viewed` | `$screen` | `lib/analytics/screen-tracking.ts` emits only `$screen`, which already carried identical properties (verified 1:1 in PostHog). |
| `Application Opened` | `app_opened` | Dropped in `before_send` (`lib/posthog.ts`). `captureAppLifecycleEvents` stays on for `Application Installed` / `Updated`. |
| `auth_signup_success` | `signup_completed` | Already removed in code on 09-13; this is the old-build tail. |

## Failure events: one serializer

Every `*_failed` event spreads `failureEventProps(error)` from
`lib/utils/stripe-error.ts`: `error_code` (decline code first, then the most
specific code), `error_type`, `decline_code`, `code`, `error_message` (≤200
chars), `request_id`, `payment_intent_id`. Group by `error_code` + `stage`.
Never `String(error)`: the plain objects `invokePayments` and the Stripe SDK
throw serialize to `"[object Object]"` (the `setup_intent_failed` regression,
09-15/16).

## Also fixed in this release

* `app_opened` fired exactly twice per session: the startup effect in
  `app/_layout.tsx` re-runs when `fontsLoaded` flips and its guard was
  per-run. Counts before this release are 2x.
* Uncaught JS errors were captured nowhere on iOS 26+ (~72% of app users on
  2026-09-25). `Sentry.init()` is skipped there (`lib/utils/sentry-gate.ts`)
  and PostHog's exception autocapture was off. PostHog now captures
  uncaught exceptions and rejections where Sentry does not run.
  `initGlobalErrorHandlers()` now installs once and chains to the handler it
  replaces. Before, its second call overwrote Sentry's handler.

## PostHog objects repointed (2026-09-25)

Experiment 425016 (primary metric `bounty_published`; still a draft with a
100/0 split), dashboard 2025278 tiles `IRsgPi07`, `6eFoTwNL`, `vI1UcOPK`
(retired names now read `retired`, not `DEAD`), and insights `ZM2Jd6bb`,
`83SaO2EQ`, `ta2FLs4b`, `5mRPIVLX`, `ZRXRVayO`, `3tzSLtaj`. Not repointed:
the three self-driving scouts named in the 08-28 section.

---

# Funnel analytics that misled — SBA-13, 2026-10-20

From the Shoal behavioral audit (`docs/audits/shoal-behavioral-audit.md`,
SBA-13; Cowork ANLT-01/02/03/06 and DQ-10).

## `signup_completed` is sent by the server

Before: only the email form sent it. Apple and Google sign-ins never did, and
they were 431 of 526 new prod profiles in the 45 days to 2026-10-19 (apple
226, google 205, email 94, phone 1), so PostHog counted about one signup in
five.

Now: one `signup_completed` per new profile, for every sign-in method.

- A profiles INSERT trigger queues the event in
  `public.analytics_signup_events`
  (`supabase/migrations/20261020140000_server_signup_completed_event.sql`).
  `process-analytics-person` sends it in the same PostHog batch as the person
  `$set`. That function already runs for every new profile, through the
  `drain-analytics-person-outbox` cron (every minute).
- `distinct_id` is the user id (the same id the app identifies with), and the
  timestamp is `auth.users.created_at`.
- Properties: `method` (`email` | `apple` | `google` | `phone`, from the auth
  provider), `lifecycle_stage: 'signed_up'`, `is_internal`, `app_env`, and
  `source: 'server_profile_insert'`. `app_env` comes from the function's
  `APP_ENV`, or from the project URL when that is unset. Staging builds share
  this PostHog project (29 of 123 client signups in the 45 days to 10-19), so
  filter `app_env = production`.
- Each account has a fixed event uuid, so a retried send is deduplicated by
  PostHog rather than counted twice.
- The email form no longer sends it. Builds from before this change still send
  the old email-only client event (no `source`) until they age out. **Filter
  `signup_completed` on `source = server_profile_insert`** so email signups are
  not counted twice. `has_session` no longer exists; a no-session email signup
  is still visible as `auth_signup_requires_confirmation`.
- Profiles backfilled for accounts more than a day old are not counted as
  signups.
- **Observed 2026-10-22:** every profile created since the trigger went live
  (2026-10-20 04:51 UTC) has a row, sent within about a minute: 14 of 14, plus
  one account deleted 2.5 minutes after signing up, which PostHog keeps and
  Supabase does not. Weeks that started before 10-20 stay under-counted;
  nothing was backfilled.

## Hire funnel order

The pay-at-accept gate (`hooks/useAcceptFunding.ts`,
`components/accept-funding-gate.tsx`). Each step is a subset of the one
before it, per poster:

1. `accept_funding_required`: the poster tapped Select on an applicant, a
   charge is due, and the hire sheet opened. `balanceCovers` says whether the
   wallet already covers it.
2. `accept_funding_started`: a payment sheet opened from the hire sheet.
   `paymentMethod` is `card` (charging the saved card), `applePay`,
   `paymentSheet` (Stripe's Payment Sheet), or `linkCard` (the add-a-card
   sheet, when no card is on file; it charges nothing). When the balance covers the hire there is no payment sheet, and
   pressing "Confirm & hire" sends it with `paymentRequired: false`. It fires
   once per sheet opened, so a poster who links a card and then pays sends it
   twice. Count posters, not events.
3. `payment_completed`: the top-up captured (pay variant only).
4. `accept_funding_succeeded`: escrow reserved and the hunter accepted.

Exits: `accept_funding_failed` (`reason`, per failed step, can repeat), and
`accept_blocked_by_payment` (once per gate: the attempt ended at payment with
nobody hired; see "Acceptance root cause" below). `accept_blocked_by_payment`
replaced `accept_funding_abandoned` on 2026-11-05.

Before 2026-10-22, opening the add-a-card sheet sent nothing, so a poster
with no saved card went from `required` straight to `abandoned`. In the 60
days to 10-22, 6 external posters reached step 1, all with
`balanceCovers: false`. One reached step 2 (card, then Apple Pay, both
declined, 10-18). Two backed out within 8 s without opening any payment
sheet. Three used older versions of the gate (09-10 to 09-24): two had a
separate top-up step, and one charged a card without sending `_started`.

## Acceptance root cause (2026-11-05)

Question: is the acceptance problem "posters aren't returning" or "posters
look and reject"? Three events answer it per application, all joined on
`application_id` (snake_case, like `application_accepted`). Readout:
`scripts/ops/acceptance-root-cause.sql` (HogQL, buckets every application
submitted since the release into one outcome).

| Event | Fires when | Replaces |
|---|---|---|
| `application_viewed` | A pending application is on the poster's screen. `surface`: `inbox_list` (Inbox > My Bounties row, at least 50% visible for 250 ms, only while the Inbox tab and My Bounties segment are showing; once per application per session), `requests_list` (legacy Requests tab card; same rules), `bounty_thread` (opened on its own, once per foreground visit). | `applicant_list_viewed` |
| `application_dismissed` | The poster opened the application in the bounty thread and left (`trigger`: `leave` or `background`) without accepting, passing or messaging. `dwell_ms`. | nothing (the implicit counterpart of `application_declined`) |
| `accept_blocked_by_payment` | A hire attempt ended at the payment step with nobody hired. Once per gate. `trigger`: `cancel`, `background`, `unmount`, `deposit_unconfirmed`, `prior_deposit_unconfirmed`. Also `stage`, `balanceCovers`, `paymentAttempts`, `lastFailureCode`. | `accept_funding_abandoned` |

Shared properties (`lib/analytics/application-view.ts`): `bounty_id`,
`application_id`, `hunter_id`, `applicant_count`, `application_age_hours`,
`hunter_verified`, `hunter_completed`, `has_message`, `applicant_distance_mi`,
`is_for_honor`, `amount`, `trustTier`. No message text.

`application_declined` gained `application_id` on the same date (it had only
`bountyId`/`hunterId`), so declines join too.

Why the retirements:

- `applicant_list_viewed` fired per bounty whenever the list rendered. BountyApp
  preloads the Inbox as Wallet's swipe neighbour, so it also fired for posters
  who never opened the Inbox. Weeks before 2026-11-05 overstate views. Its
  `bountyId` is `bounty_id` on the replacement.
  `scripts/ops/poster-exits-weekly.sql` reads both names.
- `accept_funding_abandoned` fired on every background and then again on the
  later cancel or unmount, so one attempt could count 2 or 3 times. It sent
  nothing when the sheet closed on an unconfirmed deposit or refused to open
  because of one. In the 90 days to 11-05: 12 `accept_funding_required` and 11
  `accept_funding_abandoned` from 7 external posters, against 1
  `application_accepted`.

Repoint: the PostHog insight "💰 Funding-at-accept — new escrow taxonomy"
(`BWYMQtEz`) uses `accept_funding_abandoned`. Older builds keep sending the
retired names until they update, so split queries on the release date.

Known gap: the web poster page (`supabase/functions/poster-web`) shows
applicants but sends none of these events. A poster who only reviews on the
web reads as "returned, didn't look" in the readout.

### `payment_completed` is not broken

It fires when a wallet top-up succeeds in the app (`stripe-service`,
`apple-pay-service`). It last fired 2026-09-19, because the last wallet
deposit on prod was 2026-09-19 19:04 UTC: there have been none since
(`wallet_transactions`, `type = 'deposit'`). The money that did come in
after that went through v2 bounty payments (web checkout, card at post),
which never sent `payment_completed`. Those are recorded in
`bounty_events` as `payment.record_captured`. The server webhook's
`payment_completed` goes to HeyCatch only, never to PostHog.

## `primary_role` is saved at role select

`app/onboarding/role-select.tsx` now writes `profiles.primary_role` when the
role is tapped, as well as sending `role_selected`. Onboarding completion
(`hooks/useCompleteOnboarding.ts`) still writes it again, and the first post or
application can still infer it. Before, anyone who stopped between role select
and the founder note stayed NULL. The write also re-queues the server person
snapshot, so the PostHog person's `role` updates without waiting for
completion.

## Events carry `account_status` (DQ-10)

Every event from the app now carries `account_status` (`active` |
`suspended` | `banned`). It is a super property registered from
`profiles.account_status` whenever the profile loads (`syncAccountStatus` in
`lib/posthog.ts`), so a bounty or application event keeps the status the
account had when it happened. Events from builds before this change do not
have the property.

What it does not cover:

- **Flagged but still active.** Nothing on the profile marks an account as
  flagged. `risk_level` is `low` and `account_restricted` is false on all 986
  prod profiles (2026-10-19). Moderation signals are per bounty and admin-only,
  and the 09-25 fraud ring was identified by hand from Stripe Radar, not by a
  stored flag. Marking events "flagged at the time" needs a stored per-account
  flag (for example a `profiles.fraud_flagged_at` set by moderation or a Radar
  `early_fraud_warning` webhook) that is either readable by the owner or sent
  server-side.
- **Banned later.** For "exclude accounts that were banned afterwards", use a
  person property instead. Adding `account_status` to
  `enqueue_analytics_person_snapshot()` and its trigger column list would do
  it server-side.
- Suspended and banned accounts are signed out and blocked by RLS from posting
  or applying (`20260726000000_enforce_account_status.sql`). On successful
  bounty and application events the property will almost always be `active`;
  it is most useful on attempts and failures.

## What these mean (no code change)

- **`accept_funding_started`** means a payment sheet opened from the hire
  sheet, or the poster pressed "Confirm & hire" when the balance already
  covered it. See "Hire funnel order" below.
- **`bounty_requests.poster_interacted_at`** does not count simply viewing the
  applicant list in the app. Use `applicant_list_viewed`
  (`hooks/useApplicantListViewed.ts`) for "the poster looked". It is stamped
  when:
  - the poster sends a message the applicant can see
    (`trg_messages_stamp_poster_interaction` → `fn_stamp_poster_interaction_on_message`),
  - the poster opens a question to an applicant in the app
    (`hooks/useAskApplicant.ts` → `fn_mark_poster_interacted`). **That RPC is
    not on prod as of 2026-10-19** (it is in
    `20260913000000_bounty_request_expiry_and_poster_nudges.sql`), so this path
    currently stamps nothing,
  - **the exception:** a poster views their applicants on the web poster page
    (`supabase/functions/poster-web`), which stamps every pending application
    it shows. On web, viewing does count.
- **`bounties.quality_score`** does not order anything: not the feed, search,
  or dispatch. Its only use is gating the poster quality nudge (score below 70
  in `fn_escalate_stale_bounty_liquidity_unlocked`). Do not read a rank effect
  into it.

---

# Server-side web events — 2026-11-24

From the 2026-11-23 PostHog audit. A bounty posted through website checkout,
and a hire or completion approval made on the web poster page
(`bountyfinder.net/manage/`), ran no app code, so no client sent the canonical
event. In 2026-10-21 → 11-22 the ledger had 29 `bounty.posted` rows against 24
`bounty_published` events: the 5 missing were 3 web-checkout posts and 2 later
deleted. Two web-approved completions had no `bounty_completed`.

The server now sends the canonical names for those steps. They follow the
server `signup_completed` rules: `distinct_id` is the Supabase user id; the
uuid is a UUIDv5 of `'<event>:<row id>'`
(`supabase/functions/_shared/web-marketplace-events.ts`), so a retried send is
dropped by PostHog rather than counted twice; `app_env` comes from
`resolveAppEnv`; and `source` names the sending function. Ids, amounts and
enums only: no email, title or other free text.

| Event | Sent by | When | `surface` | `source` | uuid key |
|---|---|---|---|---|---|
| `bounty_published` | `webhooks` | `checkout.session.completed` (payment mode, `fn_create_bounty_from_pending`) or setup mode (`fn_create_bounty_from_pending_deferred`) **created** the bounty. A replay (`created = false`) sends nothing | `web_checkout` | `webhooks` | `bounty_published:<bounty id>` |
| `bounty_published` | `poster-web` | the owner confirmed a post that was held for sign-in (`/held-posts/:id/confirm`, `fn_claim_pending_bounties` outcome `created`) | `web_checkout` | `poster-web` | `bounty_published:<bounty id>` |
| `application_accepted` | `poster-web` | `/requests/:id/accept` outcome `accepted`. `already_accepted` (a repeat click) and every failure send nothing | `web_poster_page` | `poster-web` | `application_accepted:<request id>` |
| `bounty_completed` | `poster-web` | `/bounties/:id/confirm-completion` and this call's guarded update moved the bounty to `completed`: the honor path, or `paid`. `payment_on_its_way`, a blocked payout, `no_submission`, "already complete" and failures send nothing | `web_poster_page` | `poster-web` | `bounty_completed:<bounty id>` |

Properties:

- `bounty_published`: `role: 'poster'`, `bounty_id`, `amount`, `category`,
  `funding_mode`, `surface`, `source`. The timestamp is `bounties.created_at`.
  The bounty row is read back before sending, so the event cannot exist
  without the row.
- `application_accepted`: the app's names (`hooks/useAcceptRequest.ts`):
  `role: 'poster'`, `bounty_id`, `application_id` (= `bounty_requests.id`),
  `hunter_id`, `is_for_honor`, `amount`, plus `surface` and `source`. The app's
  selection-quality properties (`hunterVerified`, `applicantCount`, …) are
  not sent.
- `bounty_completed`: `bounty_id`, `amount`, `isForHonor`, `via: 'web_confirm'`,
  `surface`, `source`. The timestamp is the `completed_at` the update wrote.

Reading them:

- **No filter is needed to count these events.** The app never sends a
  `source` on `bounty_published`, `application_accepted` or `bounty_completed`,
  and never sends these surfaces, so web and app events do not overlap.
  To split by surface: `source IN ('webhooks', 'poster-web')` is the web, and an
  unset `source` is the app.
- The held-post `bounty_published` has the same uuid key as the webhook one,
  so a bounty can never count twice across the two sources.
- The web diagnostics stay as they were: `web_applicant_decision_completed`,
  `web_completion_confirmed`, `web_held_post_decision`. They sit next to the
  canonical events the way `AUTH_LOGIN_SUCCESS` sits next to `user_logged_in`.
  Funnels use the canonical names.
- **`app_env` on every server `capture()`** (poster-web, email-inbound,
  geocode-bounties, webhooks) was hard-coded to `production` until this
  change. Staging sends are now `staging`. Production is unchanged: the server
  `signup_completed`, which uses the same resolver, has reported `production`
  on prod since 2026-10-20.
- `bounty_events.source` reads `app` for web-created bounties. That is not
  the surface: `trg_bounty_events_from_bounties` writes the literal `'app'` for
  every INSERT. Use `pending_bounties.resulting_bounty_id` to find web posts in
  SQL.
- Not backfilled. Web posts and decisions before the deploy stay missing in
  PostHog.

---

# Server-side payout events — 2026-11-24

From the 2026-11-23 PostHog audit. PostHog had no event for a payout that
actually reached the hunter's bank, and `payout_failed` overcounted: on
2026-11-13 the ledger had 2 `payout.failed` rows and PostHog had 4
`payout_failed`.

**Dashboards count payouts from `source = 'stripe_webhook'` only.** The app's
`payout_initiated`, `payout_success` and `payout_failed` (no `source`) are a
tap, an API acceptance and a failed request. They measure the withdraw screen,
not money.

| Event | Sent by | When | `source` | uuid key |
|---|---|---|---|---|
| `payout_completed` | `webhooks` | `payout.paid`, and the matched withdrawal row is `completed` (this delivery promoted it, or another writer already had) | `stripe_webhook` | `payout_completed:<po id>` |
| `payout_failed` | `webhooks` | `payout.failed` / `payout.canceled` / `payout.closed`, and **this delivery** moved the withdrawal to failed. A duplicate, an already-refunded row and a payout matching no withdrawal send nothing | `stripe_webhook` | `payout_failed:<po id>` |

Rules as for the other server events: `distinct_id` is the hunter's Supabase
user id; the uuid is a UUIDv5 of the key above
(`supabase/functions/_shared/payout-events.ts`); the timestamp is fixed too
(the row's `completed_at`, or Stripe's `event.created` for a failure), because
PostHog only merges a resend with the same uuid on the same day; `app_env`
from `resolveAppEnv`. The key is the event name, not Stripe's event type, so
`payout.failed` followed by `payout.closed` cannot make two.

Properties: `role: 'hunter'`, `amount` (the ledger withdrawal amount, which is
what `bounty_events.amount` records), `currency`, `method` (`standard` |
`instant`), `payout_architecture` (`connect_native` | `legacy_transfer`),
`failure_code` (Stripe `payout.failure_code`; null on `payout_completed` and on
most cancellations), `outcome` on failures (`failed` | `canceled`),
`stripe_payout_id`, `transaction_id` (`wallet_transactions.id`),
`platform: 'server'`. No bank name, last4, account id or `failure_message`.

Reading them:

- **Not every ledger `payout.failed` has a `payout_failed`.** `bounty_events`
  writes `payout.<status>` on every withdrawal status change, from any
  function. A withdrawal that fails before Stripe creates a payout never
  reaches a payout webhook. Both 2026-11-13 failures were this kind: the
  platform balance was short (`balance_insufficient` at `transfer_create` in
  `/connect/transfer`), with no transfer and no payout. Those rows have
  `correlation_id` null; transfer failures and reversals carry a `tr_…` id.
  Their only PostHog trace is the client `payout_failed` with
  `code: 'platform_balance_insufficient'`.
- Rows completed by reconciliation or another writer get their
  `payout_completed` when Stripe's `payout.paid` arrives. `payout.manually_paid`
  (admin "settled outside Stripe") has no event.
- Not backfilled. Payouts before the deploy have no server event.
- Reconciliation: [`payout-reconciliation.sql`](payout-reconciliation.sql). It
  generates the PostHog query from the ledger rows and returns one line per
  `bounty_events` row with its count of matching PostHog events (distinct
  uuids, same user, same amount).

The client fix in the same change: a second Withdraw tap with the same
idempotency key gets the server's replay of the recorded row
(`duplicate: true`). When that row had failed, the screen logged a new
`payout_failed` (code `transfer_failed`, `stripeAttempted: true`) although
Stripe was not called again. That is how 2 failures became 4.
`classifyPayoutFailure` now returns `payout_rejected` for any replay, on both
`/connect/transfer` (`withdraw-with-bank-screen.tsx`) and the Connect-native
routes (`use-connect-payout.tsx`). The app's failure code is in `code`, not
`error_code`: the 11-13 events carried `platform_balance_insufficient`, and the
audit read the wrong property.

---

# Audit fixes — 2026-11-24

From the 2026-11-23 PostHog audit. Analytics only.

## `$screen` counts screens that settled (750 ms)

`lib/analytics/screen-tracking.ts` reports a screen only once it has been on
top for `SCREEN_SETTLE_MS` (750 ms). The event is stamped with the time the
screen appeared, and `seconds_on_previous_screen` runs from one reported
screen appearing to the next. A screen replaced sooner is never reported.

The audit's "same screen, same person, within 2 s" count (421 of 8,590
`$screen` events, 30 days) contained no double mounts. Read one by one, the
pairs were:

| Pattern | Pairs | What it was |
| --- | --- | --- |
| Tab bounce (A → B → A, all `tab`) | ~200 | Real swipes. The pager commits a tab when it comes to rest, so Home → Wallet → Home committed Wallet for 300–1,200 ms. |
| `onboarding_style` → `onboarding` → `onboarding_style` | ~85 | `useSegments()` reporting the onboarding index for under 100 ms during a `router.replace`. |
| `search` ↔ `profile_other` | ~88 | About 40 were `search` flashing under an open profile (under 500 ms); the rest were people opening a profile and going back. |
| Same uuid twice (Android) | ~43 | The SDK sending one event in two batches. PostHog skew-corrects each batch's `sent_at`, so the copies land 40–700 ms apart. |

Redirect gates (`home` = `app/index.tsx`, `onboarding` =
`app/onboarding/index.tsx`) were the largest group of short screens outside
those pairs: 651 of 962 `home` views lasted under 750 ms.

Effects of the change. Replaying the 30 days with a 750 ms window keeps about
75% of `$screen` events. What drops is almost all loaders, redirect gates and
tabs swiped through:
- `home` drops most;
- `wallet` loses about 30% (it sits between Home and Messages in the swipe
  order).

Compare `$screen` per screen across the release only with an annotation in
place.

Also changed: going Back from a pushed screen to the tab shell
(`app/tabs/bounty-app.tsx`) now reports the shell's current tab, with
`navigation_source = 'back'`. Before, nothing was reported until the next tab
switch, so paths showed `bounty_detail` → `messages` with the feed in between
missing.

## Not duplicates: `composer_opened` and `app_opened`

- **`composer_opened`.** 54 of its 56 "within 2 s" pairs had the person leave
  the Post tab in between. Leaving remounts the composer (step 1, a fresh
  funnel instance with its own `post_step_abandoned`), so a quick swipe away
  and back is a second real open. Requiring a 1 s stay would still leave 1.3%
  and drop a third of real opens, so it was not changed.
- **`app_opened`.** It is 0.31% on 2.1.4. 14 of the 17 recent Android pairs
  share a uuid: they are SDK resends, not a second startup. The
  `processStartupInitDone` guard (2026-09-25) holds.

**Count duplicates by uuid first.** PostHog merges same-uuid rows only
eventually, so raw `count()` includes resends. Views counted under the settle
rule carry `settle_ms = 750`. That is the only way to tell them from older
`$screen` events, since an OTA update keeps `$app_version`. `app_opened` and
`composer_opened` are limited to 2.1.3 and later, which have the 09-25
guard.

```sql
-- 2-second repeats, 7 days, resends removed
SELECT event, count() AS total, countIf(gap_ms <= 2000) AS repeats_2s,
       round(100 * countIf(gap_ms <= 2000) / count(), 2) AS pct
FROM (
  SELECT event,
         toUnixTimestamp64Milli(ts) - lagInFrame(toUnixTimestamp64Milli(ts), 1, 0)
           OVER (PARTITION BY event, pid, sn ORDER BY ts
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS gap_ms
  FROM (
    SELECT event, uuid, any(person_id) AS pid, min(timestamp) AS ts,
           any(coalesce(toString(properties.screen_name), '')) AS sn
    FROM events
    WHERE timestamp >= now() - INTERVAL 7 DAY
      AND (
        (event = '$screen' AND properties.settle_ms IS NOT NULL)
        OR (event IN ('app_opened', 'composer_opened')
            AND toString(properties.$app_version) IN ('2.1.3', '2.1.4', '2.1.5'))
      )
    GROUP BY event, uuid
  )
)
GROUP BY event
```

Extend the version list as new builds ship.

## Person properties: `lifetime_spend`, `lifetime_earnings`, `lifetime_gmv`

Sent by `enqueue_analytics_person_snapshot()` (server, `$set`), built from
`analytics_user_facts`. All three are written when a `release`
`wallet_transactions` row completes. Migration:
`20261124200000_lifetime_spend_earnings_person_properties.sql`.

| Property | Who | Amount per completed bounty | Sum across persons |
| --- | --- | --- | --- |
| `lifetime_spend` | poster (`COALESCE(poster_id, user_id)`) | escrowed gross | = GMV |
| `lifetime_earnings` | hunter (`accepted_by`) | the release row itself: what the hunter was paid, after the platform fee | = hunter payouts |
| `lifetime_gmv` | **both** poster and hunter | escrowed gross, to each | **Never sum.** Counts every bounty twice. |

`lifetime_gmv` is kept unchanged for history and existing insights. For
marketplace GMV, sum `lifetime_spend` or, better, sum `bounty_events` or
`wallet_transactions` in Supabase. For one person, `lifetime_gmv` is "gross
of the bounties this person was on either side of".

Gaps:
- A release whose bounty has no `accepted_by` (30 of 54 completed releases on
  2026-11-24, mostly internal) gives the hunter no `lifetime_earnings`, the
  same as `bounties_completed` and the hunter's `lifetime_gmv`.
- Historical releases are filled by `backfill_lifetime_split_facts(false)`,
  run once after a dry run.

## `role` and the behavioural "both" segment

`role` has two writers, and the last write wins:
- **Client.** `hooks/useCompleteOnboarding.ts` and
  `lib/services/role-inference-service.ts` write the declared role.
- **Server.** `enqueue_analytics_person_snapshot()` writes `both` when
  `bounties_posted > 0 AND bounties_claimed > 0`, `poster` or `hunter` from
  either count alone, and `profiles.primary_role` otherwise.

So `role` is mostly the declared role, with `both` mostly behavioural. Do
not use it as a segment. (Not changed.)

Behavioural segments:

- **Posted and was hired as a hunter:** `bounties_posted > 0` AND
  `bounties_claimed > 0`. `bounties_claimed` counts `bounty_requests` that
  reached `accepted`, not applications sent. On 2026-11-24 it matched 6
  external persons, the same 6 that have `role = both`.
- **Posted and applied** (applied at all, accepted or not): there is no
  person property. Use a behavioural cohort: performed `bounty_published` AND
  performed `application_submitted`, ever. On 2026-11-24 Supabase had 17
  external accounts that own a bounty and sent at least one application.
  Exclude internal accounts with cohort 473053 or `is_internal`.

## `user_id` only

Events from `analyticsService.trackEvent` carry `user_id` and no longer
`userId`. Before retiring it, these were checked on 2026-11-24 and none read
`userId` (or `user_id`):
- insights;
- cohorts;
- actions;
- feature flags;
- dashboards;
- destination (hog function) filters;
- workflows (hog flows);
- data-modeling views;
- experiments;
- notebooks;
- alerts.

A caller that still passes `userId` has it folded into `user_id`.
