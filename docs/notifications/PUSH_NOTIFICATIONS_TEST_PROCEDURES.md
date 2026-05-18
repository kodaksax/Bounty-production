# Push Notifications – Test Procedures for Critical Events

This document defines the **manual + automated test procedures** required to verify push-notification delivery for every critical event in BOUNTYExpo. Use it before each release and after any change to `services/api/src/services/notification-service.ts`, `app/hooks/usePushNotifications.tsx`, `lib/services/notification-service.ts`, `lib/context/notification-context.tsx`, or related routes.

Related docs:
- [`NOTIFICATIONS_IMPLEMENTATION_SUMMARY.md`](./NOTIFICATIONS_IMPLEMENTATION_SUMMARY.md) – architecture
- [`NOTIFICATIONS_SETUP_GUIDE.md`](./NOTIFICATIONS_SETUP_GUIDE.md) – environment setup
- [`NOTIFICATIONS_INTEGRATION_GUIDE.md`](./NOTIFICATIONS_INTEGRATION_GUIDE.md) – how to wire new events
- [`PUSH_NOTIFICATION_TROUBLESHOOTING.md`](./PUSH_NOTIFICATION_TROUBLESHOOTING.md) – diagnosing failures
- [`PUSH_TOKEN_FIX_SUMMARY.md`](./PUSH_TOKEN_FIX_SUMMARY.md) – token-registration fixes

---

## 1. Critical Events Covered

Push notifications must fire for the following critical events. All are implemented in `services/api/src/services/notification-service.ts` via the `notify*` helpers and routed through the appropriate Android channel.

| # | Event                          | Helper                          | Recipient | Channel    | Trigger source                                            |
|---|--------------------------------|---------------------------------|-----------|------------|-----------------------------------------------------------|
| 1 | Bounty application received    | `notifyBountyApplication`       | Poster    | `bounties` | `consolidated-bounty-requests` create                     |
| 2 | Bounty request accepted        | `notifyBountyAcceptance`        | Hunter    | `bounties` | `consolidated-bounty-requests` accept, `bounty-service`   |
| 3 | Bounty request rejected        | `notifyBountyRejection`         | Hunter    | `bounties` | `consolidated-bounty-requests` reject                     |
| 4 | Bounty cancelled (refund)      | `notifyBountyCancellation`      | Hunter    | `bounties` | `refund-service`                                          |
| 5 | Bounty marked completed        | `notifyBountyCompletion`        | Poster    | `bounties` | `bounty-service`                                          |
| 6 | Bounty ready for review        | `notifyBountyReadyForReview`    | Poster    | `bounties` | `services/api/src/index.ts` review flow                   |
| 7 | Submission approved            | `notifyBountyApproved`          | Hunter    | `bounties` | `services/api/src/index.ts` approval flow                 |
| 8 | Revision requested             | `notifyRevisionRequest`         | Hunter    | `bounties` | `services/api/src/index.ts` revision flow                 |
| 9 | Bounty stale                   | `notifyBountyStale`             | Poster    | `bounties` | `stale-bounty-service`                                    |
|10 | Stale bounty cancelled         | `notifyStaleBountyCancelled`    | Poster    | `bounties` | `stale-bounty-service`                                    |
|11 | Stale bounty reposted          | `notifyStaleBountyReposted`     | Poster    | `bounties` | `stale-bounty-service`                                    |
|12 | Escrow released (payment)      | `notifyPayment`                 | Hunter    | `payments` | `completion-release-service`                              |
|13 | Payout paid                    | `notifyPayoutPaid`              | Hunter    | `payments` | `consolidated-webhooks` (Stripe `payout.paid`)            |
|14 | Payout failed                  | `notifyPayoutFailed`            | Hunter    | `payments` | `consolidated-webhooks` (Stripe `payout.failed`)          |
|15 | New chat message               | `sendMessageNotification`       | Recipient | `messages` | `routes/messaging.ts` (debounced 5 s per sender/conv)     |
|16 | New follower                   | `notifyFollow`                  | Followed  | `default`  | follow endpoint                                           |

Any new critical event added later **must** also be added to this table and given a test case in §4.

---

## 2. Pre-Test Setup

Push notifications cannot be received in iOS simulators. Use a **physical iOS device** and a **physical or emulated Android device** (Android emulators support FCM).

### 2.1 Environment

1. Backend API running and reachable from the device:
   - `cd services/api && pnpm dev` (or `npm run dev:api`)
   - Verify `EXPO_PUBLIC_API_BASE_URL` in `.env` points to your machine's LAN IP, not `localhost`.
