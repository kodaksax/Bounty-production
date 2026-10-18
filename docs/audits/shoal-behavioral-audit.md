# Bounty: Shoal behavioral audit (poster conversion, hunter retention)

**Date:** 2026-10-15
**Repository state:** `main` at `50a7ad14` (PR #912 merged), clean working tree at start
**Companion report:** the Cowork PostHog behavioral analysis (handoff dated 2026-10-15). It was received in this session as pasted text. It is **not yet in the repo** at `docs/audits/posthog-behavioral-analysis.md`. Its finding IDs (TRUST-01, POST-01 … ANLT-06) are mapped to the implementation in [§3](#3-cowork-findings-mapped-to-the-implementation).

**What this audit did**

- Read the code paths for posting, applicant review, hiring, notifications, hunter discovery and applying.
- Ran read-only SQL against production (`xwlwqzzphmmhghiqvkeu`) and staging (`gwumwpoomwvkjyibdmpj`). Every query ran inside `BEGIN READ ONLY` and ended with `ROLLBACK`. No production row was written.
- Pulled live definitions of the notification, reminder and distribution functions from production and diffed them against git.
- Ran Shoal swarms against a staging-wired web export (`http://localhost:8090`, Stripe test mode, guard-verified). No real payments, no real accounts, no real notifications.

**What it did not do**

- No production deploy, migration, destructive SQL or payment action. The absent-poster sweep was run only in its dry-run mode, inside a read-only transaction.
- No PostHog queries. This machine has no PostHog API key, so every PostHog number below is quoted from the Cowork report and labelled as such.
- No on-device testing. Shoal drives a desktop-sized (1024×768) browser against the Expo **web** export. The product posters and hunters actually use is the iOS/Android app, plus the separate bountyfinder.net intake (a different repo). Web-only behavior is called out where it matters.

**Evidence labels** (same as the Cowork report)

- **[Observed]**: returned by a query or seen in code during this audit.
- **[Shoal]**: reported by a Shoal agent and re-triaged by hand. Agent reports are *test scenarios, not real user behavior.*
- **[Inferred]**: a reasoned reading of observed data.
- **[Hypothesis]**: plausible, not yet tested.
- **[Cowork]**: a PostHog figure from the Cowork report, not re-queried here.

**Population** (matches Cowork): a *genuine* bounty is external (`profiles.is_internal` not true), not `is_test`, not moderation-removed, and posted by an account that is not banned or suspended. Cowork counts 27 such bounties from 17 posters. That equals the 57 rows the same filter returns **minus 30 legacy rows whose owner profile no longer exists**. 29 of those 30 predate September. The exception is `a882ca79` (2026-10-09, archived, no applications; its owner's profile has since gone), which is counted in the September-onward figures below (e.g. the 19 genuine bounties since 09-10). Otherwise those figures are the same under both definitions.

---

## 1. Executive summary

The Cowork report's central diagnosis holds up against the database: hunters show up, posters never choose. This audit adds four findings that change *what to fix first*.

1. **Every open listing a hunter can apply to today is abandoned** [Observed]. All 16 open external bounties belong to posters who stopped opening the app days or weeks ago (three have shown no activity since June–July). Together they drew **98 applications in the last 14 days**, and every one of those is headed for automatic expiry. The absent-poster sweep built for exactly this (`fn_sweep_absent_posters`, 2026-09-25) **has never run**. Its dry run today would archive 10 of them and close 31 pending applications from 25 hunters. **This is the hunter-churn engine:** a new hunter's entire first experience is applying to listings nobody will ever read.

2. **In-person jobs are not local, by construction** [Observed]. The hunter feed defaults to "Any distance — Browse every open bounty" (`components/bounty-feed.tsx`). Nothing on the server stops a hunter from applying to an in-person job anywhere in the world, and the applicant card shows no distance. Of the 18 applications to genuine in-person bounties where both locations are known, **none came from within 50 miles; the median was 1,504 miles**. A poster opening the applicant list for "Mount my TV" is choosing among people who cannot come.

3. **Most recent "genuine demand" is one-tap template posts** [Observed]. 12 of the 19 genuine bounties since 09-10 carry an exact title from the composer's "popular" list ("Hold my spot in the merch line", "Take lecture notes for me", …). 11 of them have no description, and 16 of the 19 have no description at all. One tap fills in the title, category and price and skips ahead, so a curious new user can publish with that tap, a location and "Post Bounty". These posts drew 222 applications. One account published five in six minutes, including "I want to make everyone happy". [Inferred] A large share of what the funnel counts as posters who "never hire" were never trying to hire.

4. **Two things Cowork recommends are already shipped, and one is regressed** [Observed]:
   - **Already live:** the anti-scam distribution gate (no fraud alert since the week of 09-28); a required Location step in the composer (since 09-15, reaching users with 2.1.1, so every genuine bounty since 10-06 has a location); payment-timing copy at post time; and "this wasn't a rejection" copy for hunters.
   - **Regressed:** migration `20260913010000` silently reverted the zip-code and service-area alert paths to a pre-09-12 body. They bypass relevance scoring, reach caps, dedup, the "already applied" check and (for zip) the deleted-account filter. Reach so far is tiny (1 recipient since 09-13), but it grows as location capture works.

What Cowork found and this audit confirms, with harder numbers:

- **0 poster decisions** on the 288 external applications to genuine bounties since 09-13 (267 expired, 12 closed with the bounty, 9 pending).
- **0 of 17** genuine pay-at-accept bounties hired since that mode became the default on 09-02, against 2 of 4 fund-at-post bounties in September–October (two of those four came through the web intake). Small and confounded; see SBA-05.
- **Poster reminder flood:** one bounty generated **101 reminders to one poster over 21 days, none read**; one poster received 248 poster-facing notifications in 60 days (up to 38 in a day, 0% read). Reminders are sent per application, are never bundled, and never stop for a poster who has left.

**What to do first** (detail in [§9](#9-remediation-plan-sequenced)):

1. **Close the dead listings** (needs your go): run the absent-poster sweep once, schedule it, and extend it to dead listings that have no pending applications. *Done means:* rows in `absent_poster_sweep_runs`, and the open external feed contains only posters active in the last 14 days.
2. **Make in-person local:** default the in-person feed to a radius, show distance on applicant cards, and decide whether far-away applications are blocked or flagged.
3. **Stop the reminder flood:** one digest per bounty, at most two in total, none after the poster has been absent 72 hours.
4. **Raise the floor on a first post:** a template tap still requires one line of detail (what/when) before publishing.
5. **Decide the first-time funding mode.** This is a product decision, not a code bug; options and evidence are in [SBA-05](#sba-05--p1--nobody-hires-under-pay-at-accept).

---

## 2. System inventory

| Area | What is actually there |
|---|---|
| Clients | Expo / React Native app (iOS, Android); `app.json` version **2.1.3**. 2.1.2 binaries crash the tabs screen, and 2.1.3 needs a new native build (see `docs/deployment/RELEASE_READINESS_2.1.3_2026-10-13.md`). The Expo **web** export is a test target only; nothing serves it to customers. |
| Web poster intake | bountyfinder.net (landing page + `/manage/` dashboard, separate repo `Bounty-landing-page`), backed by Edge Functions `poster-web`, `web-account`, `email-inbound`, `geocode-bounties`. Pay-at-post via Stripe Checkout. `docs/runbooks/web-poster-journey.md`. |
| Backend | Supabase Postgres + 38 Edge Functions in git (`supabase/functions/`). Notification fan-out: `notifications_outbox` → `drain_notifications_outbox` (cron, every minute) → `process-notification` (Expo push, Resend email fallback). |
| Distribution | Insert-time triggers `fn_notify_radius_matched_bounty` (20 mi, scored), `fn_notify_zip_matched_bounty` and `fn_notify_service_area_matched_bounty` (**unscored**, see SBA-07), all behind `fn_bounty_distribution_gate`. Escalation cron `fn_escalate_stale_bounty_liquidity` (every 20 min, credibility required). |
| Request lifecycle | `fn_remind_posters_of_pending_requests` (1 h + 24 h per application), `expire-stale-bounty-requests` (72 h), `fn_sweep_absent_posters` (manual, never run). |
| Payments | Pay-at-accept is the default for every paid app bounty (`payment_experiment_config.deferred_funding_enabled = true`, scope `all_bounties`, since 2026-09-02). Escrow is reserved inside the acceptance transaction (`fn_accept_bounty_request` → `fn_reserve_escrow_for_acceptance`). Gate UI: `hooks/useAcceptFunding.ts` + `components/accept-funding-gate.tsx`. |
| Cron (prod) | 16 jobs, all succeeding over the last 7 days, including `geocode-bounties-15min` (live since about 10-13). **No absent-poster sweep job.** |
| Admin | Founder "Liquidity Board" (`app/admin/liquidity-board.tsx`, `hooks/useLiquidityBoard.ts`): the per-bounty applicant/liquidity view a concierge needs already exists. |
| Analytics | PostHog via `lib/services/analytics-service.ts`; canonical names in `docs/analytics/EVENT_TAXONOMY_CUTOVER.md`. |
| Tests | `npm test` (jest), `npx tsc --noEmit`, `npm run lint`, Playwright (`playwright.config.ts`), `npm run qa:shoal:test` (harness guards, **65/65 pass**). |
| Shoal | `qa/shoal/` (see its README). Pinned Shoal `771aad1fb3ca`. 12 poster + 12 hunter staging pool accounts seeded and healthy. |

**The web export does not build on `main`** [Observed]: `lib/themes/applyGlobalFont.ts` requires React Native internals that Metro refuses to bundle for web. The fix (a 4-line `applyGlobalFont.web.ts` no-op) is in **PR #913, still open**. Until it merges, the nightly Shoal workflow cannot run. For this audit the file was copied in temporarily, the export was built, and the file was deleted again.

---

## 3. Cowork findings mapped to the implementation

| Cowork ID | Cowork claim | What the code and database show | Status |
|---|---|---|---|
| TRUST-01 | 98% of relevance alerts promoted fraud; gate distribution on credibility | Confirmed: 355 fraud alerts vs 6 genuine, all fraud in the weeks of 09-14 to 09-28. The **gate is already live** (`20261001140000`, prod 10-01/02); **0 fraud alerts since**. Escalation (426 recipients, 09-16 to 09-29) has also stopped. Correction: reward size does **not** raise the relevance *score*. It raises *reach* (`v_cap`: ≥$100 → 60 hunters, ≥$40 → 40, else 25). | (a) shipped. (b) hunter repair message and (c) fraud state on events still open. |
| POST-01 | Genuine posters never act on applicants | Confirmed: 0 decisions on 288 applications since 09-13. Two causes Cowork did not have: applicants are not local (SBA-02), and many first posts are one-tap templates (SBA-03). | Confirmed, root cause widened |
| POST-02 | Concierge every genuine poster's first hire | No code needed. The Liquidity Board already lists bounties with applicants. With ~1 genuine post a week, this is an ops habit. | Ops; tooling exists |
| POST-03 | Applicant flood; ~55 pushes per poster | Confirmed and worse: reminders are per application, unbundled and uncapped, and continue to absent posters (SBA-04). `application` pushes *are* bundled per bounty in 10-minute windows. Applicants are sorted newest-first with no distance (SBA-02). | Confirmed |
| POST-04 | Payment moment arrives late | Copy at post time **already says** "You're charged when you accept a hunter … held … released when you approve … hunter takes home $X" (`StepPay.tsx:320-330`). The gate is one sheet, one tap. What's missing is commitment, not clarity (SBA-05). | Copy shipped; decision open |
| HUNT-01 | Hunters experience only rejection | Confirmed. Expiry copy **already says** "This wasn't a rejection" (`lib/utils/bounty-lifecycle.ts:796-804`). Still open: notices are not batched (up to 6 emails a day to one hunter), and dead listings keep collecting applications (SBA-01). | Copy shipped; batching + sweep open |
| NOTIF-01 | Relevance pipeline near-silent for genuine bounties | Confirmed structurally: every candidate query needs `geom` or `zip_code`, so a bounty without location produces no candidates (it isn't scored low; there is simply no one to score). New posts now carry location. Most applicants have a location (224 of 329), so the radius path has a pool, but hunters are scattered. The zip/service-area paths are regressed (SBA-07). | Partly fixed; regression open |
| LIQ-01 | Require location on in-person bounties | **Shipped** 2026-09-15 (`f554e045`, composer `TOTAL_STEPS = 3`). All 4 genuine bounties since 10-06 have a location. Remaining: 12 of 15 open in-person external listings have **no location at all** (legacy posts), and nothing limits who can apply (SBA-02). | Shipped for new posts |
| POST-05 | Composer step 1 and pricing friction | Not reproduced in step 1 here; the Shoal posters ran out of steps in **onboarding** before reaching the composer (SBA-06). Template taps are the bigger step-1 issue (SBA-03). | Re-scoped |
| POST-06 | Poster-intent users drift into hunting | Not re-measured (PostHog). The first screen's primary CTA now reads "Get it done today." (`lib/strings/firstScreen.ts`), replacing "Make today pay." | Partly addressed |
| TRUST-02 | ID verification Edge Function errors | The message is supabase-js `FunctionsFetchError` (no response reached the client) from `app/verification/launch.tsx:50`. The cause needs the function's invocation logs, which this audit did not have. | Unverified |
| DQ-03 / ANLT-01 | Signup capture ~19% | Confirmed cause: `signup_completed` is emitted **only** by the email form (`app/auth/sign-up-form.tsx:518`). Apple and Google sign-in never emit it. | Confirmed |
| DQ-04 / ANLT-02 | `primary_role` not persisted | Confirmed: `app/onboarding/role-select.tsx` only fires `role_selected` and navigates. `primary_role` is written at onboarding completion (`hooks/useCompleteOnboarding.ts:136`) or inferred on first post/apply. Anyone who stops between is NULL. | Confirmed |
| DQ-06 / ANLT-03 | `accept_funding_started` 0 = naming mismatch | **Not a mismatch.** `accept_funding_started` fires only when the poster taps "Confirm & hire" or starts the payment sheet (`hooks/useAcceptFunding.ts:357,377`). "5 required, 0 started" means **no poster who saw the sheet pressed its button**. That is a real signal. | Correction |
| DQ-10 | Fraud not marked on events | Not changed; still true. | Open |
| (none) | — | `poster_interacted_at` is stamped only by messaging, "Ask a question" and the web dashboard. Viewing the applicant list in the app does not stamp it, so "0 interactions" means "no message, question, accept or decline", not "never looked". PostHog `applicant_list_viewed` covers looking. | Measurement note |

---

## 4. Poster journey, traced

Each row answers the audit's questions for that step: what stops people, what happens on a mistake or a step back, and whether the screen reflects server truth.

| Step | Implementation | Findings |
|---|---|---|
| First screen | `app/onboarding/welcome.tsx`, copy in `lib/strings/firstScreen.ts`. Primary CTA "Get it done today.", secondary "I'd rather earn". | Poster-first. A cold-market fallback card makes no factual claim. |
| Sign-up | `app/auth/sign-up-form.tsx` → `POST {API_BASE_URL}/auth/register`, then sign-in. Password rules are validated client-side before any request. | **SBA-08:** the live "@name is available" check is wrong for every name, so a taken username shows a green tick and then a red "already taken" banner. [Shoal] Password rules (a special character is required) appear only after the first submit; 4 of 6 agents hit this. |
| Onboarding | style → location → role → (poster) `poster-profile` → `founder-note` → app. | **SBA-06:** [Shoal] 0 of 6 agents reached a published bounty in 40 steps. The founder note hides its only button for about 8 s while a quote types out (`founder-note.tsx`, `CTA_DELAY_MS` and typing timers); 2 of 6 thought the app had frozen. Location permission was requested twice. |
| Entering the composer | Bottom-nav "Post" → `CreateBountyFlow` (`app/screens/CreateBounty/index.tsx`). | [Shoal, web] The first "Post" tap after onboarding was intercepted by an ID-and-selfie prompt; "Later" returned agents to the feed, not the composer. The ID moment is session-gated (`lib/moments/registry.ts:222-236`), so this may be a web session-count artifact. **Needs device reproduction.** |
| Step 1: task | `StepTask.tsx`: free-text title (max 120) or one of 12 templates. A template sets title, category and price **and immediately advances**. | **SBA-03:** templates publish title-only bounties. Description is never asked before publishing. |
| Step 2: location | `StepWhere.tsx`: required for in-person; Places autocomplete → coordinates; device geocoder fallback; "This can be done online". Privacy note shown. | Works as designed (all genuine posts since 10-06 have a location). Exact address goes to `bounty_private_locations` via the `zz_bounties_privatize_location` trigger. |
| Step 3: reward | `StepPay.tsx`: presets, the for-honor option hidden by policy, the ID-required toggle for risky categories, and the reassurance card. | Copy matches the at_accept implementation: charged at hire, held, released on approval, 5% fee from the hunter's side, net shown. Balance warning: "Posting is free — you'll be charged $X only when you accept someone." |
| Publish | `useBountyPublish.ts`: email-verified gate, offline queue, error banner with retry, drafts autosaved (`useBountyDraft`, device-local). | Drafts survive leaving and back navigation. The "Edit amount" path lands on step 3 (fixed 09-25). |
| After publish | `PostCelebration` ("Hunters can see it now. When someone steps up to help, we'll let you know."), then `StepPostPublish` (add photos/details/date). | **SBA-10:** nothing tells the poster how this will go: that applications typically arrive within hours, that they choose, that they pay only then, and that **applications close automatically after 3 days**. |
| Applications arrive | `application` push, bundled per bounty in 10-minute windows → Requests landing (`lib/services/notification-deep-links.ts`). Reminders at 1 h and 24 h per application. | **SBA-04:** unbatched, uncapped reminders. **SBA-02:** applicants are not local, the list is newest-first, and the card has no distance. |
| Choosing | `components/applicant-card.tsx`: verified badge (earned only), rating suppressed below the minimum sample, self-reported skills, pitch, "Choose this hunter" / "Ask a question" / "Decline". | Honest trust design; little data behind it. |
| Paying and hiring | `useAcceptFunding` gate: "Confirm & hire" if the wallet covers it, else "Pay $X & hire" (card / Apple Pay), with "Link a card" first if none is saved. The amount is read from the server; the deposit is re-checked from the server. | **SBA-05:** 0 of 17 at_accept genuine bounties hired. [Cowork] 5 posters saw the sheet in 45 days and none pressed its button. |
| Web poster (bountyfinder.net) | Stripe Checkout at post → `/manage/` dashboard (accept/decline/confirm). | [Observed] 28 intakes since 08-15: 8 paid and created, 20 abandoned at checkout. Not covered by Shoal (separate repo). |

---

## 5. Hunter journey, traced

| Step | Implementation | Findings |
|---|---|---|
| Discovery | `components/bounty-feed.tsx`. The distance filter defaults to `DISTANCE_OFF` ("Any distance — Browse every open bounty"). The country check (`lib/utils/serviceable-region.ts`) is analytics context only; it gates nothing. | **SBA-02.** And the feed's entire external supply is abandoned listings (**SBA-01**). |
| Search | `app/tabs/search.tsx`: results via `bountyService.searchWithFilters` (hides `is_test` from non-internal users); autocomplete via `bountyService.search` (**no `is_test` filter**). | **SBA-11:** test bounties leak into autocomplete (7 open test bounties on prod), and a query that matches only test rows shows suggestions above "No bounties found". [Shoal] 3 of 3 agents. |
| Bounty detail | `components/bountydetailmodal.tsx`, `components/bounty-trust-signals.tsx` (funding line from `get_bounty_funding_status`, poster history). | [Shoal] Title-only listings leave scope, date and distance unanswered (consequence of SBA-03). Pay-at-accept listings say "Payment not held yet". That is accurate, and it costs the hunter trust. |
| Apply | `bounty_requests` insert; BEFORE triggers enforce open-target and ID requirements. **No distance or eligibility check.** | **SBA-02.** |
| Waiting | Status from `lib/utils/bounty-lifecycle.ts`: "Application sent — Waiting on …". | **SBA-10 (hunter side):** [Shoal] nothing says the poster has 3 days or what happens if they never answer. |
| Outcome | `application_expired` ("didn't make a decision in time … This wasn't a rejection") and `application_bounty_closed`, one notice per application, with email fallback for expiry. | **SBA-09:** [Observed] up to 6 expiry emails in one day to one hunter. In 60 days: 289 expired + 172 closed vs 17 acceptances. |
| Returning from a notification | `bounty_nearby` → `/bounty/:id?source=notification`; the poster reminder → `/postings/:id`; `application` → Requests landing; the action-sheet "Accept" routes through the gated flow (`notification-action-sheet.tsx:104-121`). | Routing is coherent. [Cowork] a credible alert works: 91% view the same bounty within 30 minutes, 32% apply within 24 hours. The failure is upstream: almost no credible alerts are sent. |

---

## 6. Notifications and money: copy vs behavior

| Claim the user sees | Where | Matches the implementation? |
|---|---|---|
| "You're charged when you accept a hunter … held … released when you approve the work … hunter takes home $X" | `StepPay.tsx` | **Yes**, for at_accept v1 (the default since 09-02). |
| "Held for in-app completion or dispute review" | `accept-funding-gate.tsx:294` | Yes: escrow is reserved in the acceptance transaction. |
| "Payment not held yet — Bounty takes the payment from the poster when they choose a hunter, before any work starts" | hunter bounty detail | Yes. But every paid open external listing (13 of 16; the other 3 are for-honor) is pay-at-accept, so this is what hunters read on all of them. |
| "Only your neighborhood is shown publicly. Your exact address isn't shared until you accept someone" | `StepWhere.tsx` | Yes: `bounty_private_locations` + `get_bounty_exact_location`, live on prod since 10-02. |
| "Take a look before they move on to another job" / "unanswered requests close automatically" | reminder copy (`fn_remind_posters_of_pending_requests`) | Yes, but it is sent per application, up to 2 × N times per bounty, with no stop. |
| "This wasn't a rejection" | hunter expiry copy | Yes. |
| "When someone steps up to help, we'll let you know" | `PostCelebration` | Yes, but incomplete: it doesn't mention the 3-day decision window. |

---

## 7. Shoal results

**Setup.** Staging-wired static web export of `main` (+ the PR #913 web shim, temporarily) served on `:8090`. The guard refused nothing. The pool accounts were healthy (12 + 12). Model: `claude-opus-5` through the metered API. **Total cost: $14.06.** Artifacts are in `qa/shoal/artifacts/2026-10-15T*` (gitignored).

**How to read these.** Agents are personas doing test scenarios, not real users. Every finding below was re-triaged by hand against code, the staging database or a scripted Playwright reproduction. Agent severity labels were discarded.

| Run | Personas (swarm) | Outcome | Cost |
|---|---|---|---|
| `poster-conversion`: new poster, signup → published bounty | new poster, impatient mobile, non-technical (6) | **0 / 6 published**; all ran out of steps in sign-up/onboarding | $5.84 |
| `hunter-notification-return` (**new**): hunter lands from a nearby-bounty alert | hunter, impatient mobile, careful (3) | 1 / 3 applied | $2.33 |
| `poster-first-hire` (**new**): first-time poster decides on applicants | new, skeptical, careful (3) | **0 / 3 hired** | $2.79 |
| `abandonment-recovery`: nobody applied / hired hunter went quiet | returning, skeptical, distracted (3) | 1 / 3 finished the questions; 0 recovered the listing | $3.10 |

### Confirmed (reproduced or verified in code/data)

| # | What Shoal reported | Verification | → |
|---|---|---|---|
| S1 | "Review hunters" on a posted bounty drops the poster on the Home feed (2 agents, both entry points) | **Reproduced** with a scripted Playwright run (390×844, pool poster 04, bounty `14691d2d`): the URL becomes `/tabs/bounty-app?initialTab=requests` and "For You" renders. Cause: expo-router treats a query param named `screen` as a nested-navigator key and deletes it (`node_modules/expo-router/build/global-state/routeInfo.js`: `delete params['screen']`), so `app/tabs/bounty-app.tsx:208` falls back to `'bounty'`. Every `?screen=` link is affected: `REQUESTS_ROUTE` (`app/postings/[bountyId]/index.tsx:64`), `POSTER_REQUESTS_PATH` (the `application` notification landing), `?screen=wallet`. **Web confirmed. Native unverified:** native has no URL round-trip, so the param probably survives in navigation state, which fits Cowork's 21 applicant views from 27 `application` opens. | SBA-12 |
| S2 | A poster's Inbox opens on "My Work — No work yet — Apply to a bounty" | Reproduced (screenshot). `inbox-screen.tsx:91` defaults to the hunter tab unless `initialTab` is requests/myPostings. Applications sit behind the second tab ("My Bounties", badge 4). | SBA-10 |
| S3 | Username shows "@name is available" and is then rejected as taken | **Root cause in RLS:** `profiles` SELECT is `auth.uid() = id` only (prod and staging). `isUsernameUnique` (`lib/services/userProfile.ts:63`) reads no row and no error, so **every** username reads as available. The `/auth/register` 409 is the only real check. | SBA-08 |
| S4 | Search suggestions list matches while results say "No bounties found" (3 agents) | Autocomplete uses `bountyService.search` (`lib/services/bounty-service.ts:351`) with **no `is_test` filter**; results use `searchWithFilters`, which hides `is_test` from non-internal users. No RLS on `is_test`. On prod, 7 open test bounties can surface in any user's autocomplete. | SBA-11 |
| S5 | The founder-note screen has no button for about 8 s (2 of 6 thought it froze) | `app/onboarding/founder-note.tsx`: the CTA reveals after the typing animation (`CTA_DELAY_MS`, signature timers). Skipped only under Reduce Motion. | SBA-06 |
| S6 | Password rule (special character) shown only after the first submit (4 of 6) | `validateNewPassword` runs on submit; the field hint says "At least 8 characters". | SBA-06 |
| S7 | Title-only listings: no scope, date or distance; "Payment not held yet" | Matches production: 16 of 19 genuine bounties since 09-10 have no description; at_accept listings are honestly "not held". | SBA-03, SBA-05 |
| S8 | After applying, nothing says how long the poster has or what happens if they never answer | No such copy exists in the hunter status (`lib/utils/bounty-lifecycle.ts`). | SBA-10 |
| S9 | A poster's only action on a stale listing is "Edit details", and saving a raised reward fails with "update failed" | `bountyService.update` catches every error and returns `null` (`lib/services/bounty-service.ts`, update `catch`), so the screen can only say "update failed". Delete-with-refund exists, but only as the trash icon on the inbox row, never on the bounty screen. The specific staging rejection was not identified (it needs the request log). | SBA-10 |
| S10 | "Your review window closed … Bounty support is reviewing this" with no policy behind it | Known from the 10-02 re-audit: the review-window migrations `20261002120000/120100` are applied nowhere, but `review-deadline.ts` copy is live. | SBA-10 |

### Discarded as harness, seed or web artifacts

- **"The notification dropped me on a generic feed"** (`hunter-notification-return`, 3 reports): `run.mjs` started signed-in scenarios at `/` and told agents "the address bar works"; Shoal agents have none. **Fixed in this audit** (`qa/shoal/bin/run.mjs` now says to use the app's navigation, and scenarios can carry a `navigationHint`).
- **"Email already registered" on a brand-new address** (3 agents): the address `priya.test@example.com` was created on staging on 2026-09-20 by an earlier swarm. The client validates the password before any request, so a rejected first attempt creates nothing.
- "Type: Remote" on a couch job, identical inbox previews, the locked composer on a hired thread, "no applications anywhere" (slot 03): seed data (online work type, one shared conversation per poster–hunter pair, slot 03 has no pending request). The two hire-side runs that had pending applicants (slots 01–02) could not open them because of S1.
- "Wallet data isn't encrypted": SecureStore doesn't exist on web.
- "Joined September 2026 is a future date": the agent was wrong about the date.
- [Shoal, web] The first "Post" tap after onboarding showed the ID-and-selfie prompt; "Later" returned to the feed. The prompt is session-gated (`lib/moments/registry.ts:222-236`), and on web the session count may increment per page load. **Not discarded, not confirmed: needs a device run.**

### Persona coverage vs the brief

| Brief persona | Covered by | Gap |
|---|---|---|
| First-time household task; busy professional; non-technical | `poster-conversion` | Agents never reached the composer (onboarding consumed the budget), so composer steps 2–3 were not exercised by Shoal this round. |
| Homeowner with trust/payment concerns | `poster-first-hire`, `abandonment-recovery` (skeptical poster) | Pay & hire with a card can't run on web (Stripe stub, see `qa/shoal/README.md`). |
| Small-business operator; poster with payment/account problem | — | Not run. Payment problems are untestable on web. |
| Returning poster; first bounty with no claims | `abandonment-recovery` | — |
| New hunter; hunter returning from a notification; inactive hunter receiving an alert | `hunter-notification-return` | Push delivery itself cannot be simulated; the run tests the landing → detail → apply path only. |
| Hunter on a task that changes state; payout status; returning successful hunter | — | Not run this round (`race-claim`, `hunter-payout` exist in the registry). |

---

## 8. Ranked findings

Severity: **P0** stops the marketplace from producing successful first transactions; **P1** is a major conversion or retention failure; **P2** is a real defect or meaningful UX issue; **P3** is polish or instrumentation.

Each finding carries: evidence, a reproduction or query, a proposed fix, effort, and **the observable that proves it fixed** (the standing rule: done means new rows or events, not a merged PR).

### SBA-01 · P0 · Every open listing is abandoned, and hunters keep applying to them

*Maps to HUNT-01, POST-01.* [Observed]

- **Evidence:** 16 open external bounties as of 2026-10-15. Each poster's last session was the day they posted or a few days after; three have shown no activity since June–July. Those listings received **98 applications in the last 14 days** (`ed0671d2` "Walk my dog" 20, `49894a86` "Take lecture notes for me" 20, `11af999b` 13, …). All of them will be closed by `system_expiry`. 12 of the 15 in-person listings among them have no location at all.
- **Why it matters:** this is the hunter's whole first experience. 84% of applicants have only ever been closed out [Cowork]; the reason is that the feed is made of listings no one will read.
- **Existing fix, never used:** `fn_sweep_absent_posters(p_dry_run, p_absent_days)`, built on 2026-09-25, has **0 rows** in `absent_poster_sweep_runs`, and there is no cron job for it. Today's dry run (read-only transaction): **archive 10 external bounties, closing 31 pending applications from 25 hunters; flag 2 funded internal bounties (20 requests) for review.**
- **Gap in that fix:** it acts only on bounties with pending applications. Dead listings whose requests already expired (e.g. `51cad7d5`, `76ce4d21`, `797f26b3`) stay open and appliable.
- **Fix:**
  1. Run the sweep once (**needs your go**: prod write that also notifies 25 hunters).
  2. Schedule it daily.
  3. Extend it, or add a sibling job, to hide or close any open listing whose poster has had no activity for N days, whether or not requests are pending.
  4. Optionally cap an unanswered listing's life (e.g. 14 days) with a "still need this?" prompt to the poster before closing.
- **Effort:** S (run + cron), M (extension).
- **Done when:** `absent_poster_sweep_runs` has rows daily, and this returns 0:

```sql
SELECT count(*)
FROM bounties b
JOIN profiles p ON p.id = b.poster_id
WHERE b.status = 'open'
  AND b.is_test IS NOT TRUE
  AND p.is_internal IS NOT TRUE
  AND COALESCE(p.last_session_at, b.created_at) < now() - interval '14 days';
```

### SBA-02 · P0 · In-person jobs are shown to, and applied for by, people who cannot do them

*Maps to LIQ-01, POST-03.* [Observed]

- **Evidence:**
  - The feed's distance filter defaults to `DISTANCE_OFF` ("Any distance — Browse every open bounty", `components/bounty-feed.tsx:126-138`).
  - `lib/utils/serviceable-region.ts` gates nothing.
  - The `bounty_requests` BEFORE triggers check only open-target and ID requirements.
  - The applicant card (`components/applicant-card.tsx`) shows no distance, and the list is ordered newest-first (`bounty-request-service.ts:194`).
  - **Measured:** 22 applications to genuine in-person bounties that carry a location; 18 with a hunter location; **0 within 50 miles; median 1,504 miles.** Across all external applicants, 224 of 329 have a profile location, so distance is computable for most.
- **Why it matters:** a poster who opens "10 applicants" for "Mount my TV" sees ten people who can't come, with nothing on screen to tell which. Inaction is the rational response. [Inferred] This is a stronger explanation for POST-01 than notification fatigue alone.
- **Fix (product decision on hard vs soft):**
  1. For hunters with a location, default in-person results to a radius (e.g. 25 mi) and always include online jobs.
  2. Show "~N mi away" (approximate, from the existing privatized geoms) on the applicant card and sort local first.
  3. On the server, either refuse an in-person application from beyond X miles, or stamp it `is_far` and collapse those under "Not nearby".
  4. Hunters with no location: prompt for a ZIP before applying to in-person work.
- **Effort:** M.
- **Done when:** the share of new applications to genuine in-person bounties from within 25 miles is measurable and rising (the distance query in [Appendix A](#appendix-a--queries) run weekly). PostHog `application_accepted.applicant_distance_mi` exists (ANLT-03).

### SBA-03 · P1 · One-tap templates publish title-only, low-intent bounties

*Maps to POST-01, POST-05.* [Observed], intent [Inferred]

- **Evidence:**
  - Of 19 genuine bounties since 09-10, **12 carry an exact template title** from `TASK_TEMPLATES` (`app/screens/CreateBounty/quick/StepTask.tsx:51-64`), 11 of those have no description, and 16 of the 19 have none. They drew **222 applications**.
  - Posting pattern: 11 of 17 genuine posters published within an hour of signing up [Cowork]. Account `95c3fa39` published five in six minutes ("Assemble my furniture", "Hold my spot in the merch line", "I want to make everyone happy", "Im from naujaat nu", "Take lecture notes for me") and never returned.
- **Mechanism:** `handleTemplate` sets title, category and price and calls `onNext()`. The only remaining gates are a location and a pre-filled price. Description is optional and offered only after publishing.
- **Fix:**
  1. A template tap pre-fills the title but stays on step 1, asking one required line ("What exactly, and when?").
  2. Require a minimum description (e.g. 20 characters) for in-person posts.
  3. Limit a new account to 2 open bounties in its first 24 hours.

  Do not remove templates. They are a reasonable way to show range; they just shouldn't be a four-tap path to a live listing.
- **Effort:** S.
- **Done when:** the share of new genuine bounties with a non-empty description is about 100%, and applications per bounty that never gets a poster action falls (before/after cohort; no A/B at this volume).

### SBA-04 · P1 · Poster reminders flood absent posters with no cap

*Maps to POST-03.* [Observed]

- **Evidence:** `fn_remind_posters_of_pending_requests` (prod body = git `20260913000000`) inserts one outbox row **per application** at 1 h and 24 h, never bundled and never stopped.
  - 60 days: **817 reminders to 21 users, 17% read**.
  - `ed0671d2`: 101 reminders to one poster over 21 days, up to 10 a day, **0 read**.
  - Poster `95c3fa39`: 248 poster-facing notifications, up to 38 in one day, 0% read.
- **Fix:**
  1. Reminders per **bounty**, not per application ("3 people applied to Walk my dog"), at most two per bounty in total.
  2. Stop all reminders once the poster has had no session for 72 hours, and hand off to the sweep (SBA-01) or a single email.
  3. Keep the 10-minute bundling on `application`.
- **Effort:** S (one migration).
- **Done when:** in the 7 days after deploy, the maximum `application_pending_reminder` count per (user, bounty) is ≤ 2 and per (user, day) is ≤ 2.

### SBA-05 · P1 · Nobody hires under pay-at-accept

*Maps to POST-04.* [Observed], causation unproven.

- **Evidence:** since 09-02 every paid app bounty is `at_accept`. **0 of 17** genuine at_accept bounties were hired; **2 of 4** fund-at-post bounties were (one app bounty from 09-01, one web bounty from 10-11). [Cowork] 5 accounts reached the accept sheet in 45 days. None pressed "Confirm & hire" or "Pay & hire" (`accept_funding_started` = 0; see the DQ-06 correction in §3), 4 abandoned it, and 1 had an acceptance attempt refused for insufficient funds.
- **What is not the problem:** clarity. The post-time and hire-time copy is accurate and the gate is a single sheet.
- **Confounding:** most at_accept posters never reached the hire step at all (SBA-01/02/03). Pay-at-accept removes the one commitment signal at post time, which [Hypothesis] is part of why template posts dominate.
- **Decision for you** (no A/B at this scale; pick one and measure before/after):
  - **(a) Fund-at-post for first-time app posters**, with the promise "if nobody you'd hire applies within 7 days, cancel for a full refund". This matches the only cohort that has hired.
  - **(b) Keep at_accept, but require a saved card at post** (no charge) so hiring is one tap.
  - **(c) Keep as is** and rely on SBA-01–04 to fix the hire step.

  The undeployed `posting-service-fee` work (2026-09-21, fee + reward up front) is a variant of (a).
- **Done when:** whichever option ships, `bounty_requests` shows the first `rejection_source = 'poster'` or `status = 'accepted'` rows on genuine bounties posted after the change.

### SBA-06 · P1 · A first-time poster spends their patience before reaching the composer

*Maps to POST-05 (re-scoped).* [Shoal], code [Observed]

- **Evidence:** 0 of 6 `poster-conversion` agents published within 40 steps. Friction in order:
  - password rules revealed only after submit (4/6);
  - location permission asked twice (onboarding, then again);
  - founder note with no button for about 8 s (2/6 read it as frozen);
  - [web, unconfirmed] an ID-and-selfie prompt on the first "Post" tap, returning to the feed on "Later".
- **Fix:**
  1. Show the full password rule in the field hint.
  2. Make the founder-note CTA visible from the start (keep the animation, drop the wait), or skip the note for posters.
  3. Ask location once.
  4. Reproduce the first-Post-tap interception on a device. If it happens, suppress trust prompts until after the first publish.
- **Effort:** S.
- **Done when:** a `poster-conversion` Shoal run reaches `bounty_published` on staging (the oracle row exists), and PostHog shows the median `onboarding_completed` → `bounty_started` gap falling.

### SBA-07 · P2 · Zip and service-area alerts silently lost relevance scoring

*Maps to NOTIF-01, TRUST-01.* [Observed]

- **Evidence:** `20260912142307` routed all three geo triggers through `fn_score_and_dispatch_bounty_notification`. **One day later** `20260913010000_bounty_test_flag_and_internal_profiles.sql` re-created `fn_notify_zip_matched_bounty` and `fn_notify_service_area_matched_bounty` from an older body that inserts directly into `notifications_outbox`. `20260915055616` and `20261001140000` copied the reverted body forward. Production matches git.
- **Consequence:** these two paths have no reach cap, no per-bounty dedup (`bounty_hunter_notifications`), no hourly anti-burst, no "already applied" exclusion, and (zip) no `deleted_at` filter. The distribution gate still applies, so this is not a fraud hole. Reach since 09-13 is **1 recipient**, but it scales with location capture.
- **Fix:** one migration restoring the scored dispatch inside the gated bodies, plus a test that asserts all three triggers call the dispatcher.
- **Effort:** S.
- **Done when:** new `bounty_nearby` outbox rows with `match = 'service_area'` or a `zip_code` key each have a matching `bounty_hunter_notifications` row.

### SBA-08 · P2 · "Username available" is always true

[Observed]

- **Evidence:** `profiles` SELECT policies are self-only on prod and staging, so `isUsernameUnique` (`lib/services/userProfile.ts:63`) can never see another user's row and returns `true` for every name. It also runs for signed-in profile edits (`userProfile.ts:331`).
- **Fix:** a `SECURITY DEFINER` RPC `is_username_available(text) RETURNS boolean` (rate-limited, granted to `anon` and `authenticated`, returning only the boolean). Do not widen `profiles` RLS.
- **Effort:** S.
- **Done when:** on staging, typing an existing username shows "taken" before submit (Shoal `auth` scenario or a jest test against the RPC).

### SBA-09 · P2 · Hunters get one closure notice per application

*Maps to HUNT-01.* [Observed]

- **Evidence:** in 60 days, 289 `application_expired` notices (138 users) + 172 `application_bounty_closed` (128) vs 17 `acceptance`. Expiry also emails: hunters `724272ba`, `8a937070` and `524b8f7e` each got 5–6 expiry emails in a single day. The copy is already fair ("This wasn't a rejection").
- **Fix:** one daily digest per hunter for closures, listing up to three live, local alternatives (after SBA-01, so those alternatives are real).
- **Effort:** M.
- **Done when:** maximum closure notifications per hunter per day ≤ 1.

### SBA-10 · P2 · Neither side is told how this goes, and the stuck poster's exits are hidden

*Maps to POST-02, POST-04, HUNT-01.* [Observed] + [Shoal]

- **Poster, after publishing:** `PostCelebration` says "When someone steps up to help, we'll let you know". It never says that applications usually arrive within hours, that the poster chooses, that they pay only then, or that **applications close after 3 days**.
- **Poster's Inbox** opens on the hunter-side "My Work" tab (S2).
- **A stale listing's screen** offers only "Edit details". Delete-with-refund exists, but only as a trash icon on the inbox row. Its save path masks every server error as "update failed" (S9).
- **Hunter, after applying:** told nothing about the 3-day window or what happens if the poster never answers (S8).
- **Review-window copy** promises "Bounty support is reviewing this", but the backing migrations are applied nowhere (S10).
- **Fix:**
  1. A "What happens next" card after publishing and on the hunter's application status.
  2. Inbox defaults to My Bounties for accounts with open posts.
  3. A visible "Cancel and refund" on an open bounty with no hire.
  4. `bountyService.update` returns or throws the server message.
  5. Hide the review-window copy until its migrations are live.
- **Effort:** S–M.
- **Done when:** PostHog `applicant_list_viewed` within 24 h of the first application rises for new genuine posters; poster deletes show up as `bounty_events` cancellations rather than abandonment.

### SBA-11 · P3 · Test bounties leak into search autocomplete

[Observed]

- `bountyService.search` has no `is_test` filter; 7 test bounties are open on prod.
- **Fix:** add `.eq('is_test', false)` unless the viewer is internal, mirroring `searchWithFilters`.
- **Done when:** a jest test pins the filter.

### SBA-12 · P2 (web) · `?screen=` deep links are dropped by expo-router

[Observed on web; native unverified]

- See S1. "Review hunters", the `application` notification landing and `?screen=wallet` all land on the feed on web.
- **Fix:** rename the param (e.g. `tab=`) in `bounty-app.tsx`, accepting `screen` as a fallback for old links, and update `REQUESTS_ROUTE`, `POSTER_REQUESTS_PATH` and the wallet links.
- **Verify on a device** that native is unaffected. If native is also affected, this becomes **P0** (posters could not reach applicants from a notification).
- **Done when:** the scripted reproduction (`repro-review-hunters.mjs`, see [Appendix B](#appendix-b--reproduction-scripts)) lands on My Bounties.

### SBA-13 · P3 · Analytics that mislead the funnel

*Maps to ANLT-01/02/03/06.* [Observed]

- **(a)** `signup_completed` comes from the email form only. Emit it on Apple/Google first sign-in too, ideally server-side on profile creation.
- **(b)** Persist `primary_role` at role select, not only at onboarding completion.
- **(c)** Treat `accept_funding_started` as "pressed the button" in dashboards; it is not misnamed.
- **(d)** `poster_interacted_at` excludes list views. Use `applicant_list_viewed` for "looked".
- **(e)** `bounties.quality_score` orders nothing (unchanged since 09-25).
- **(f)** Repoint the stale insights `kSuLqUW9`, `4uD0jw2s`, `LGVfGTTI` [Cowork].

### SBA-14 · P2 (tooling) · Shoal cannot run on `main`

[Observed]

- The web export fails until PR #913 (`applyGlobalFont.web.ts`) merges, so the nightly Shoal workflow has never produced a run on current code.
- This audit also fixed `run.mjs`'s false "the address bar works" instruction and added two scenarios (`poster-first-hire`, `hunter-notification-return`).
- **Done when:** a scheduled `shoal.yml` run uploads artifacts.

### Not findings: verified as already working

- **The anti-scam gate:** 0 fraud alerts since the week of 09-28.
- **Required location on new posts:** 4/4 genuine since 10-06.
- **The geocode cron:** 262 successful runs in 7 days.
- **The pay-and-hire sheet:** server-authoritative amounts, server re-check after deposit, explicit "charged now".
- **Exact-address privacy.**
- **Hunter expiry copy.**
- **Notification deep-link routing on native** (per Cowork's open → view numbers).
- **The Liquidity Board** for concierge work.

---

## 9. Remediation plan (sequenced)

Ordering rule: **server-side changes first**, because they reach every installed build immediately. Client changes ride the next native build: 2.1.3 already needs one, and OTA reach depends on fingerprint compatibility (see `docs/deployment/RELEASE_READINESS_2.1.3_2026-10-13.md`). Every production write below needs an explicit go.

| # | Change | Finding | Type | Gate | Observable that proves it |
|---|---|---|---|---|---|
| 1 | Run `fn_sweep_absent_posters(false, 14)` once; schedule it daily | SBA-01 | Prod write + cron | **Your go** (closes 31 applications, notifies 25 hunters; re-run the dry run first) | `absent_poster_sweep_runs` rows; dead-listing count query → 0 |
| 2 | Extend the sweep to dead listings with no pending requests | SBA-01 | Migration | Staging, then prod | Same query stays 0 a week later |
| 3 | Per-bounty reminder digest, ≤ 2 per bounty, stop after 72 h of poster absence | SBA-04 | Migration | Staging verify, then prod | Max reminders per (user, bounty) ≤ 2 over 7 days |
| 4 | Restore scored dispatch on the zip/service-area triggers | SBA-07 | Migration | Staging verify, then prod | New zip/service-area outbox rows have `bounty_hunter_notifications` rows |
| 5 | Merge PR #913 | SBA-14 | Merge | Review | A nightly `shoal.yml` run uploads artifacts |
| 6 | Concierge each new genuine poster from the Liquidity Board within 2 h of the first application | POST-02 | Ops | None | Cowork's `concierge_contacted` log; first poster decision rows |
| 7 | Distance on applicant cards, local-first sort, in-person feed radius default, far-application flag | SBA-02 | Client + migration | Product decision: block vs flag | Share of in-person applications within 25 mi |
| 8 | Template tap requires one line of detail; new accounts ≤ 2 open bounties in 24 h | SBA-03 | Client (+ policy trigger) | Product OK | Description coverage on new genuine posts ≈ 100% |
| 9 | "What happens next" for both sides; Inbox defaults to My Bounties for posters; visible Cancel and refund; surface update errors; hide unbacked review-window copy | SBA-10 | Client | None | `applicant_list_viewed` within 24 h rises |
| 10 | `is_username_available` RPC; autocomplete `is_test` filter; rename the `screen` param | SBA-08/11/12 | Migration + client | None (device-check SBA-12 first) | Repro script lands on My Bounties; jest pins |
| 11 | Funding mode for first-time posters: option (a), (b) or (c) | SBA-05 | Product decision | **Yours** | First `poster` decision rows on genuine bounties posted after the change |
| 12 | Onboarding: password hint, founder-note CTA without wait, single location ask; device-check the first-Post interception | SBA-06 | Client | None | Shoal `poster-conversion` publishes on staging |
| 13 | Daily closure digest for hunters | SBA-09 | Server | Staging verify | ≤ 1 closure notice per hunter per day |
| 14 | Analytics fixes (a)–(f) | SBA-13 | Client + PostHog config | None | `signup_completed` per new profile ≈ 1 (vs ~19% today [Cowork]) |

**What not to do yet** (agreeing with Cowork): no hunter acquisition, no new notification types to hunters, no urgency banners to posters, no A/B tests at about one genuine post a week.

---

## 10. Limitations and what still needs verifying

- **PostHog was not queried.** Figures tagged [Cowork] (role funnels, open → view rates, signup capture, the replay themes) are quoted, not verified. Cowork's own caveat applies: the replay summaries are AI-generated and were not human-viewed.
- **Shoal tests the Expo web export**, which no customer uses. Web-specific outcomes (S1 on native, the first-Post interception, SecureStore) need device runs. The agents' 1024×768 window is not a phone; the scripted reproductions used 390×844.
- **Stripe is stubbed on web**, so card-funded hiring, deposits and payouts were not exercised. Pool posters held $500 of test balance, which would have used the "Confirm & hire" variant; no agent got that far because of S1.
- **Seed state shapes the hire-side runs.** Slot 03 had no pending application, and pool conversations are shared across bounties. Findings that depended on that were discarded (§7).
- **Not identified:** the server reason behind the staging "update failed" (S9) and the ID-verification fetch failure (TRUST-02). Both need request or function logs.
- **Small numbers.** Genuine volume is about one post a week. Every rate here is directional; hire-rate comparisons (0/17 vs 2/4) are not significant and are confounded.
- **Population drift:** the "genuine" filter uses the *current* `account_status`, so a poster banned later is reclassified retroactively (same as Cowork).
- **Nothing was deployed or applied.** Code changes in this audit are QA tooling only: `qa/shoal/bin/run.mjs` (the post-sign-in navigation instruction), `qa/shoal/scenarios/scenarios.json` (two scenarios + an optional `navigationHint` field), and `qa/shoal/repro/review-hunters.mjs`. Harness tests: 65/65.

---

## Appendix A · Queries

Run read-only (`BEGIN READ ONLY … ROLLBACK`). In each, `genuine` is the population filter from the top of this report:

```sql
WITH b AS (
  SELECT b.*, COALESCE(b.poster_id, b.user_id, b.former_poster_id) AS owner
  FROM bounties b
)
SELECT b.*
FROM b
LEFT JOIN profiles p ON p.id = b.owner
LEFT JOIN bounty_moderation m ON m.bounty_id = b.id
WHERE p.is_internal IS NOT TRUE
  AND b.is_test IS NOT TRUE
  AND COALESCE(m.state, '') <> 'removed'
  AND COALESCE(p.account_status, 'active') NOT IN ('banned', 'suspended')
  -- add: AND p.id IS NOT NULL  to match Cowork's 27/17 (excludes ownerless legacy rows)
```

**Poster decisions on genuine applications** (SBA-01, POST-01):

```sql
SELECT r.status, COALESCE(r.rejection_source, '-'), (r.poster_interacted_at IS NOT NULL), count(*)
FROM bounty_requests r
JOIN genuine g ON g.id = r.bounty_id
LEFT JOIN profiles hp ON hp.id = r.hunter_id
WHERE r.created_at >= '2026-09-13'
  AND hp.is_internal IS NOT TRUE
GROUP BY 1, 2, 3;
```

**Distance from applicant to in-person job** (SBA-02):

```sql
SELECT count(*) AS apps,
       count(*) FILTER (WHERE hp.geom IS NOT NULL) AS measurable,
       count(*) FILTER (WHERE ST_Distance(g.geom, hp.geom) <= 50 * 1609.344) AS within_50mi,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_Distance(g.geom, hp.geom) / 1609.344) AS median_mi
FROM bounty_requests r
JOIN genuine g ON g.id = r.bounty_id
JOIN profiles hp ON hp.id = r.hunter_id
WHERE g.work_type = 'in_person'
  AND g.geom IS NOT NULL
  AND hp.is_internal IS NOT TRUE;
```

**Reminder load per bounty** (SBA-04):

```sql
SELECT n.data->>'bountyId' AS bounty,
       count(*) AS reminders,
       count(DISTINCT n.created_at::date) AS days,
       count(*) FILTER (WHERE n.read) AS read
FROM notifications n
WHERE n.type = 'application_pending_reminder'
  AND n.created_at > now() - interval '60 days'
GROUP BY 1
ORDER BY 2 DESC;
```

**Relevance alerts by bounty class and week** (TRUST-01): `bounty_hunter_notifications` joined to the class CASE (internal / test / fraud_banned / genuine), grouped by `date_trunc('week', created_at)`.

**Absent-poster sweep dry run** (SBA-01):

```sql
SELECT bounty_action, poster_is_internal,
       count(DISTINCT bounty_id), count(*), count(DISTINCT hunter_id)
FROM fn_sweep_absent_posters(true, 14)
GROUP BY 1, 2;
```

**Template posts** (SBA-03): genuine bounties since 09-10 whose `trim(title)` is in the `TASK_TEMPLATES` titles, with `NULLIF(trim(description), '') IS NULL`.

## Appendix B · Reproduction scripts

`qa/shoal/repro/review-hunters.mjs` signs into staging pool poster 04 on the served web export, opens `/postings/<bounty>`, taps "Review hunters", and prints the resulting URL and whether the feed or the inbox is showing. It is read-only (no accept or decline). Expected after SBA-12 is fixed: the URL keeps the tab param and "My Bounties" is visible.

```bash
npm run qa:shoal:web -- --skip-build          # staging export on :8090
export BOUNTY_SHOAL_POOL_SECRET=...           # same secret as seed.mjs
node qa/shoal/repro/review-hunters.mjs 14691d2d-396b-4067-8c2e-5bb1600bb294
```
