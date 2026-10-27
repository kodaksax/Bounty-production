# ADR 0002 — Native Phone / FaceTime Calling: Deferred

**Status:** **Accepted** 2026-10-27 — deferred, no code shipped.
**Date:** 2026-10-27
**Supersedes:** nothing.
**Related:** [off-platform-risk.ts](../../lib/utils/off-platform-risk.ts),
[trust-safety.ts](../../lib/strings/trust-safety.ts),
[phone-verification-service.ts](../../lib/services/phone-verification-service.ts),
[20260719020500_revoke_sensitive_profile_columns_select.sql](../../supabase/migrations/20260719020500_revoke_sensitive_profile_columns_select.sql),
[20260918032000_enforce_bounty_contact_info_policy.sql](../../supabase/migrations/20260918032000_enforce_bounty_contact_info_policy.sql)

---

## 1. Context

A brief asked for poster ↔ accepted-hunter coordination through native phone calls, FaceTime on
Apple devices, and the closest Android equivalent. The audit found two things that decide the
question before any platform detail matters.

### 1.1 There is nothing to dial

Production, 2026-10-27, external (`is_internal = false`) accounts only:

| Measure | Count |
|---|---|
| Profiles | 1,041 |
| `profiles.phone_verified = true` | **0** |
| `auth.users.phone_confirmed_at` set | **0** |
| `profiles.phone` non-empty (unverified, legacy) | 27 |
| New phone numbers in the last 60 days | 0 |
| Bounties ever with an accepted hunter | 8 |
| Bounties in progress right now | 2 |

`phone-verification-service.ts` exists but no screen calls it. No confirmed phone ever reached
`auth.users`, which suggests the SMS provider was never set up in production. That is unverified:
check the Supabase Auth → Phone settings before relying on it.

### 1.2 Calling contradicts the trust model

Bounty actively keeps communication on the platform:

- `detectOffPlatformRisk` flags "call me", "text me", "my phone number" and raw numbers in chat
  (`app/tabs/chat-detail-screen.tsx`), the hunter work-in-progress screen, profile edit and the
  composer.
- The DB trigger `fn_bounties_enforce_posting_policy` rejects phone numbers in bounty title and
  description.
- User-facing copy: *"Keep this job on Bounty. Don't share contact details to move communication,
  agreements, or payment elsewhere."*
- `profiles.phone` is withheld from the `authenticated` column grant.

A native handoff can't keep numbers private. The recipient's carrier shows the caller's number,
and a FaceTime call shows the caller's Apple ID. A call also leaves no record for the 72h review
window or a dispute. The 2026-09 fraud ring (self-dealing poster/hunter pairs) is the kind of
activity the on-platform rule exists to make visible.

## 2. Decision

**Don't build phone or FaceTime calling now.** Nothing in the app changes. This record keeps the
audit so the work can start from here if we revisit it.

## 3. When to revisit

Reopen this decision only if at least one of these is observed in data, not assumed:

1. Support tickets, reports or chat abandonment show that coordination is failing *because* chat
   is not enough. For example, in-person bounties where the parties couldn't find each other.
2. There are enough in-progress bounties that a coordination feature would reach people. Today
   there are 2 in progress and 8 have ever had an accepted hunter.
3. A product decision deliberately relaxes "keep communication on Bounty" for accepted pairs,
   with a privacy and ToS review.

## 4. Platform facts (verified against public behaviour, 2026-10-27)

### iOS
- `Linking.openURL('tel:+1…')` opens the system dialer. iOS shows its own confirmation prompt
  before it dials. It needs no permissions and no Info.plist entry.
- `facetime:<phone-or-apple-id-email>` and `facetime-audio:<…>` are documented Apple URL schemes.
  They need the recipient's FaceTime identifier, which is a phone number or Apple ID email.
  Bounty can't embed FaceTime, read call state, know whether a call was answered, or create a
  FaceTime link programmatically. Users create `facetime.apple.com/join` links themselves in the
  FaceTime app. Since iOS 15 those links open in a browser on Android and Windows.
- `Linking.canOpenURL` for `tel`/`facetime` needs `LSApplicationQueriesSchemes` in Info.plist.
  That changes the Expo fingerprint and so **requires a new native build**. The OTA-safe pattern
  is to call `openURL` directly and treat a rejected promise as "unavailable".
