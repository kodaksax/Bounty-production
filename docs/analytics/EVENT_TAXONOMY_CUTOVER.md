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
| `onboarding_role_selected` | `role_selected` | `app/onboarding/welcome.tsx` |
| `user_signed_up` | `signup_completed` | `app/auth/sign-up-form.tsx` |
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
