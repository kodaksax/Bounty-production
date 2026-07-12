# Notifications Feature Overview

This document is the single source of truth for **which notifications BOUNTYExpo
fires, when they fire, what they say, and how they are delivered**. It also
records the fix for the "submitted for review fires on payout" bug and lists the
known gaps where a notification is expected but does not (or did not) fire.

> Audience: engineers touching completion / payout / messaging flows, and anyone
> auditing why a notification did or did not arrive.

---

## 1. Delivery pipeline

There are two ways a notification reaches a user:

### A. Outbox path (in-app **and** push)

```
event ──▶ INSERT into public.notifications_outbox
              (recipients[], title, body, data, bounty_id)
                          │
                          ▼
        process-notification Edge Function (Supabase)
                          │
        ┌─────────────────┴──────────────────┐
        ▼                                     ▼
 INSERT one public.notifications      Expo Push API
 row per recipient (bell feed)        (device push, honoring
 — honoring notification_preferences   notification_preferences;
                                        dead tokens pruned from
                                        push_tokens via receipts)
```

Anything inserted into `notifications_outbox` becomes **both** an in-app bell
entry and a device push notification. `process-notification` checks each
recipient's `notification_preferences` before delivering, and prunes invalid
Expo push tokens using the push receipts.

Sources that use the outbox path:

- **Database triggers** on `messages`, `bounty_requests`, and `bounties`
  (see `supabase/migrations/20260322_serverless_notification_triggers.sql` and
  its follow-ups).
- **`lib/services/completion-service.ts`** – submission and approval events.
- **`api/server.js`** – REST bounty transitions (`accept`, `complete`).

### B. Direct path (in-app **only**)

Some client flows insert directly into `public.notifications`. These show up in
the bell feed but **do not** generate a device push notification. This path is
used only for in-app-only alerts that do not need to reach a user while the app
is closed.

> Rule of thumb: if a message must reach the user while the app is closed, it
> must go through `notifications_outbox` (path A), not `notifications` (path B).

### Push token persistence note

Client push-token registration POSTs to `${API_BASE_URL}/notifications/register-token`,
but in production `API_BASE_URL` resolves to Supabase Edge Functions (which has
no such route), so it 404s. This is a known quirk handled by graceful
degradation: the client falls back to a Supabase direct write in
`lib/services/notification-service.ts`, which is the real persistence path, so
the 404 has no user-facing impact (tokens still register). The `push_tokens`
owner column is `profile_id` (not `user_id`).

---

## 2. Notification catalog

| # | Event (when it fires) | Fired by | Recipient | Title | Body | `data.type` | Channels |
|---|---|---|---|---|---|---|---|
| 1 | A new chat message is sent | Trigger `handle_new_message_notification` on `messages` | All conversation participants except sender | `Message from {sender}` | first 100 chars of message | `message` | in-app + push |
| 2 | A hunter applies to a bounty | Trigger `handle_bounty_request_notification` (INSERT) on `bounty_requests` | Poster | `New Bounty Application` | `Someone applied to your bounty: {title}` | `application` | in-app + push |
| 3 | Poster accepts an application | Trigger `handle_bounty_request_notification` (UPDATE pending→accepted) | Hunter | `Bounty Accepted!` | `Your application for "{title}" was accepted` | `acceptance` | in-app + push |
| 4 | Bounty status changes (any status **except** `completed`) | Trigger `handle_bounty_status_notification` (Scenario B) on `bounties` | Accepted hunter (`accepted_by`) | `Bounty Update` | `Bounty "{title}" status is now: {status}` | `update` | in-app + push |
| 5 | **Hunter submits work for review** | `completion-service.ts` → `submitCompletion` | Poster | `Review Needed` | `A hunter has submitted their work on "{title}" for your review.` | `review_needed` | in-app + push |
| 6 | **Poster approves work / payout released** (Supabase-direct path) | `completion-service.ts` → `approveSubmission` | Hunter | `Work Approved! 🎉` | `Your work on "{title}" was approved. Payment is on its way.` | `completion` (`subtype: approval`) | in-app + push |
| 7 | Bounty completed via REST endpoint | `api/server.js` → `POST /api/bounties/:id/complete` | Hunter (`accepted_by`) | `Work Approved!` | `Your work on '{title}' has been approved.` | `completion` | in-app + push |
| 8 | Bounty accepted via REST endpoint | `api/server.js` → `notifyBountyParticipants('accept')` | Poster + all requesting hunters | `Bounty accepted` | `Bounty '{title}' moved to in-progress` | `acceptance` | in-app + push |
| 9 | Poster requests a revision | `completion-service.ts` → `requestRevision` | Hunter | `Revision Requested` | `The poster requested changes to "{title}". Check the feedback and resubmit.` | `completion` (`subtype: revision_requested`) | in-app + push |
| 10 | Poster approves work (asks hunter to rate) | `poster-review-modal.tsx` / `review-and-verify.tsx` `notifyFn` | Hunter | `Please rate the poster` | `Please rate your experience for "{title}".` | `completion` (`subtype: rating_prompt`) | in-app + push |