- The iOS Simulator can't place `tel:` or FaceTime calls. Verifying this needs a physical
  device.

### Android
- `tel:` through `Linking.openURL` sends `ACTION_DIAL`, which needs no `CALL_PHONE` permission.
  `canOpenURL` on API 30+ needs a `<queries>` manifest entry, which means a native build. Skip it,
  as on iOS.
- There is **no standard video-call intent** reachable through `Linking`. Carrier video calling
  (IMS / `EXTRA_START_CALL_WITH_VIDEO_STATE`) needs intent extras through a native module (for
  example `expo-intent-launcher`, which is not installed) and depends on the carrier. The honest
  Android answer for video is "not available — use Message or Call".
- FaceTime doesn't exist on Android. An Android user can only *join* a FaceTime link that an
  Apple user sends.

### Users can already do this
A user can paste a FaceTime link into Bounty chat today. `detectOffPlatformRisk` treats a
`facetime.apple.com` URL as a reference link and doesn't warn. Typing a phone number does trigger
the contact warning. That is the current, intended behaviour.

## 5. Options if revisited

| Option | Numbers exposed | Audit trail | Cost | Build impact |
|---|---|---|---|---|
| A. Consent-based native handoff | Yes, to the consenting counterpart | None | SMS for verification | JS + migration (OTA-safe if no `canOpenURL`) |
| B. Masked calling via a telephony proxy (e.g. Twilio Proxy/Voice) | No | Call metadata, optional | Per-minute + per-number, recurring | Edge function + vendor; JS client (OTA-safe) |
| C. In-app WebRTC / calling SDK | No | Yes | SDK fees or TURN infra | New native modules, CallKit/ConnectionService, mic/camera permissions — **new build** |

**Recommended next step if reopened: B.** It is the only option that adds calling without
exposing numbers or losing the audit trail, and it works the same on iOS and Android. A and C
should need a concrete justification over B.

### 5.1 Design sketch for option A (kept so it isn't re-derived)

- **Prerequisite:** a phone-verification UI on top of `phone-verification-service.ts`, and a
  production SMS provider confirmed working (see §1.1).
- **Consent table** `bounty_contact_consents`: `bounty_id`, `actor_id` (the user who is
  sharing), `recipient_id`, `channel` (`phone` | `facetime`), `granted_at`, `revoked_at`.
  Unique on (`bounty_id`, `actor_id`, `channel`). RLS: the actor can insert and revoke their own
  rows; the actor and recipient can read rows. Index on (`bounty_id`, `recipient_id`).
- **Reveal** happens only through a `SECURITY DEFINER` RPC `get_bounty_contact(p_bounty_id)`. It
  checks that `auth.uid()` is the poster or `accepted_by`, that the bounty is `in_progress` (not
  completed, cancelled or disputed), that the counterpart has a live consent row, and that the
  counterpart's phone is verified. It returns only the counterpart's number. `REVOKE EXECUTE …
  FROM anon` explicitly (see the anon EXECUTE grant gotcha). Never expose numbers through a view
  or a column grant.
- **Applicants** get no access. Only the poster and the accepted hunter.
- **UI:** Call / FaceTime (iOS only) / Message on `app/in-progress/[bountyId]/…`, below the
  primary action. Name the recipient and the bounty, add a "You're leaving Bounty" note, and
  disable the buttons while a launch is in flight.
- **Analytics:** `audio_call_initiated` and `video_call_initiated` mean *handoff attempted*, never
  "call connected". Use `call_handoff_failed` when `openURL` rejects. Only `bounty_id` and the
  role go in properties, never numbers or identifiers. Check the canonical taxonomy first.
- **Safety copy and detectors** stay as they are. Consented numbers are delivered by the RPC,
  never through chat text.

## 6. Policy implications if any option ships

- Privacy policy: phone number collection, the purpose (coordinating a specific bounty), and
  disclosure to the counterpart with consent (option A) or processing by a telephony provider
  (option B).
- ToS / trust copy: `trustSafetyStrings.contactRequest` and `general` currently say not to move
  communication off Bounty. They would need to explain the sanctioned channel.
- App Store privacy label and Play Data Safety: add "Phone number — collected, linked to user,
  shared with other users (A) / a service provider (B)".