2. Supabase running with notifications + push_tokens tables migrated:
   ```bash
   psql $DATABASE_URL < services/api/migrations/20251103_add_notifications_tables.sql
   ```
3. Expo dev build installed on the device (`expo-notifications` requires a dev or production build, not Expo Go on SDK 53+):
   ```bash
   eas build --profile development --platform ios
   eas build --profile development --platform android
   ```
4. EAS project ID is set in `app.json` / `app.config.js` (`extra.eas.projectId`) so `Notifications.getExpoPushTokenAsync({ projectId })` succeeds.
5. For iOS: APNs key uploaded in EAS (`eas credentials`).
6. For Android: FCM `google-services.json` configured and uploaded.

### 2.2 Test Accounts

Create at least two test accounts (Poster and Hunter) on the same backend. Sign in to each on a **separate physical device** so notifications can be observed independently.

### 2.3 Pre-flight Verification

Before any test case, confirm the foundation works:

1. **Permissions:** First launch → no automatic OS prompt (contextual opt-in by design). After the first bounty post or chat send, the OS prompt must appear once.
2. **Token registration:** With the app foregrounded and signed in, run:
   ```sql
   SELECT user_id, token, device_id, updated_at
   FROM push_tokens
   ORDER BY updated_at DESC
   LIMIT 5;
   ```
   The signed-in user must have a fresh row whose `token` starts with `ExponentPushToken[`.
3. **Channels (Android only):** Settings → Apps → BOUNTYExpo → Notifications must show four channels: **Messages**, **Bounties**, **Payments**, **System**.
4. **Direct push smoke test:**
   ```bash
   cd services/api
   TEST_EXPO_TOKEN=ExponentPushToken[xxx] pnpm exec tsx scripts/test-send-push-direct.ts
   ```
   A "Test Push from BountyExpo" banner must appear on the device within ~5 s. If it doesn't, **stop and fix transport before running any other case** (see §6).
5. **End-to-end smoke test:**
   ```bash
   node scripts/test-notifications.js
   ```
   This picks the latest active token, writes an in-app notification row, and sends a push. Both must succeed.

Only proceed once steps 1–5 all pass.

---

## 3. Notification Preferences

Each event respects `notification_preferences`. Before testing an event, make sure the corresponding category is enabled for the recipient:

- `messages_enabled`
- `bounties_enabled` (applications, acceptance, rejection, completion, cancellation, stale, review, revision, approval)
- `payments_enabled` (payment release, payouts)
- `follows_enabled`

Toggle from the in-app **Settings → Notifications** screen (`components/settings/notifications-center-screen.tsx`) or via:
```sql
UPDATE notification_preferences
SET messages_enabled = true, bounties_enabled = true,
    payments_enabled = true, follows_enabled = true
WHERE user_id = '<recipient_uuid>';
```

For each test case below, also run **one negative variant** with the corresponding category disabled and confirm no push arrives but the in-app notification row is still created (silent in-app, no push is the contract).

---

## 4. Manual Test Cases

For every case, capture:
- ✅/❌ banner appearance on locked screen
- ✅/❌ banner appearance with app backgrounded
- ✅/❌ in-app `NotificationsBell` badge increments
- ✅/❌ tap opens the correct deep-link target
- ✅/❌ Android delivered on the **correct channel**
- ✅/❌ `notifications` row inserted in DB

### Case 1 – Bounty Application Received
**Pre:** Hunter app foregrounded, Poster app **backgrounded** with screen off.
1. Hunter opens an open bounty and submits an application.
2. Within ~5 s the Poster receives a push on the **Bounties** channel: title contains "New application", body contains the bounty title.
3. Tap → deep link opens the bounty's applicants list.

### Case 2 – Bounty Request Accepted
**Pre:** Poster has at least one pending request; Hunter app **backgrounded**.
1. Poster taps **Accept** on the Hunter's request.
2. Hunter receives a push on **Bounties**: "Your request was accepted".
3. Other pending Hunters on the same bounty receive a **rejection** push (Case 3).
4. Tap → opens the bounty detail / chat.

### Case 3 – Bounty Request Rejected
Validated as a side effect of Case 2, and explicitly:
1. Poster opens applicants list and taps **Reject** on a specific request.
2. That Hunter receives a push on **Bounties**: "Your request was not selected".

