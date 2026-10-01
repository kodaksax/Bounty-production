# Bounty Trust Spine Audit — 2026-09-30

**Question:** could a skeptical first-time user reasonably feel safe completing a $100 transaction with a stranger through Bounty?

**Answer today: no.** Several of the strongest trust promises Bounty makes are not true in the backend, and the live marketplace currently exposes hunters to scams that Bounty itself amplifies.

**Method:** read-only queries against production (`xwlwqzzphmmhghiqvkeu`, 2026-09-30 → 10-01), source on `main` @ `3fd015d0`, and a Shoal swarm against a fresh staging web export (§14). Nothing was changed in production. Findings marked *definition-verified* were confirmed from live policy/grant/trigger definitions but deliberately **not exercised** on prod; each needs a staging reproduction before the fix ships.

Scale context (prod, external accounts only, `is_internal = false`): 795 profiles, 25 posters ever, 46 bounties, 3 completed, last external completion 2026-09-12. In the last 30 days, 167 hunters filed **352 applications → 1 acceptance**.

---

## 1. Executive summary

Bounty's trust *presentation* has improved a lot since mid-September. The applicant card shows real ID status and history, profiles render reviews and hunter-completed counts, fees are accurate (5%, hunter side), ToS §7 no longer says "no refunds", and the post-escrow terms freeze is enforced in the database.

The trust *mechanics* under that presentation have seven critical failures:

1. **Bounty pushes scams to hunters.** In the last 21 days, all 7 "still looking" escalations that reached 25+ hunters were scams. The 8th, a real bounty, reached 1 hunter. A payment-proxy scam posted 09-29 was pushed to 60 hunters, has 18 applicants and 3 unreviewed fraud reports, and is still live.
2. **The scam scanner can't see the dominant scam pattern.** `moderation_scan_content` has no rule for "pay for an order / complete a purchase / explain in the DMs". That listing produced zero signals.
3. **Home addresses are exposed despite the promise.** "Use current location" saves the reverse-geocoded street address into `bounties.location`. The feed card, detail modal, public page and profile history render that field to everyone, and every signed-in account can SELECT `latitude`/`longitude` at 7-decimal (~1 cm) precision. The welcome screen says "never an address".
4. **Escrow isn't committed to the hunter.** `POST /wallet/refund` lets the poster refund 100% at any time: after a hunter is accepted, after work is submitted, during a dispute. A refunded bounty can never be released. Posters can also PATCH `accepted_by`/`status` on their own funded bounty.
5. **Anyone can open and "resolve" a dispute on any bounty** (*definition-verified*). The dispute INSERT policy only checks `initiator_id = auth.uid()`, the initiator can UPDATE every column including `status`, and a SECURITY DEFINER cascade then cancels the bounty (or marks it completed) and rejects (or approves) the hunter's submission.
6. **A hunter who did the work has no path to payment if the poster goes quiet.** There is no approval deadline, auto-release or escalation. A real hunter's $5 submission has been pending since 2026-08-18 (43 days). Their screen says "nothing to do until then".
7. **A poster whose hunter goes quiet has no working path either.** Cancel says only the hunter can cancel and to "open a dispute"; the dispute screen requires a cancellation request posters can no longer file, so it shows "Dispute information not found". Found by Shoal, confirmed in code.

The common thread: **trust is enforced in the client and promised in copy, but the server allows the opposite.** Most of these fixes are small, server-side, and reach every user immediately, which matters because client OTA updates are currently blocked (§3, T11).

The highest-leverage *non-software* move: for the next ~50 transactions, a human (founder) reviews every first-time poster's bounty before it reaches the feed or any push, and personally shepherds every hire → completion → release. At ~1 new external poster per day this is roughly 30 minutes a day (§9).

---

## 2. Trust spine map

Legend: ✅ creates trust and is enforced · ⚠️ partial / UI-only · ❌ destroys trust or contradicts a promise

