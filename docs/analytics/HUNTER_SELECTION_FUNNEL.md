# Hunter-Selection Funnel Instrumentation

Date: 2026-09-14

Goal: measure whether trust signals (ID verification, completion history, self-reported
skills, pitch text) actually change a poster's applicant → accept decision, and where in
the applicant-review flow posters drop off. This does **not** assume an answer — see
"What NOT to conclude yet" at the bottom.

## Taxonomy audit (done before writing any code)

Per event required by this work, here's what already existed vs. what was missing.
Everything marked "reused" fires exactly as spec'd already and was left untouched —
no redundant event was created for it.

| Required event | Status before this change | Action taken |
|---|---|---|
| `applicant_list_viewed` | Did not exist | **Added** |
| `profile_viewed` | Declared in the `AnalyticsEvent` type since an earlier cutover, but **no call site anywhere in the app ever fired it** | **Wired up** (was a dead type) |
| `application_declined` | Did not exist (`useRejectRequest.ts` had zero analytics) | **Added** |
| `application_accepted` | Fired already (role, bounty_id, application_id, hunter_id, is_for_honor, amount) | **Extended** with the 6 requested properties |
| `trust_requirement_set` | Fired already from `useBountyPublish.ts` | Reused, no change |
| `trust_requirement_blocked_apply` | Fired already from `app/bounty/[id]/public.tsx` | Reused, no change |
| `verification_started_from_requirement` | Fired already from `app/bounty/[id]/public.tsx` | Reused, no change |
| `rating_prompt_shown` / `rating_submitted` / `rating_skipped` / `review_submitted` | All fire already from `review-and-verify.tsx` and `poster-review-modal.tsx` | Reused, no change |
| `skill_added` / `skill_removed` | Fire already from `skillset-edit-screen.tsx` | Reused, no change |
| `pitch_started` / `pitch_submitted` | Fire already from `app/bounty/[id]/public.tsx` | Reused, no change |
| `portfolio_item_added` / `portfolio_item_viewed` | Fire already from `enhanced-profile-section.tsx` | Reused, no change |

The trust-tier system, ratings loop, and capability events (skills/pitch/portfolio) were
all built in the same-day commit `c58f0e93`, immediately before this work — that's why
the audit found them already wired. Only the applicant-list and profile-view side of the
funnel, plus the decline path, had real gaps.

## Event inventory

### 1. `applicant_list_viewed`

**Fires:** `hooks/useApplicantListViewed.ts`, used by both `app/tabs/inbox-screen.tsx`
and the legacy `app/tabs/postings-screen.tsx` Requests tab (both render the same
`bountyRequests`-backed list — see the "still reachable from moments" note in
`analytics-service.ts`).

**Why it's not simply "on screen mount":** the Requests tab is a single flat list of
pending applications across *all* of a poster's open bounties, not grouped or scoped to
one bounty on screen. So "viewed" is computed per distinct bounty represented in the
currently-visible list. It fires once per bounty the first time its applicant pool is
shown, and again only if that bounty's `(applicantCount, verifiedCount, trustTier)`
signature actually changes (a new application arrived while the tab was open) — a
re-render never refires it.

```json
{
  "bountyId": "b_123",
  "applicantCount": 4,
  "verifiedCount": 1,
  "trustTier": "animal_care"
}
```

### 2. `profile_viewed`

