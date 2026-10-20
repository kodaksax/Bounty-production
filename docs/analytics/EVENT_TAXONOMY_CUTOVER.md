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
- Included both `user_id` and `userId` on tracked events.

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

- **`accept_funding_started`** means the poster pressed "Confirm & hire" or
  started the payment sheet (`hooks/useAcceptFunding.ts`). It does not fire for
  opening the accept sheet. "Sheet shown, 0 started" means nobody pressed the
  button. It is not a naming mismatch.
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