### Case 4 – Bounty Cancelled (Refund Path)
**Pre:** Bounty has an accepted Hunter and escrow funded.
1. Poster cancels the bounty (path that invokes `refund-service`).
2. Hunter receives a push on **Bounties** and an in-app notification.
3. Hunter's wallet shows the released escrow (separate test, but the push must mention cancellation, not payment).

### Case 5 – Bounty Marked Completed
1. Hunter marks the bounty completed (or completion is auto-triggered).
2. Poster receives a push on **Bounties**: "Bounty completed".

### Case 6 – Bounty Ready for Review
1. Hunter submits work for review.
2. Poster receives a push on **Bounties**: "Submission ready for review".
3. Tap → opens the review screen.

### Case 7 – Submission Approved
1. Poster approves the submission.
2. Hunter receives a push on **Bounties**: "Your submission was approved".
3. Immediately followed by **Case 12** (payment release) – both pushes must arrive; they may be coalesced visually but both `notifications` rows must exist.

### Case 8 – Revision Requested
1. Poster requests a revision with feedback text.
2. Hunter receives a push on **Bounties** whose body contains a snippet of the feedback.
3. Tap → opens the submission screen with the feedback visible.

### Case 9 – Bounty Stale
1. Manually invoke the stale-bounty job (or wait for the scheduled run):
   ```bash
   cd services/api && pnpm exec tsx -e "import('./src/services/stale-bounty-service').then(m => m.runStaleBountyCheck())"
   ```
2. Poster of any stale bounty receives a push on **Bounties**: "Your bounty is going stale".

### Case 10 – Stale Bounty Cancelled (auto-cancel)
1. Run the stale job past the auto-cancel threshold.
2. Poster receives "Your stale bounty was cancelled and refunded".

### Case 11 – Stale Bounty Reposted
1. Run the stale job with auto-repost enabled.
2. Poster receives "Your bounty was reposted".

### Case 12 – Escrow Released (Payment)
1. Trigger completion-release for an in-progress bounty (Case 7 or `completion-release-service.releaseEscrow(bountyId)`).
2. Hunter receives a push on the **Payments** channel: title contains "Payment received", body includes the amount.
3. Tap → opens Wallet → transaction detail.

### Case 13 – Payout Paid (Stripe webhook)
**Pre:** Hunter has connected Stripe account and a pending payout.
1. In Stripe CLI / dashboard, trigger `payout.paid`:
   ```bash
   stripe trigger payout.paid
   ```
2. Hunter receives a push on **Payments**: "Payout sent to your bank".

### Case 14 – Payout Failed
1. Trigger `payout.failed`:
   ```bash
   stripe trigger payout.failed
   ```
2. Hunter receives a push on **Payments** with the failure reason (e.g. "Your payout failed: account_closed"). The body must contain the Stripe `failure_message` or `failure_code`.

### Case 15 – New Chat Message
1. Both devices signed in, recipient app **backgrounded**.
2. Sender posts a message in a 1:1 conversation.
3. Recipient receives a push on **Messages** within ~5–6 s (5 s debounce window).
4. Send three more messages from the same sender within the debounce window. The recipient must receive **one coalesced push** (e.g. "4 new messages from <name>") rather than four, per `MESSAGE_DEBOUNCE_MS` in `notification-service.ts`.
5. Tap → opens the conversation thread.
6. With recipient **foregrounded inside the same conversation**, no push or banner is shown but the message is delivered in-thread (verify by Realtime).

### Case 16 – New Follower
1. User A follows User B.
2. User B receives a push on the **default** channel: "<A> followed you".

---

## 5. Automated Tests

### 5.1 Unit (Jest)

Run on every PR:

```bash
# Frontend notification service
npx jest __tests__/unit/services/notification-service.test.ts

# Backend notification service
pnpm --filter @bountyexpo/api test -- notification-service.test.ts

# Completion-release notification side effect
pnpm --filter @bountyexpo/api test -- completion-release-service.test.ts

# Refund-service notification side effect
pnpm --filter @bountyexpo/api test -- refund-service.test.ts
```

Coverage requirements when changing the notification service:
- Each `notify*` helper has at least one test asserting (a) a row is inserted into `notifications`, (b) `sendPushNotification` is called with the expected channel/type, and (c) when the user's preference for that category is `false`, no push is sent but the row still exists.

### 5.2 Integration smoke (manual but scripted)