**Fires:** `app/profile/[userId].tsx`, once per successfully-loaded profile per mount
(guarded with a ref so re-renders — e.g. a follow toggle — can't refire it).

Two call sites in the hunter-selection surface now pass explicit context:
- `components/applicant-card.tsx` → `source: 'applicant_card'`, `isApplicant: true`
- `app/postings/[bountyId]/index.tsx` ("View profile" on the accepted hunter) →
  `source: 'bounty_dashboard'`, `isApplicant: false`

Every other existing navigation to `/profile/[userId]` (search results, messenger,
chat, bounty cards, notification deep links, followers/following) was left untouched —
those views land with `source: 'unknown'`. Extending all of them was out of scope for
this funnel; do that as a follow-up if "profile view" needs to be a fully general metric
rather than specifically the hunter-selection one.

```json
{
  "source": "applicant_card",
  "isApplicant": true,
  "bountyId": "b_123",
  "hunterId": "u_456"
}
```

`hunterId` is only set when `isApplicant` is true — it's an opaque UUID (not PII), but is
omitted for ordinary profile visits where "hunter" framing doesn't apply, per the
existing privacy convention (`bounty_search` never carries raw query text, etc.).

### 3. `application_declined`

**Fires:** `hooks/useRejectRequest.ts`, after the request row is actually deleted.

```json
{
  "bountyId": "b_123",
  "hunterId": "u_789",
  "trustTier": "standard"
}
```

`reason` is deliberately never included. The decline confirmation
(`components/applicant-card.tsx`'s `handleReject`) is a plain Cancel/Decline `Alert` with
no reason picker, so there is no genuine reason to attach — inventing one was explicitly
ruled out by the brief. Add the property only if a real reason-capture UI ships.

### 4. `application_accepted` (extended)

**Fires:** `hooks/useAcceptRequest.ts`, unchanged trigger point (right after the server
confirms the open → in_progress transition), now carrying 6 additional properties.

```json
{
  "role": "poster",
  "bounty_id": "b_123",
  "application_id": "r_1",
  "hunter_id": "u_456",
  "is_for_honor": false,
  "amount": 40,
  "hunterVerified": false,
  "hunterCompleted": 3,
  "hadMessage": true,
  "trustTier": "animal_care",
  "applicantCount": 4,
  "profileViewedBeforeAccept": true
}
```

- `hunterVerified` — same `deriveCoarseVerificationStatus` helper `applicant-card.tsx`
  already uses (stripe_identity_status, with the legacy column as fallback).
- `hunterCompleted` — `request.profile.hunterCompleted`, already computed server-side
  per applicant by `bountyRequestService`.
- `hadMessage` — whether the application carried pitch text (`request.message`).
- `trustTier` — the bounty's `trust_tier` column, `'standard'` when unset.
- `applicantCount` — the bounty's pending-applicant count, snapshotted *before* the
  optimistic UI empties the list (see the comment in `useAcceptRequest.ts`).
- `profileViewedBeforeAccept` — **session-scoped**, not lifetime. Backed by a new
  module-level `Set` in `lib/analytics/sessionFlags.ts`
  (`markApplicantProfileViewed` / `wasApplicantProfileViewed`), keyed by
  `${bountyId}:${hunterId}`. Plain component state doesn't survive here — Inbox/Postings
  screens unmount when the tab loses focus (tracked separately as issue #779), and the
  profile screen is a full navigation away. A module-level flag is the same pattern
  already used for `bounty_list_viewed`'s "first of session" property.

## Existing event conflicts found

None beyond the one already noted above (`profile_viewed` declared-but-dead). No
duplicate or near-duplicate event names were found for anything in the required list —
this is why the "reused" rows above outnumber the "added" ones.

## Mobile/web compatibility

There is only one client in this repo (the Expo React Native app; `Platform.OS` is
attached to every event). No separate web analytics implementation exists — the
`services/api/src/routes/analytics.ts` HTTP routes are disabled admin-dashboard stubs,
not a second event taxonomy. Nothing to reconcile.

## PII check

No email, phone, name, message text, or precise location is attached to any new or
extended event. IDs (`bountyId`, `hunterId`, `application_id`) are opaque UUIDs, the same
class of identifier already used throughout `application_accepted`,
`applicant_question_opened`, etc.

---

## Core metric queries

These are written as HogQL against the PostHog `events` table (adjust `project_id`
scoping as needed in the PostHog UI, or run via Insights using the equivalent
funnel/trend builder — the HogQL is given because it's exact and copy-pasteable).
**None of these have been run against live data** — `applicant_list_viewed`,
`profile_viewed`, and `application_declined` did not exist before this change, so there
is no history to query yet. Run these after the app build carrying this change has been
live for a representative window.

### 1. Applicant → acceptance rate

```sql
SELECT
  countIf(event = 'application_submitted') AS applications,
  countIf(event = 'application_accepted') AS accepted,
  accepted / nullif(applications, 0) AS accept_rate
FROM events
WHERE event IN ('application_submitted', 'application_accepted')
  AND timestamp > now() - INTERVAL 30 DAY
```

### 2. Acceptance rate by trust tier

```sql
SELECT
  properties.trustTier AS trust_tier,
  countIf(event = 'application_declined') AS declined,
  countIf(event = 'application_accepted') AS accepted,
  accepted / nullif(accepted + declined, 0) AS accept_rate
FROM events
WHERE event IN ('application_accepted', 'application_declined')
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY trust_tier
ORDER BY accept_rate DESC
```

### 3. % of bounties with applicants that never accept anyone

```sql
WITH bounties_with_applicants AS (
  SELECT DISTINCT properties.bountyId AS bounty_id
  FROM events
  WHERE event = 'applicant_list_viewed'
    AND timestamp > now() - INTERVAL 30 DAY
),
bounties_with_accept AS (
  SELECT DISTINCT properties.bounty_id AS bounty_id
  FROM events
  WHERE event = 'application_accepted'
    AND timestamp > now() - INTERVAL 30 DAY
)
SELECT
  count(*) AS bounties_with_applicants,
  countIf(b.bounty_id NOT IN (SELECT bounty_id FROM bounties_with_accept)) AS never_accepted,
  never_accepted / nullif(bounties_with_applicants, 0) AS never_accept_rate
FROM bounties_with_applicants b
```

Note the property name mismatch between events — `applicant_list_viewed` uses
`bountyId`, `application_accepted` uses `bounty_id` (matching each event's existing
convention, not renamed here to avoid an unrelated breaking change). Any query joining
the two must account for this.

### 4. Time to first acceptance

```sql
SELECT
  properties.bounty_id AS bounty_id,
  min(timestamp) AS first_accept_time,
  dateDiff('hour', bounty_posted.published_at, min(timestamp)) AS hours_to_accept
FROM events
JOIN (
  SELECT properties.bountyId AS bounty_id, min(timestamp) AS published_at
  FROM events
  WHERE event = 'bounty_published'
  GROUP BY bounty_id
) bounty_posted ON bounty_posted.bounty_id = events.properties.bounty_id
WHERE event = 'application_accepted'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY bounty_id, bounty_posted.published_at
```

Simpler alternative if a PostHog Funnel is preferred over raw HogQL: Funnel
`bounty_published → application_accepted`, breakdown by none, with "conversion window"
set generously (e.g. 30 days) and reading the step's median/average time-to-convert
directly from the funnel UI.

### 5. Profile views per acceptance

```sql
SELECT
  countIf(event = 'profile_viewed' AND properties.isApplicant = true) AS applicant_profile_views,
  countIf(event = 'application_accepted') AS accepted,
  applicant_profile_views / nullif(accepted, 0) AS views_per_acceptance
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
```

### 6. Acceptance rate: verified vs unverified

```sql
SELECT
  properties.hunterVerified AS verified,
  count(*) AS accepted
FROM events
WHERE event = 'application_accepted'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY verified
```

This gives raw accepted counts by verification status, not a true rate, because the
denominator (applications submitted by verified vs. unverified hunters) isn't captured
on `application_submitted` today — that event doesn't carry the applicant's verification
status. **To get a real rate, `application_submitted` needs a `hunterVerified` property
added** (same helper `useAcceptRequest.ts` now uses). Flagging as a follow-up rather than
adding it speculatively here, since it touches the hunter-side apply flow, not the
poster-side selection flow this task scoped in.

### 7. Acceptance rate: hunter with history vs new hunter

```sql
SELECT
  properties.hunterCompleted > 0 AS has_history,
  count(*) AS accepted
FROM events
WHERE event = 'application_accepted'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY has_history
```

Same caveat as #6 — this is accepted-hunter composition, not yet a true rate without a
matching property on `application_submitted`.

### 8. Acceptance rate: application with pitch vs without pitch

```sql
SELECT
  properties.hadMessage AS had_pitch,
  count(*) AS accepted
FROM events
WHERE event = 'application_accepted'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY had_pitch
```

Same caveat again — `application_submitted` would need a `hadPitch` property for a true
conversion rate rather than accepted-population composition.

### 9. Rating coverage: ratings / completed approvals

```sql
SELECT
  countIf(event = 'bounty_completed') AS completed,
  countIf(event = 'rating_submitted') AS rated,
  rated / nullif(completed, 0) AS rating_coverage
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
```

### 10. ID verification start rate after requirement

```sql
SELECT
  countIf(event = 'trust_requirement_blocked_apply') AS blocked,
  countIf(event = 'verification_started_from_requirement') AS started,
  started / nullif(blocked, 0) AS start_rate
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
```

### 11. Applicant card → profile view rate

```sql
SELECT
  countIf(event = 'applicant_list_viewed') AS lists_viewed,
  countIf(event = 'profile_viewed' AND properties.source = 'applicant_card') AS card_profile_views,
  card_profile_views / nullif(lists_viewed, 0) AS view_rate
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
```

Better as a PostHog Funnel: `applicant_list_viewed → profile_viewed` filtered to
`source = 'applicant_card'`, since a funnel naturally handles per-person/per-session
ordering that a flat count ratio doesn't.

### 12. Profile view → acceptance rate

```sql
SELECT
  countIf(event = 'profile_viewed' AND properties.isApplicant = true) AS applicant_profile_views,
  countIf(event = 'application_accepted' AND properties.profileViewedBeforeAccept = true) AS accepted_after_view,
  accepted_after_view / nullif(applicant_profile_views, 0) AS view_to_accept_rate
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
```

`application_accepted.profileViewedBeforeAccept` is the more precise signal for this
metric than joining `profile_viewed` and `application_accepted` on person + bountyId,
since it's computed at accept-time directly from the same-session view flag.

## Recommended PostHog funnels (to build in the UI, not HogQL)

1. **Selection funnel:** `applicant_list_viewed → profile_viewed (source=applicant_card) → application_accepted`, breakdown by `trustTier`. This is the funnel the whole brief exists to build.
2. **Decline funnel:** `applicant_list_viewed → application_declined`, breakdown by `trustTier`, to see whether high-risk tiers decline verified vs. unverified applicants at different rates.
3. **Trust-requirement funnel:** `trust_requirement_set → trust_requirement_blocked_apply → verification_started_from_requirement`, to see how much of the requirement's friction actually converts to a verification attempt vs. just blocking hunters outright.
4. **Ratings-coverage funnel:** `bounty_completed → rating_prompt_shown → rating_submitted`, to see where the post-completion loop drops off (prompt not shown vs. shown-but-skipped).
5. **Capability-to-hire funnel (exploratory, not requested but adjacent):** `skill_added OR pitch_submitted OR portfolio_item_added → application_submitted → application_accepted`, person-level, to see whether investing in the capability layer precedes getting hired more often — again, don't read this as causal without an actual experiment.

## What NOT to conclude yet

No data exists yet for `applicant_list_viewed`, `profile_viewed`, or
`application_declined` — they didn't fire before this change. `application_accepted`'s
new properties only appear on acceptances going forward. None of the "verified hunters
convert better" / "complete profiles get hired 3x more often" style claims can be
supported until:

1. This build ships and accumulates a real sample.
2. Metrics #6–#8 get the matching `application_submitted` properties noted above, so
   they're true conversion rates rather than accepted-population composition.
3. Ideally, an actual experiment (holding trust tier or verification requirement
   constant and varying something) is run — correlation from these funnels alone
   establishes association, not that verification *causes* better conversion.