| Stage | What creates trust today | What destroys trust | Enforced by backend? |
|---|---|---|---|
| Discovery / welcome | Escrow + "Require ID" + address rows on the trust slide; `how-it-works` page; ToS §7 fixed | ❌ Proof slide shows example requests stamped **COMPLETED · paid out 2h ago · 4.9 ✓** with literal brackets (`[$90]`, `[Dana]`); ❌ "never an address" is false; ❌ `bountyfinder.app` fails TLS | Address claim: ❌ |
| Signup / identity | Stripe Identity exists (48 verified); email confirm | Poster ID verification 0/17 recent posters; phone verified 0/809 | ID-required gate on applications: ✅ trigger. Poster identity: none |
| Profile | Real reviews, hunter-completed, "Joined" date, earned-only ID badge | Hunter can't rate poster (0 rows ever); ratings forgeable (T7) | Ratings integrity: ❌ |
| Posting | Clear fee/escrow copy on StepPay; amount locked once applications exist | Quick-pick chips publish title-only bounties; trust-tier detection never ran in prod; address leak | Tier: client-only ⚠️ |
| Browsing (hunter) | Earnings card shows gross → fee → net | "Posted 2h ago" hard-coded on every bounty; no poster signals on the detail modal; 0/18 open external bounties funded and no way to tell; scams top the feed and get pushed | ❌ |
| Selecting a hunter | Applicant card: earned ID badge, "N bounties done · ★x (n)", pitch, high-risk "Not ID-verified" row | Rating figures are forgeable; high-risk row never fires (tier never set) | ⚠️ |
| Acceptance / escrow | Accept confirmation states the charge and release rule; `fn_accept_bounty_request` reserves escrow atomically; funding-before-work trigger | Poster can later refund, re-assign or cancel via API | ⚠️ |
| Communication | Blocking enforced in messaging RPCs; off-platform disclaimer | No detection of phone numbers / payment requests in chat; scams route to DMs | ⚠️ |
| Work / completion | Submission + evidence; poster notified (trigger) | No approval deadline; hunter told "nothing to do" indefinitely | ❌ |
| Approval / release | `authorizeRelease` derives payee from `accepted_by`; idempotent ledger RPCs | Poster can refund instead of release, at any time | ❌ |
| Dispute | Dispute UI promises review "within 24-48 hours" | Self-resolvable by any user (T5); money moves client-side, best-effort (dispute #19 "hunter wins", $1 never released); real resolution took 14 days | ❌ |
| Payout | Two-hop payout + reconciliation; `payout.*` webhooks arrived through 09-17 | 5 withdrawals ($76.40) shown `completed` while `stripe_pending` since 08-28 | ⚠️ |
| Rating / review | Poster→hunter loop, rating never blocks payment | Forgeable, editable, deletable; no hunter→poster | ❌ |
| Repeat usage | — | Last external completion 09-12; 1 acceptance in 30 days | — |

---

## 3. Top trust failures (evidence)

### P0 — Critical

**T1. Liquidity escalation amplifies scams.**
- *Evidence:* `notifications` "still looking" fan-out, last 21 days, recipients by bounty: `0b9e1e8a` 60 (live scam), `2f98b41e` 59, `c1c869bb` 40, `68bc744d` 25, `d97dd373` 60, `22dd1d10` 59, `4554d92a` 59 (all scams; 5 later `bounty_moderation.state='removed'`), plus `1bf6eaeb` 59 (title now NULL). The one legitimate escalation (`11af999b` "Run to the store") reached 1. `pg_get_functiondef('fn_escalate_stale_bounty_liquidity')` contains no reference to moderation, signals, reports or account status.
- *Why it destroys trust:* the platform's own push notification vouches for the scam. A hunter who gets burned blames Bounty, not the scammer.
- *Mechanism:* escalation targets unclaimed bounties, and scams are what stays unclaimed (first flagged 2026-09-19; still unfixed).

**T2. The scanner misses the payment-proxy family, and reports don't act.**
- *Evidence:* live `0b9e1e8a` "I need someone to help complete an online purchase… pay for a birthday gift order on bommergifts… I can explain further in the dms." Created 09-29 by an account that joined 09-29. 0 `moderation_signals`, no `bounty_moderation` row, 18 applicants. `moderation_scan_content` patterns: `dm me|dm for|dm to|direct message me|…`. None match "send a direct message", "in the dms", "complete an online purchase" or "pay for … order". Three `reports` (reason `fraud`, 09-29) are `pending`, unreviewed, and nothing auto-hides on reports.
- The rule families that separated 6/6 scams from 0 real listings were identified on 2026-09-25 (off-platform contact, details-in-image, employment/recurring pay, payment/identity proxy) and never added.

**T3. Exact address exposure contradicts the privacy promise.**
- *Promise:* `lib/strings/welcomeCarousel.ts` trust row "Hunters see a neighbourhood and a rating — never an address". `StepWhere.tsx:273` "Only your neighborhood is shown publicly. Your exact address isn't shared until you accept someone."
- *Reality:* `StepWhere.tsx:113` stores `location: detail?.formattedAddress` on "Use current location". `location` is in `FEED_SAFE_BOUNTY_COLUMNS` (`lib/services/bounty-service.ts:24`) and rendered raw in `components/bounty-card.tsx:255`, `components/bountydetailmodal.tsx:822`, `app/bounty/[id]/public.tsx:536` and `components/profile-bounty-history-section.tsx:84`. Column privileges: `authenticated` has SELECT on `location, latitude, longitude, geom`. The code comment at `bounty-service.ts:15` says these are "only ever readable via `get_bounty_exact_location()`", but the grants don't enforce that.
- *Prod:* 9 bounties carry ≥4-decimal coordinates and 4 carry street-number addresses (e.g. "#### Painters Mill Road, Owings Mills, MD"), 3 of them on live bounties. Small only because few bounties have a location. Making "Where" a required step (planned) will multiply it.
- *Why P0:* a stranger learning where the poster lives is the single worst safety outcome for a local-services marketplace, and the app explicitly promised otherwise.

**T4. Escrow is not committed to the hunter.**
- `supabase/functions/wallet/index.ts:776-825`: `/wallet/refund` authorizes `isOwner` with **no state check**: not `accepted_by`, not a pending `completion_submissions` row, not an open dispute. The only guard is "no prior release/refund", so after a refund, `/release` returns 409 forever.
- The UI only offers refund on unaccepted bounties (`postings-screen.tsx:693`, `inbox-screen.tsx:584`), which is exactly the "UI implies a guarantee the backend doesn't enforce" pattern. The design intent (`20260908020000_hunter_only_cancellation_requests.sql`: "once a hunter is on the clock the poster's route is a dispute") is contradicted by the edge function.
- RLS `bounties_update_own` / `Owners can update their own bounties` have no column restriction. `fn_bounties_enforce_funding_before_work` *allows* changing `accepted_by` once funded, and allows `status → cancelled` at any time. A poster can swap in another account after the work is done and release to it.
- Hunter-facing copy (`components/ui/hunter-earnings-card.tsx:85`): "The poster's money is held in escrow before you start, and released to your wallet when they approve the work." It is held, but it isn't protected.

**T5. Dispute self-resolution and third-party griefing** (*definition-verified*).
- Live policies on `bounty_disputes`: `Participants insert` WITH CHECK `auth.uid() = initiator_id` (no participation check; permissive, so it ORs away the stricter `Bounty participants can create workflow disputes`). `Initiator update` USING/WITH CHECK `auth.uid() = initiator_id`. Column grants give `authenticated` UPDATE on every column including `status`, `winner`, `resolution`, `resolved_by`, `hold_amount`. Both policies come from `supabase/migrations/20260715i_sync_rls_policies_across_environments.sql:280,297`, which superseded `20260303_admin_only_dispute_updates.sql`.
- `trg_fn_cascade_dispute_resolution` (SECURITY DEFINER, AFTER UPDATE): `resolved_poster_wins` → bounty `cancelled`, submission `rejected`; `resolved_hunter_wins` → bounty `completed`, submission `approved` (which also increments `hunter_completed` in `get_profile_activity_stats`).
- Consequence: any signed-in user can cancel any open or in-progress bounty and reject a hunter's work, or a hunter can mark their own job complete and inflate their record. Money doesn't move by trigger, but state, reputation and the hunter's submission do.

**T6. No protection when the poster goes silent after submission.**
- *Evidence:* external bounty `eccfddee` "Take photos" ($5, escrowed): submission `pending since 2026-08-18`. No `auto_release` / `auto_approve` logic exists anywhere in `supabase/`, `lib/`, `app/` or `services/`. `app/in-progress/[bountyId]/hunter/payout.tsx:322`: "Your work is with the poster for review. You'll be notified as soon as they approve it — nothing to do until then."
- *Why P0:* "Will I actually get paid?" is the hunter's first question, and the honest answer today is "only if the poster chooses to act".

**T22. A poster whose hunter vanishes has no working recourse.** *(Shoal `abandonment-recovery`, 2/3 agents; confirmed in code.)*
- The posting card's **Cancel** leads to `app/bounty/[id]/cancel.tsx:250` "Not available here — only the hunter working on a bounty can request its cancellation… open a dispute so support can settle the escrow". **Open a dispute** (`app/postings/[bountyId]/index.tsx:244`, `components/my-posting-expandable.tsx:993,997`) routes to `app/bounty/[id]/dispute.tsx`, which renders "Dispute information not found" whenever no cancellation request exists (`:240`). Since `20260908020000_hunter_only_cancellation_requests.sql`, posters can never file one, so this path is dead for every poster. **Contact Support** is a `mailto:` (`cancel.tsx:152`).
- Net effect: the app tells the poster their route is a dispute, then offers no way to open one. (The same poster *can* refund through the API, T4.) The two sides' failures mirror each other: neither party has a working path when the other goes silent.

### P1 — Major

**T7. Ratings are forgeable.** Prod `ratings` has only PK and FKs: no unique (bounty, from, to) (the `ratings_bounty_from_to_uidx` from `20260914150000` exists on staging only), no `CHECK (rating BETWEEN 1 AND 5)`, and INSERT requires only `auth.uid() = from_user_id`. `ratings_update_rater` / `ratings_delete_rater` are live. 4 of 9 prod ratings have no completed bounty pairing rater and ratee. Three fake 5-star rows clear `MIN_RATING_SAMPLE` and render "★5.0 (3)" on the applicant card.

**T8. "Posted 2h ago" is hard-coded** on the bounty detail modal used by every feed variant (`components/bountydetailmodal.tsx:754`, since Nov 2025). June bounties and the 09-29 scam both read "2h ago".

**T9. Welcome proof slide presents examples as completed, paid, rated, verified jobs.** `ProofMockCard` (`components/onboarding/WelcomeCarousel.tsx:412-450`) stamps every example with `COMPLETED`, `paid out 2h ago`, `4.9` and a verified icon. The bracket convention in `lib/strings/welcomeCarousel.ts` renders literally ("[$90]", "[Dana]"), so the card reads as a broken template *and* as a claim.

**T10. Hunters apply into silence and can't judge poster legitimacy.** 352 applications → 1 acceptance in 30 days; 85 pending, averaging 12.6 days. The bounty detail modal and public page show only the username ("Posted by … / Anonymous"): no join date, ID status, poster history, or whether money is funded. 0 of 18 open external bounties are funded (all `at_accept`), and nothing tells the hunter that.

**T11. Trust controls ship but never reach devices.** Trust-tier detection (`lib/utils/trust-tier.ts`, StepPay, merged 09-20) has never classified a single prod bounty: 0 rows with a non-`standard` tier, including "Walk my dog" (which matches `trust-tier.ts:81`) and "Cut my hair at my place". `requires_id_verified` has been used 0 times. Client OTA is blocked (Android fingerprint guardrail). Any trust feature that lives only in the client is currently inert.

**T12. Suspended accounts can still post.** The duplicate permissive policy `bounties_insert_own` (no `is_account_active`) is still live (found 09-25). 3 of the 4 fraud-ring profiles (`78c972ad`, `6fdeb6f5`, `4a8e12c4`) are `active`.

**T13. Dispute money movement is client-orchestrated and best-effort.** `lib/services/dispute-service.ts:545-790` updates status first (cascade fires), then attempts release/refund from the admin's device, logging failures only. Prod dispute #19: `resolved_hunter_wins`, escrow $1, no release row. Dispute #23 took 14 days against a promised "24-48 hours" (`components/workflow-dispute-modal.tsx:242`).

**T14. Posters are anonymous to hunters.** 0 of 17 posters active in the last 30 days are ID-verified; 9/17 have an avatar; 5/17 an "about". ID verification is presented only as hunter payout KYC.

**T23. Unearned badges on other people's profiles read as claims.** *(Shoal `poster-review` 2/3, `abandonment-recovery` 1/3.)* `components/ui/milestone-badge-chips.tsx:78-85` renders unearned milestones with a padlock, and `app/profile/[userId].tsx:623` shows them on every profile. A poster evaluating a stranger with "Jobs Completed 0" sees "5 Bounties Completed · Top Rated · First Bounty Posted", while the applicant card says "New to Bounty". The milestone input is also the *poster* count (`bounties_completed`) on a hunter's profile. Fix: on other users' profiles render earned badges only, and feed hunter milestones from `hunter_completed`.

**T24. "1 review" that can't be read.** *(Shoal, 2 scenarios.)* `components/recent-reviews-section.tsx:57` hides star-only ratings, so the header counts a review the page never shows. Show star-only ratings with date and bounty title.

**T25. Posters are pushed into Stripe payout setup at signup.** *(Shoal `trust-audit` 2/3.)* `app/onboarding/payouts.tsx:1-8` routes both roles to Connect onboarding right after role selection ("a poster's refunds … leave the wallet through the same Stripe Connect account"). To a skeptical payer this reads as "hand over bank details before you've posted anything", and the skip link is visually de-emphasized. Move payout setup to the first moment it's needed (first withdrawal or refund-to-bank).

**T15. `bountyfinder.app` fails TLS** (curl exit 35; AASA unreachable) while `app.json` declares it for associated domains and intent filters. Shared links look broken or unsafe.

### P2 — Meaningful

- **T16** Quick-pick chips (`app/screens/CreateBounty/quick/StepTask.tsx:38-45`) publish title-only bounties. "Hold my spot in the merch line" is live 6× and "Take lecture notes for me" 2×, all with empty descriptions. One account posted 4 test bounties in 3 minutes. The feed reads as fake.
- **T17** 5 withdrawals ($76.40, oldest 08-28) are `status='completed'`, `settlement_state='stripe_pending'`. The hunter sees "completed" before Stripe confirms.
- **T18** Chat shows a static off-platform disclaimer but detects nothing (phone numbers, Cash App, "pay me first").
- **T19** Hunter→poster ratings: 0 ever; no client screen exists for the existing "rate the poster" notification.
- **T20** On the hunter review screen, adding evidence is locked while a dispute is open (`app/in-progress/[bountyId]/hunter/review-and-verify.tsx:566-581`). Disputes are when evidence matters most. (Check whether `app/dispute/[disputeId].tsx` accepts evidence before treating this as a gap.)
- **T21** No `report_submitted` analytics event, and no report SLA or alert.

### What works — don't rebuild

Applicant card trust UI (`components/applicant-card.tsx`) with real ID status and `hunter_completed`. Profile screen reviews, join date, earned-only chips. `authorizeRelease` (payee derived from `accepted_by`). Escrow terms freeze. `enforce_bounty_request_id_requirement` trigger. Accept-confirmation copy. Accurate 5% fee everywhere. Moderation sweep running every 10 minutes (760 runs). Reports now insert (3 rows). Blocking enforced in messaging.

---

## 4. Top 10 trust improvements

Ranked by trust impact × exposure × frequency × severity ÷ complexity. Server-side fixes rank higher because they reach every user while OTA is blocked.

### 1. Gate liquidity escalation and nearby pushes on trust (T1)
- **Problem / evidence:** §3 T1. 7/7 high-reach pushes were scams.
- **Why users distrust:** Bounty's own notification sends them to a scam.
- **Solution:** in `fn_escalate_stale_bounty_liquidity` (and the radius/zip/service-area notify triggers), only escalate when **all** hold: `bounty_moderation` absent or `approved`; zero `moderation_signals`; zero pending `reports` on the bounty or poster; poster `account_status='active'`; and (poster has ≥1 completed transaction OR poster is ID-verified OR the bounty is funded OR the bounty was human-approved, see §9). Write a skip reason to the escalation log so suppression is observable.
- **Files:** new migration replacing `fn_escalate_stale_bounty_liquidity`; `fn_notify_radius_matched_bounty`, `fn_notify_zip_matched_bounty`, `fn_notify_service_area_matched_bounty`.
- **Backend:** one migration. **Frontend:** none. **DB/payment:** none.
- **Complexity:** < 1 day.
- **Test:** BEGIN/ROLLBACK on staging with fixtures: unsignaled funded bounty escalates; signaled, reported, new-poster or suspended-poster bounties don't. Replay against the 7 prod scam IDs; all must be suppressed.
- **Measure:** share of escalation recipients whose bounty is later `removed` (target 0); hunter apply rate on escalated bounties.

### 2. Scam rules + report-driven auto-hide (T2)
- **Solution:** add the four rule families to `moderation_scan_content` (written against the 09-25 corpus, then checked against all 60-day non-internal listings for false positives):
  - off-platform contact: `direct message|in the dms?|\bdms?\b|text me|call me|signal|whatsapp|telegram|cash ?app|zelle|venmo`
  - payment/identity proxy: `(complete|make|help with) (an? )?(online )?(purchase|payment|order)|pay for (a|an|my|the) .*order|gift card|kyc|verify (my|your) (account|identity)`
  - employment/recurring: `\$\d+ ?(/|per) ?(hr|hour|week)|weekly|part[- ]time|hiring|data entry`
  - details elsewhere: `see (attached|image|photo)|details in (the )?(pic|image)`
  
  Weight payment-proxy at ≥5 so it auto-flags (hidden from feed and escalation, queued for review). Add `trg_reports_autohide`: ≥2 distinct reporters on a bounty, or ≥1 report on a poster <7 days old → `bounty_moderation.state='under_review'`, out of feed, admin push.
- **Today, manually:** remove `0b9e1e8a`, review the 3 reports, message its 18 applicants (concierge, §9).
- **Files:** new migration redefining `moderation_scan_content`, new trigger on `reports`; `app/admin/reports.tsx` (SLA badge).
- **Complexity:** 1 day.
- **Test:** run the scanner over all historical removed bounties (recall) and all completed external bounties (false positives; target 0).
- **Measure:** time from post to hidden for scams; scam applications per week; reports → action latency.

### 3. Make escrow a commitment: lock refunds and assignments server-side (T4)
- **Solution:**
  - `/wallet/refund`: allow the owner only when `accepted_by IS NULL` and status ∈ (`open`, `draft`). Otherwise require an `accepted` hunter-filed cancellation (existing path) or an admin/dispute resolution. Return `409 refund_requires_cancellation_or_dispute`.
  - New BEFORE UPDATE trigger on `bounties`: when the caller is not `service_role` (check `auth.role()`), reject changes to `status`, `accepted_by`, `accepted_request_id`, `funding_mode`, `completed_at` on any bounty that has an accepted hunter or escrow. All transitions go through the existing SECURITY DEFINER RPCs (accept, cancellation, completion approval), which set a bypass GUC the same way `app.bypass_profile_guard` already works.
- **Files:** `supabase/functions/wallet/index.ts:776-825`; new migration; tests in `supabase/functions/wallet/*.test.ts` and `__tests__`.
- **Payment implication:** closes the only path where a hunter can do funded work and receive nothing without a dispute.
- **Complexity:** 1–2 days (the trigger needs care: inventory every legitimate client-side `bounties` UPDATE first; `grep -rn "from('bounties').update"`).
- **Test:** staging: accept → submit → owner `/refund` must 409; owner PATCH `accepted_by` must fail; the full happy path and hunter-cancellation path still pass; replay `__tests__` money suites.
- **Measure:** refunds on bounties that had an accepted hunter without a cancellation or dispute (target 0).

### 4. Close dispute RLS (T5)
- **Solution:** drop `Participants insert`, `Initiator update`, `Initiator delete` and the broken `Admin manage` (uses `auth.jwt()->>'role'`, never true). Keep `Bounty participants can create workflow disputes` for INSERT, restricted to `status='open'`. Revoke UPDATE/DELETE from `authenticated` and `anon` on `bounty_disputes`. Evidence additions go through an RPC that appends to `evidence_json` for participants only; status changes go through `admin_resolve_dispute` (item 7).
- **Complexity:** < 1 day + staging reproduction first (insert a dispute as a non-participant, update status, observe cascade; then apply and confirm both fail).
- **Measure:** dispute status changes whose `log_dispute_audit` actor is not an admin (target 0).

### 5. Stop exposing addresses (T3)
- **Solution:**
  - DB: move exact data to `bounty_private_locations(bounty_id, address, unit, latitude, longitude)` with RLS poster + accepted hunter only (or keep columns and `REVOKE SELECT (location, latitude, longitude, geom, unit) ON bounties FROM authenticated, anon`, re-granting a safe `location_label`). Backfill `location` → `neighborhood`/city for all existing rows via a reversible migration with a dry-run count.
  - Client: StepWhere writes the formatted address only to the private store; cards, modal, public page and profile history render `neighborhood` (fallback: city). `get_bounty_exact_location()` stays the only path to the address, shown to the accepted hunter.
- **Files:** `app/screens/CreateBounty/quick/StepWhere.tsx`, `app/services/bountyService.ts:235,448`, `lib/services/bounty-service.ts:24`, `components/bounty-card.tsx:251-255`, `components/bountydetailmodal.tsx:818-822`, `app/bounty/[id]/public.tsx:530-536`, `components/profile-bounty-history-section.tsx`, new migration.
- **Note:** the REVOKE must ship before or with the client change; old clients would then fail on `select('*')`. Grep for `select('*')` on `bounties` first.
- **Complexity:** 2–3 days.
- **Measure:** bounties whose public `location` matches `^\d+\s` (target 0); `get_bounty_exact_location` calls by non-participants (target 0).

### 6. Deadlines and a working recourse path for both sides (T6, T22)
- **Poster side (ship first, < 1 day):** make "Open a dispute" create a workflow dispute directly. `components/workflow-dispute-modal.tsx` already exists; `app/bounty/[id]/dispute.tsx` must stop requiring a cancellation request. Add a "Hunter hasn't responded" reason that, for a bounty with no submission after N hours past the scheduled start (or 72h after acceptance when unscheduled), lands in the same founder queue as below. Replace the dead-end Cancel button on in-progress postings with "Report a problem".

**Hunter side — approval deadline with human escalation, then auto-release (T6):**
- **Solution, phase A (now):** a 72-hour review window starting at `completion_submissions.submitted_at`. Cron `fn_escalate_overdue_completions` (clone `fn_remind_pending_hunter_ratings`): 24h and 48h poster reminders (push + email fallback already exists); at 72h insert an ops-queue row and alert the founder, who contacts the poster and decides (§9). Hunter screen shows the deadline: "The poster has until Fri 3:00 pm to approve or raise a problem. If they don't respond, Bounty reviews it." Poster screen shows the same countdown.
- **Phase B (after ~20 observed escalations):** at 72h with no revision request or dispute, auto-release through the same server path as approval.
- **Files:** new migration (cron + queue table); `app/in-progress/[bountyId]/hunter/payout.tsx:317-331`; `app/postings/[bountyId]/review-and-verify.tsx`; `lib/utils/bounty-lifecycle.ts` (`waitingOn` / `nextStep`).
- **Payment implication:** auto-release must reuse `/wallet/release` logic server-side (service role), never a client call.
- **Complexity:** A = 1–2 days; B = 1 day once policy is set.
- **Test:** staging with a backdated `submitted_at`; idempotent re-runs; no retroactive burst (use a watermark like the ratings reminder did).
- **Measure:** p50/p90 submission → decision time; % > 72h (target 0); hunter repeat-application rate after first payout.

### 7. Atomic server-side dispute resolution (T13)
- **Solution:** `admin_resolve_dispute(dispute_id, outcome, split_pct, notes)` as an edge function (service role) that, in order, settles money (release/refund via the existing ledger RPCs), then sets dispute status, then notifies, and refuses to mark a winner if settlement failed. Settle the 1 stranded case (#19, internal $1) as a test.
- **Files:** new `supabase/functions/disputes/`; `lib/services/dispute-service.ts:545-790` becomes a thin caller; `app/admin/*` dispute screens.
- **Complexity:** 2 days. **Measure:** resolved disputes whose ledger outcome ≠ status (target 0); time to resolution vs the promised 24–48h.

### 8. Ratings only from real transactions (T7, T19, T24)
- Also: render star-only ratings in `components/recent-reviews-section.tsx` so a "1 review" header is never unreadable.
- **Solution:** migration: `CHECK (rating BETWEEN 1 AND 5)`; `bounty_id NOT NULL` for new rows (NOT VALID for legacy); unique `(bounty_id, from_user_id, to_user_id)`; INSERT policy requires a `completed` bounty where (from, to) is (poster, accepted_by) or (accepted_by, poster); drop update/delete for raters (immutable; admin can hide). Exclude the 4 invalid legacy rows from `get_profile_activity_stats` aggregates. Then build the hunter→poster rating screen behind the existing notification.
- **Complexity:** < 1 day (DB); +1 day (hunter→poster UI).
- **Measure:** % of ratings tied to a valid transaction (target 100%); rating coverage per completion.

### 9. Honest time, proof and badges (T8, T9, T23) — quick wins
- `app/profile/[userId].tsx:623`: on other users' profiles render only earned milestone badges, and drive hunter milestones from `hunter_completed`, not the poster count.
- `components/bountydetailmodal.tsx:754` → relative time from `created_at` (reuse the formatter the feed cards use).
- `ProofMockCard`: drop `COMPLETED`, `paid out 2h ago`, the rating and the verified icon; label the slide "Example requests"; strip brackets from `welcomeProofExampleCards`. Or replace it with real anonymized completed bounties (19 organic completions exist) via a public RPC.
- **Complexity:** < 2 hours. Client-only, so it waits on the OTA unblock.

### 10. Poster legitimacy on the bounty a hunter is looking at (T10, T14)
- **Solution:** on `bountydetailmodal.tsx` and `app/bounty/[id]/public.tsx`, add a poster strip: join date, earned ID badge, "N bounties paid out" (`bounties_completed` from `get_profile_activity_stats`), and a **Funding** line: "Payment is held when they pick you" (at_accept) vs "Payment already held" (escrowed). Add a poster-side "Verify your identity to get more applicants" prompt on the first post ≥ $50. Server: extend `get_profile_activity_stats` with `median_response_hours` (first application → first decision).
- **Complexity:** 1–2 days.
- **Measure:** application → acceptance rate; hunter applications to unverified new posters vs verified ones.

---

## 5. Technical / security findings (summary)

| # | Finding | Severity | Evidence |
|---|---|---|---|
| S1 | Any user can create and self-resolve disputes on any bounty; cascade mutates bounty + submission | P0 | `pg_policies` on `bounty_disputes`; column grants; `trg_fn_cascade_dispute_resolution` |
| S2 | Owner refund has no state gate | P0 | `wallet/index.ts:776-825` |
| S3 | Exact address + coordinates SELECT-able by all authenticated | P0 | `information_schema.column_privileges` on `bounties` |
| S4 | Poster can PATCH `status`/`accepted_by` on funded bounties | P1 | `bounties_update_own`; `fn_bounties_enforce_funding_before_work` |
| S5 | Ratings: no CHECK, no unique, no transaction check; editable/deletable | P1 | `pg_constraint`, `pg_policies` on `ratings` |
| S6 | Suspended accounts can INSERT bounties | P1 | `bounties_insert_own` |
| S7 | `ratings` grants INSERT/UPDATE/DELETE to `anon`; `bounty_disputes` grants INSERT/UPDATE to `anon` (RLS blocks today, so one bad policy away) | P2 | `role_table_grants` |
| S8 | Admin policies using `auth.jwt()->>'role'` (never `admin`) are dead code that misleads reviewers | P3 | `bounty_disputes."Admin manage"` |
| S9 | Trust tier is client-supplied; should be classified server-side | P1 | T11 |
| S10 | Dispute settlement client-orchestrated | P1 | T13 |

Recurring root cause: `20260715i_sync_rls_policies_across_environments.sql` re-created permissive policies that later hardening migrations had removed. **Add a CI check** that fails when a table has more than one permissive policy for the same command, or a self-only `USING (auth.uid() = x)` UPDATE policy on a table with status columns.

---

## 6. Poster trust findings

| Poster question | Answer today |
|---|---|
| Who is this hunter / verified? | Good: earned ID badge, hunter-completed, pitch. ID only 13% of active hunters. |
| Have they done work before / what do others say? | Shown, but ratings are forgeable (T7) |
| What happens to my money? | Clear and accurate on StepPay and accept confirmation |
| When can the hunter receive it? | Clear: only on approval |
| What if they don't show? | Weak: the only route is a dispute (24–48h promise, 14 days observed) and no-show isn't a named path. Add "Hunter didn't show" as a one-tap cancellation that refunds automatically if the hunter hasn't checked in or submitted within N hours of the scheduled start. |
| What if the work is poor? | Revision request exists; dispute exists, but it's self-resolvable by anyone (T5) |
| Who decides? | Promised "Bounty"; in practice one founder, manually, best-effort money movement |
| Can I let this person into my home? | Trust tiers and Require-ID exist but have never run (T11) |
| Is my address private? | No (T3) |

## 7. Hunter trust findings

| Hunter question | Answer today |
|---|---|
| Is this bounty real? | Often no. 7 of the last 7 pushed bounties were scams; templated title-only posts |
| Is the poster legitimate? | No signals on the bounty surface; 0/17 posters verified |
| Is the reward funded? | 0/18 open external bounties funded; not disclosed |
| Will I get paid / when? | Only if the poster acts; no deadline (T6); poster can refund anyway (T4) |
| What if the poster refuses legitimate work? | Dispute, which the poster can self-resolve (T5) |
| What if the poster changes the scope? | Amount and terms are locked once applications exist (good). Scope text isn't versioned: snapshot `title`/`description` at acceptance onto the request row. |
| Can I trust reviews? | No (T7); and hunters can't review posters |
| Will anyone respond to my application? | 1 in 352 in 30 days |

## 8. Marketplace / liquidity trust findings

- Demand-side starvation is visible to hunters as silence: 85 pending applications averaging 12.6 days. The 09-25 expiry job closes some, but the feed still shows bounties nobody will hire on.
- The feed's most prominent listings are disproportionately scams and template posts (completeness/price sorts favor them; see 2026-09-25 audit).
- **Recommendation:** an "active poster" signal. Show "Poster last active N days ago" and auto-archive bounties whose poster hasn't opened the app in 7 days (reuse the absent-poster sweep, which still has never run for real). Fewer listings, each real, reads as a more trustworthy marketplace than many dead ones.

---

## 9. Concierge / "disguised marketplace" opportunities

At current volume (≈1 new external poster per day, ≤5 hires a month) a human can sit in the loop of every first transaction. Do it deliberately, instrument it, then automate what repeats.

1. **First-bounty review.** Every bounty from a poster with no completed transaction goes to `bounty_moderation.state='under_review'` and is invisible to feed and escalation until the founder approves it (target < 2h during waking hours). Approved bounties get a "Reviewed by Bounty" mark. This alone would have stopped every scam in T1. *Automate later:* once the scanner's false-positive rate is measured on ≥100 reviewed posts, auto-approve low-risk ones.
2. **Hire concierge.** When a first-time poster gets their 3rd applicant, the founder messages them in-app: "You have 3 applicants. Want help picking?" with a recommended hunter and why. Converts T10's silence into hires.
3. **Completion watch.** Founder owns the 72h escalation queue (item 6): contact the poster, then decide. Resolve `eccfddee` (43 days) this week by contacting the poster; if no answer in 48h, decide on the evidence.
4. **First-transaction guarantee, funded by Bounty.** Up to $100: if the hunter no-shows, the poster is refunded immediately; if the poster vanishes after a submission with evidence, Bounty pays the hunter and pursues the poster. Lifetime external GMV is $158, so the exposure is tiny, and it turns "What happens if something goes wrong?" into one sentence. *Automate later:* the guarantee becomes the auto-release rule.
5. **Scam outreach.** Message the 18 applicants of `0b9e1e8a` and the ~250 hunters reached by the 7 scam pushes: "We removed a listing you saw that asked people to make purchases for strangers. Bounty will never ask you to pay for anything to earn a bounty." Turns a trust failure into a trust moment.

## 10. Quick wins (< 1 day)

1. Remove `0b9e1e8a`; review the 3 pending reports; decide the 3 active fraud-ring accounts. *(ops, today)*
2. Escalation trust gate (item 1). *(migration)*
3. Drop `bounties_insert_own` (T12). *(one statement)*
4. Dispute RLS lockdown (item 4) after a staging reproduction.
5. Ratings CHECK + unique + transaction-scoped INSERT; drop update/delete (item 8 DB part).
6. "Posted 2h ago" → real time; carousel proof copy (item 9). *(client; queue for OTA)*
7. Contact the `eccfddee` poster; resolve the 43-day submission.
8. Poster dispute entry that doesn't require a cancellation request (item 6, poster side).
9. Earned-only badges on other users' profiles; star-only reviews visible (T23, T24).
10. Move Stripe payout setup out of poster onboarding (T25).

## 11. 1–3 day improvements

1. Refund/assignment lockdown (item 3).
2. Scam rules + report auto-hide (item 2).
3. Approval deadline + escalation queue, phase A (item 6).
4. Address privacy (item 5).
5. Server-side trust-tier classification: BEFORE INSERT trigger mirroring `lib/utils/trust-tier.ts` regexes, so it works on every client version.
6. Poster legitimacy strip + funding line (item 10).

## 12. Larger architectural improvements

1. **Server-owned bounty state machine.** Every status transition through SECURITY DEFINER RPCs (accept, start, submit, approve, request revision, cancel, dispute, resolve); a BEFORE UPDATE guard rejects direct client writes to lifecycle columns. `bounty_events` (already live) becomes the authoritative timeline.
2. **Transaction-verified reputation.** Reputation = completed escrowed transactions + ratings tied to them + on-time rate + response time. Show "Paid out N times through Bounty" for posters and "N jobs paid · ★" for hunters. Forgery then requires real escrowed money.
3. **Trust receipts.** A shareable receipt per completed bounty generated from `bounty_events` + ledger: posted, hunter chosen, escrow held, work submitted (with evidence thumbnails), approved, released, fee, net. Receipts are what make a second transaction feel safe.
4. **Completion evidence.** Optional check-in (time + coarse location) at the start of in-person work, and before/after photos stamped server-side. Both power no-show handling and disputes.
5. **Fraud signals at money boundaries.** Block or hold release when poster and hunter share a card fingerprint, device or IP, or when the hunter account is < 1 hour old (the 08-13 self-dealing signature); hold first withdrawals within 24h of first deposit.
6. **Policy CI.** Lint RLS (§5) and diff live policies against git on every deploy. This audit's two worst holes are policy drift.

## 13. Recommended implementation sequence

| Week | Work | Why this order |
|---|---|---|
| 0 (today) | Ops: remove scam, triage reports, fraud-ring decision, contact `eccfddee` poster, start first-bounty manual review | Stops live harm with no code |
| 1 | One migration batch: escalation gate, `bounties_insert_own` drop, dispute RLS, ratings constraints, report auto-hide, scanner rules. Then `/wallet/refund` gate + edge deploy. | All server-side: reaches every client despite the OTA block. Verify each on staging with BEGIN/ROLLBACK before prod. |
| 2 | Address privacy (DB + client), approval deadline phase A, server-side trust tier, atomic dispute resolution | Address fix needs coordinated client change; ship the REVOKE with a client that doesn't need the columns |
| 2–3 | Unblock OTA; ship client batch: real timestamps, honest proof slide, poster strip + funding line, deadline countdowns, hunter→poster rating | Client changes are inert until OTA works |
| 4+ | State machine guard, transaction-verified reputation, receipts, auto-release (phase B), fraud signals | Structural, after the holes are closed |

## 14. Shoal evidence

Four trust scenarios, swarm 3, Opus, against a fresh staging web export of `main` served on `localhost:8091` (guard confirmed a non-production target). Cost: $3.16 + $2.63 + $2.93 + $3.27 = **$11.99**, plus one `poster-review` attempt lost to a job timeout. Artifacts: `qa/shoal/artifacts/2026-10-01T16-56-39-trust-audit`, `…T17-00-03-hunter-conversion`, `…T17-14-16-poster-review`, `…T17-19-07-abandonment-recovery`.

**Screenshots:** this Shoal build (`771aad1fb3ca`) shows screenshots to its verify pass but doesn't persist them. `shoal-report.json` holds text trails only. Each finding below was confirmed by the verify pass against its screenshot; quotes are the agents' own.

| Scenario | Outcome | Findings |
|---|---|---|
| trust-audit (skeptical posters) | 0/3 reached funding (all exhausted the step budget in onboarding) | 1 P0* · 2 P1 · 1 P3 |
| hunter-conversion | 2/3 applied | 6 P1 · 5 P2 · 1 P3 |
| poster-review | 2/3 hired | 3 P1 · 6 P2 · 2 P3 |
| abandonment-recovery | 0/3 recovered a stalled job | 11 P1 · 2 P2 · 1 P3 |

Re-triaged, trust-relevant results:

| Finding | Shoal evidence | Verdict |
|---|---|---|
| Poster has no recourse when the hunter stalls (T22) | "The one action offered to me is one I'm not permitted to take." / "Open a dispute … full-screen error: 'Dispute information not found'" | **Confirmed in code**, P0 |
| Address shown next to "Location TBD" (T3) | "the card says 'Location TBD' … directly underneath 'Additional Details' gives 'Stockton St, San Francisco, CA, 94108', and the feed card said 'Union Square'. Three different answers to one question." | **Confirms T3**: the exact address is rendered to a browsing hunter |
| Unearned badges read as claims (T23) | "'Jobs Completed 0' … yet underneath there are badges reading '5 Bounties Completed', 'Top Rated' … Three different stories about the same stranger." | **Confirmed in code**, P1 |
| Unreadable review (T24) | "this site advertises that one exists then hides it" | **Confirmed in code**, P1 |
| Posters pushed into payout setup (T25) | "As a payer I have no reason to open a Stripe payout account; being pushed to hand over bank details I don't need feels like data collection by default." | **Confirmed in code** (by design), P1 |
| Stalled job: no deadline or recourse (T6/T22) | "The app never tells me: when the worker accepted or how long they've been silent, any deadline or auto-expiry, how to nudge/report/dispute them." | Confirms T6 from the poster side |
| Accept dialog has no "what if it goes wrong" | "I escrowed real money against a stranger with 0 completed jobs and an unreadable review, with no visible way to raise a dispute." | P2: add one line + link to the accept confirmation |
| Title-only template bounties | "There is no description, no scope, no start time and no deadline anywhere … Holding a queue spot could be 20 minutes or 6 hours" | Confirms T16 |
| Fee honesty | "Honest math here: 'You pay $35 … the hunter takes home $33.25.' No surprise add-on." | **Works**: don't change |
| Onboarding length | All 3 skeptical posters spent their 35-step budget in signup → location → role → payout → founder note before reaching funding | P2 (partly harness budget) |
| "Signup always says email already registered" (Shoal P0) | Second address had a trailing space; the 409 branch only fires on a backend email conflict | **Unconfirmed**: likely collision with addresses from earlier runs on staging; re-test with a unique address |
| "Approve blocked: Submission Required" | Proof displayed, approve refused | **Unconfirmed**: fires when the loaded submission isn't `pending`; seeded staging submissions are known to be in odd states. The copy "Load the hunter's pending completion submission" is developer language regardless |
| "Contact Support does nothing" | Button inert | **Harness artifact**: it's a `mailto:` (`cancel.tsx:152`); headless Chromium ignores it. On a phone it opens email, which is still the poster's only recourse |

Not covered by Shoal: payment, escrow and payout (the web build stubs Stripe; see `reference_shoal_stripe_web_stub`). Those findings (T4, T5, T6) come from code and production data.

## 15. Trust metrics and events

**Done means observed** (per the 2026-09-25 working rules): each fix names the table or event that must show new rows.

| Metric | Source | Target |
|---|---|---|
| Escalation recipients on later-removed bounties | `notifications` ⨝ `bounty_moderation` | 0 |
| Scam post → hidden latency | `bounty_moderation_events` | < 2h |
| Reports pending > 24h | `reports` | 0 |
| Public `location` containing a street number | `bounties` | 0 |
| Refunds after acceptance without cancellation/dispute | `wallet_transactions` ⨝ `bounty_cancellations`/`bounty_disputes` | 0 |
| Non-admin dispute status changes | `dispute_audit_log` actor | 0 |
| Submission → decision p90 | `completion_submissions` | < 72h |
| Disputes where ledger ≠ outcome | `bounty_disputes` ⨝ `wallet_transactions` | 0 |
| Ratings tied to a valid transaction | `ratings` ⨝ `bounties` | 100% |
| Application → decision within 72h | `bounty_request_outcomes` | ↑ from ~0% |
| Second transaction within 30 days (poster and hunter) | `bounties` | ↑ |

Events (reuse existing names; one new where none exists):
- Existing: `profile_viewed`, `application_accepted` (has `profileViewedBeforeAccept`), `escrow_funded`, `escrow_released`, `escrow_refunded`, `completion_submitted`, `dispute_started`, `dispute_resolved`, `rating_submitted`, `trust_requirement_set`, `trust_requirement_blocked_apply`, `identity_verified`.
- **New `report_submitted`** (no existing event covers it; `report-service.ts` emits nothing).
- **New server-side `completion_review_overdue`** (written by the cron into `bounty_events`, not PostHog), so the deadline is observable without a client.

---

## Appendix — exact files and functions to modify

| Area | Files / objects |
|---|---|
| Escalation gate | `fn_escalate_stale_bounty_liquidity`, `fn_notify_radius_matched_bounty`, `fn_notify_zip_matched_bounty`, `fn_notify_service_area_matched_bounty` |
| Scam rules / reports | `moderation_scan_content`, `moderation_apply_signals`, new trigger on `public.reports`, `app/admin/reports.tsx`, `lib/services/report-service.ts` (event) |
| Address privacy | `app/screens/CreateBounty/quick/StepWhere.tsx`, `app/services/bountyService.ts`, `lib/services/bounty-service.ts` (`FEED_SAFE_BOUNTY_COLUMNS`), `components/bounty-card.tsx`, `components/bountydetailmodal.tsx`, `app/bounty/[id]/public.tsx`, `components/profile-bounty-history-section.tsx`, `get_bounty_exact_location`, column grants on `bounties` |
| Escrow commitment | `supabase/functions/wallet/index.ts` (`/refund`), new BEFORE UPDATE guard on `bounties`, `fn_bounties_enforce_funding_before_work` |
| Disputes | policies on `bounty_disputes`, `trg_fn_cascade_dispute_resolution`, new `supabase/functions/disputes/`, `lib/services/dispute-service.ts`, `components/workflow-dispute-modal.tsx` (SLA copy) |
| Approval deadline | new cron migration, `app/in-progress/[bountyId]/hunter/payout.tsx`, `app/postings/[bountyId]/review-and-verify.tsx`, `lib/utils/bounty-lifecycle.ts` |
| Ratings | constraints + policies on `ratings`, `get_profile_activity_stats(_batch)`, new hunter→poster screen |
| Honest copy | `components/bountydetailmodal.tsx:754`, `components/onboarding/WelcomeCarousel.tsx` (`ProofMockCard`), `lib/strings/welcomeCarousel.ts` |
| Poster signals | `components/bountydetailmodal.tsx`, `app/bounty/[id]/public.tsx`, `get_profile_activity_stats` |
| Trust tier | new BEFORE INSERT trigger on `bounties` mirroring `lib/utils/trust-tier.ts` |
| Account enforcement | drop `bounties_insert_own` |
| Template posts | `app/screens/CreateBounty/quick/StepTask.tsx` (`TASK_TEMPLATES`) |
| Poster recourse | `app/bounty/[id]/dispute.tsx`, `app/bounty/[id]/cancel.tsx`, `app/postings/[bountyId]/index.tsx:244`, `components/my-posting-expandable.tsx:986-997`, `components/workflow-dispute-modal.tsx` |
| Profile badges / reviews | `components/ui/milestone-badge-chips.tsx`, `app/profile/[userId].tsx:623`, `components/recent-reviews-section.tsx` |
| Onboarding payout step | `app/onboarding/payouts.tsx`, `app/onboarding/role-select.tsx` |
