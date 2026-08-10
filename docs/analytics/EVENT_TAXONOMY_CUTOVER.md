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