Notes:

- Rows **6** and **7** describe the *same* logical event ("poster approves the
  hunter's work") delivered by two different code paths. The production app uses
  the Supabase-direct path (row 6) because `bountyService.update` writes to
  Supabase directly; the REST `/complete` endpoint (row 7) is only used in
  API-mode deployments. See §4.
- Rows **9** and **10** are enqueued via `notifications_outbox`, so they deliver
  both an in-app bell entry and a device push (subject to the recipient's
  notification preferences).

---

## 3. The "submitted for review" timing bug (fixed)

**Symptom:** The poster received a *"Bounty has been submitted for review"* /
*"Review Needed"* notification at the moment they **approved / released payment**,
instead of when the **hunter submitted** their work.

**Root cause:** In the current status model, `bounties.status = 'completed'` is
the **approval** status (set when the poster marks the work done), not the
submission status. The original database trigger
`handle_bounty_status_notification` had a "Scenario A" that fired the
"Review Needed" notification whenever status transitioned to `completed` — i.e.
on approval — which is the wrong moment.

**Fix (already in the codebase):**

- `supabase/migrations/20260623_fix_bounty_status_notification_trigger.sql`
  removes Scenario A entirely. The trigger now only sends the generic
  "Bounty Update" notification (Scenario B) for non-`completed` transitions.
- The correct "Review Needed" notification is enqueued at **submission time** in
  `completion-service.ts` → `submitCompletion` (row 5 above).
- `api/server.js` `/complete` documents that the "submitted for review"
  notification fires earlier (at submission), and now only notifies the hunter
  that their work was **approved** (row 7).

---

## 4. Known gaps and fixes

The issue noted that "there are fewer notifications than there should be /
notifications don't always fire when they should." The audit found the following:

### 4.1 Approval notification on the production path (FIXED)

Because Scenario A was removed from the status trigger and the production
approval flow uses `bountyService.update` (Supabase-direct) rather than the REST
`/complete` endpoint, approving work produced no **dedicated** hunter-facing
notification on the production path — the "Work Approved!" push in `server.js`
(row 7) is only reached in API-mode. (The status trigger still fired a generic
"Bounty Update" on the `completed` transition, but hunters received no
celebratory or payment-confirmation message.)

**Fix:** `approveSubmission` now enqueues a `Work Approved! 🎉` notification to
the hunter via `notifications_outbox` (row 6). The trigger is additionally guarded
to skip the `completed` transition, so hunters receive exactly one dedicated
notification (not a generic update on top of the specific one). This is
best-effort: a failure to enqueue never rolls back the approval or payout.

### 4.2 Revision-requested and rating-prompt push (FIXED)

Rows 9 (revision requested) and 10 (rating prompt) previously inserted directly
into `notifications`, so they only appeared in the bell feed and never pushed to
a device — a hunter with the app closed was not alerted when a revision was
requested or when they were asked to rate. Both now enqueue via
`notifications_outbox`, so `process-notification` delivers an in-app bell entry
**and** a push (honoring the recipient's notification preferences).

### 4.3 Events that intentionally have no notification

- **Disputes:** Some dispute flows show a local `Alert` ("Your dispute has been
  submitted") but do not always create a persisted notification for the *other*
  party. Any change here touches the disputes/escrow domain and should be scoped
  with a human reviewer before implementation.
- **Payment failures / refunds:** Wallet/escrow failure paths are handled with
  in-context alerts. Adding user-facing notifications here touches payments and
  must go through human review per the repository's payments guardrails.

---

## 5. Where to change things

| You want to… | Edit |
|---|---|
| Change message/application/acceptance/status wording | The relevant trigger migration under `supabase/migrations/` (add a new migration; do not edit historical ones) |
| Change "Review Needed" (submission) wording | `lib/services/completion-service.ts` → `submitCompletion` |
| Change "Work Approved!" (approval) wording | `lib/services/completion-service.ts` → `approveSubmission` (Supabase path) and `api/server.js` `/complete` (REST path) — keep them consistent |
| Change revision / rating-prompt wording | `completion-service.ts` → `requestRevision`, `poster-review-modal.tsx`, `review-and-verify.tsx` |
| Change delivery / preferences / token pruning | `supabase/functions/process-notification/` |

> When adding a new notification that must reach users while the app is closed,
> insert into `notifications_outbox` (path A). Only use a direct `notifications`
> insert for in-app-only alerts.