```bash
# End-to-end via the latest registered token
node scripts/test-notifications.js

# Direct Expo push transport
TEST_EXPO_TOKEN=ExponentPushToken[xxx] \
  pnpm --filter @bountyexpo/api exec tsx scripts/test-send-push-direct.ts
```

### 5.3 Phase verification

```bash
pnpm --filter @bountyexpo/api exec tsx src/test-phase4-verification.ts
```

This sweeps a synthetic flow (application → accept → message → complete → payout) and asserts that the expected number of `notifications` rows are created per step.

### 5.4 Required gates before release

1. `npx tsc --noEmit` clean.
2. `npm run test:unit` green.
3. `pnpm --filter @bountyexpo/api test` green.
4. Manual cases 1, 2, 12, 13, 14, 15 (the trust-critical four: acceptance, payment, payouts, message) all ✅ on **both iOS and Android** physical devices.
5. Sign-off matrix (§7) attached to the release ticket.

---

## 6. Failure Triage

If any case fails, walk this ladder before filing a bug:

1. **No push but in-app row exists** → recipient's push token is missing/stale or `expo-server-sdk` chunk failed. Check `push_tokens` row and the backend logs around `sendPushNotification`. See [PUSH_NOTIFICATION_TROUBLESHOOTING.md](./PUSH_NOTIFICATION_TROUBLESHOOTING.md).
2. **No push and no in-app row** → upstream caller never invoked the `notify*` helper. Grep `services/api/src` for the helper name and confirm the trigger path is reached.
3. **Push on wrong Android channel** → `getAndroidChannelId` mapping in `notification-service.ts` is stale for the new type, or `setupAndroidChannels` in `usePushNotifications.tsx` is missing the channel. Both must agree.
4. **Push fires when preference is disabled** → `isNotificationEnabled` is not awaited or the new type is not mapped to a preference column. Add the mapping.
5. **Duplicate message pushes** → `MESSAGE_DEBOUNCE_MS` debounce in `notification-service.ts` is bypassed; verify the cache key `${recipientId}:${senderId}:${conversationId}` is being computed identically across requests.
6. **iOS works, Android silent (or vice-versa)** → credentials / channel config issue. Re-run `eas credentials` and reinstall the dev build.
7. **Stripe-driven payout pushes missing** → `consolidated-webhooks` not receiving the event. Verify Stripe webhook signing secret and that `stripe listen --forward-to <api>/webhooks/stripe` is running in dev.

---

## 7. Per-Release Sign-Off Matrix

Copy this block into the release ticket and fill it out per device.

```
Tester: ____________________  Date: __________  Build: ____________

Device A (iOS, model/version): ____________________
Device B (Android, model/version): ____________________

Pre-flight                                  iOS    Android
  Permissions prompt on contextual moment   [ ]    [ ]
  Token persisted in push_tokens            [ ]    [ ]
  Direct push smoke (test-send-push-direct) [ ]    [ ]
  e2e smoke (scripts/test-notifications.js) [ ]    [ ]
  Android channels present                  n/a    [ ]

Critical events                             iOS    Android
   1 Application received                   [ ]    [ ]
   2 Request accepted                       [ ]    [ ]
   3 Request rejected                       [ ]    [ ]
   4 Bounty cancelled                       [ ]    [ ]
   5 Bounty completed                       [ ]    [ ]
   6 Ready for review                       [ ]    [ ]
   7 Submission approved                    [ ]    [ ]
   8 Revision requested                     [ ]    [ ]
   9 Bounty stale                           [ ]    [ ]
  10 Stale cancelled                        [ ]    [ ]
  11 Stale reposted                         [ ]    [ ]
  12 Payment received                       [ ]    [ ]
  13 Payout paid                            [ ]    [ ]
  14 Payout failed                          [ ]    [ ]
  15 New chat message (single)              [ ]    [ ]
  15 Chat message debounce (4→1 push)       [ ]    [ ]
  16 New follower                           [ ]    [ ]

Preferences negative tests                  iOS    Android
  bounties_enabled=false suppresses push    [ ]    [ ]
  messages_enabled=false suppresses push    [ ]    [ ]
  payments_enabled=false suppresses push    [ ]    [ ]
  In-app row still created when disabled    [ ]    [ ]

Tap-through (deep links)                    iOS    Android
  Application → applicants list             [ ]    [ ]
  Acceptance → bounty/chat                  [ ]    [ ]
  Payment → wallet detail                   [ ]    [ ]
  Message → conversation                    [ ]    [ ]

Sign-off: ______________________
```

A release is **not** push-notification-ready until this matrix is fully checked.
