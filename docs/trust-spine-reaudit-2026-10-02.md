# Trust Spine Re-audit — 2026-10-02

**Question (unchanged):** could a skeptical first-time user reasonably feel safe completing a $100 transaction with a stranger through Bounty?

**Answer: not yet.** The server-side fixes that were applied hold up under attack. 72 of the 87 exploit, legitimate-flow and recovery probes behaved correctly, and every original P0 *exploit* that was re-run against staging was refused. But this audit passes only when system behavior and user-facing promises agree, and four things break that:

1. **Production is not running the escrow fix.** Every edge-function deploy since at least 2026-09-25 has failed. The live `wallet` and `bounty-payments` functions are the 2026-09-18 builds, with no refund gate. On production a poster can still pull escrow back after a hunter is hired (T4).
2. **The silent-poster fix is applied nowhere, but its promise is already in the app.** On `main`, both sides are told "the poster didn't respond… so Bounty support is reviewing your work". No cron, queue or alert exists on staging or production. Staging has 20 overdue submissions, all labelled "being reviewed", and none is.
3. **A hired hunter is told they were not hired.** When the hunter's own application row hasn't loaded, the hunter-side status resolver shows the accepted hunter "REJECTED · Another hunter was selected · Nothing is owed either way". Reproduced in the scripted walkthrough and, independently, by a Shoal agent signed in normally (new finding).
4. **Several integrity holes the fixes were meant to close remain open on both environments.** Strangers can attach completion submissions to other people's jobs. Posters can rewrite the accepted application row. Any signed-in user can send another user a "security" push notification with arbitrary text. Suspending an account leaves its live listings up and open to applications.

Method, scope and evidence are in §8. Nothing was changed in production. All production reads were catalog or aggregate queries.

---

## 1. P0 status (the original seven)

A P0 counts as fixed only when the exploit or failure has been shown to no longer occur.

| # | Original finding | Staging (audited build) | Production | Verdict |
|---|---|---|---|---|
| T1 | Liquidity escalation pushed scams to 25–60 hunters | Gate applied. `verify-anti-scam-gate` **92/92** (rolled-back transaction: fixtures for flagged, reported, new-poster and suspended-poster bounties are suppressed; a credible bounty escalates) | Gate applied (`20261001140000`). Last "Still looking" push was 2026-09-29. `bounty_distribution_decisions` has **0 rows**: the gate has never made a decision on real traffic (only 2 internal listings since it was applied) | **Fixed, not yet observed live** |
| T2 | Scanner missed payment-proxy scams; reports did nothing | Same suite (scam rules + report-driven review) | Scam `0b9e1e8a` is `removed`/`deleted`; the 3 fraud reports are `resolved`/`reviewed` | **Fixed, not yet observed live**. Rule recall was measured on 7 known scams, with no holdout |
| T3 | Exact address readable by every signed-in user | **Fixed and demonstrated.** A poster saved "4127 Painters Mill Road…" with 7-decimal coordinates; the public row stores "Owings Mills, MD" with lat/lng `NULL`. Strangers, applicants and anon get nothing from the table, `bounty_private_locations` or `get_bounty_exact_location()`; the accepted hunter gets the exact address (SEC-ADDR-1…8, LEGIT-ADDR) | Migration applied 2026-10-02 (38 rows moved) | **Fixed** |
| T4 | Poster can refund 100% of escrow at any time; can PATCH `accepted_by` | **Fixed and demonstrated** for the exploits in the original audit. Refund after acceptance → `409 refund_requires_cancellation_or_dispute`, balance unchanged. Refund during dispute → 409. Release to a stranger → 403 `hunter_mismatch`. Reassign, cancel, reopen and delete on a committed bounty → `42501` (SEC-REF-1…4, SEC-REL-1/2, SEC-ACC-1…6) | DB guard is live, but **the deployed `wallet` (v69) and `bounty-payments` (v36) are from 2026-09-18 and contain no refund gate** (`fn_owner_refund_block_reason` is never called). Owner refund after acceptance is still possible on prod (*definition-verified from deployed source; not exercised, real money*) | **Fixed on staging, OPEN in production** |
| T5 | Anyone can create and self-resolve disputes on any bounty | **Fixed and demonstrated.** A stranger's dispute → `dispute_requires_bounty_participant`. Disputes pre-set to a resolution → `dispute_must_open_undecided`. A participant PATCHing status → 0 rows, bounty unchanged. Delete → refused. A stranger escalating → refused. A legitimate dispute and escalation work (SEC-DSP-1…8, LEGIT-DSP/ESC) | Same migration applied | **Fixed**. Money settlement is still client-side (T13) |
| T6 | Hunter has no path to payment if the poster goes silent | **Not fixed.** `fn_process_completion_review_window`, the cron job and `trust_review_queue` don't exist (FR-SILENT-POSTER-1). The fix works inside a rolled-back transaction (`verify-escrow-recourse-review-window` **134/134**) but has never been applied | Not applied. `eccfddee` is still pending: **45 days** | **Not fixed, and the UI now claims it is** (§3, N2) |
| T22 | Poster has no working recourse when the hunter vanishes | **Route works end to end.** Server: the poster can open a dispute with no cancellation request (FR-SILENT-HUNTER-1), and the owner refund is refused so the dispute is the path (FR-SILENT-HUNTER-2). UI: Cancel → "Report a problem instead" → "Hunter hasn't responded" → submitted. A Shoal agent did this unaided; dispute #94 exists. **But** nothing routes it to a human (no queue, no alert; FR-SILENT-HUNTER-3), and the screen promises "reviewed by our team within 24-48 hours" with nothing behind it | DB recourse is the same. Queue not applied | **Partially fixed**: the dead end is gone, the follow-through isn't |

**P0 summary:** 3 fixed and demonstrated (T3, T5, and T4 on staging), 2 fixed but unobserved on live traffic (T1, T2), 1 partially fixed (T22), 1 not fixed (T6). **T4 is still open in production** because the edge deploy pipeline is broken.

## 2. P1 status

| # | Finding | Status | Evidence |
|---|---|---|---|
| T7 | Ratings forgeable | **Fixed** (staging; content live on prod without a ledger row) | Stranger, mid-job, nonexistent-bounty, no-bounty, forged-`from_user_id`, out-of-range and duplicate ratings are all refused. Edit and delete are refused. Ratings in both directions work after completion and are stamped `verified_at` (SEC-RAT-1…12, LEGIT-RATE-P2H/H2P). `verify-rating-integrity` 68/70: the 2 failures are a harness artifact (the suite assumes a pre-backfill DB) |
| T8 | "Posted 2h ago" hard-coded | Fixed in source | `bountydetailmodal.tsx` now uses `created_at`; screens show "5d ago", "2m ago" |
| T9 | Proof slide shows fake completed/paid jobs | Fixed in source | `COMPLETED / paid out / 4.9` stamps removed |
| T10 | Hunters can't judge poster legitimacy or funding | **Fixed** | Bounty page shows "Payment held / Payment not held yet / No payment hold" and "About the poster: Joined 28 days ago · No completed bounties yet". Shoal hunters used it to decide ("RED FLAG (brand new user)"). `verify-bounty-funding-status` 19/19 |
| T11 | Client fixes never reach devices (OTA blocked) | Not re-verified | Every client fix in this table is unverified on devices |
| T12 | Suspended accounts can post | **Fixed for new posts**; new gap (N4) | Insert and apply as a suspended account → RLS refused (SEC-SUSP-1…3) |
| T13 | Dispute money is client-orchestrated | **Not fixed** | `dispute-service.ts` still settles from the admin device. Prod dispute #19 is `resolved_hunter_wins` with no release row. On staging, admin hold release fails (`fn_close_dispute_hold` has two overloads → `PGRST203`) |
| T14 | Posters anonymous to hunters | Partly fixed | Join date and completed count shown. An unverified profile shows no verification state at all, so Shoal posters couldn't tell "unverified" from "not shown" |
| T15 | `bountyfinder.app` fails TLS | **Not fixed** | `curl` → schannel `SEC_E_ILLEGAL_MESSAGE` |
| T23 | Unearned badges on others' profiles | Fixed in source | `milestone-badge-chips.tsx` filters to earned on other profiles |
| T24 | "1 review" that can't be read | Fixed in source | Not observed (no star-only reviews on test accounts) |
| T25 | Posters pushed into Stripe payouts at signup | Fixed in source | `next-step-after-role.ts`: posters skip to founder note |

P2 items: T17 has **grown** (7 withdrawals / $106.40 shown `completed` while `stripe_pending`, up from 5 / $76.40). T19 hunter→poster ratings now work server-side. T16, T18 and T20 were not re-tested.

## 3. New findings

| ID | Sev | Finding | Evidence | Scope |
|---|---|---|---|---|
| N1 | **P0** | **Edge-function deploys have failed on every run since ≥2026-09-25**, so production money endpoints lack the T4 refund gate. The last failures were the RLS pre-deploy gate refusing a stale manifest. The manifest has since been fixed (`check-rls-policies --env production` → OK today), but no deploy has re-run because later commits didn't touch `supabase/functions/` | `gh run list`: 6/6 failed. Prod `wallet` v69 / `bounty-payments` v36 `updated_at` 2026-09-18, 0 references to the gate | Prod |
| N2 | **P0** | **The hired hunter is told they weren't hired.** `resolveHunter` (`lib/utils/bounty-lifecycle.ts:706`) treats the viewer as selected only when `requestStatus === 'accepted'` and ignores `bounty.accepted_by === viewerId`. Three paths feed it a non-accepted status: (a) `app/bounty/[id]/public.tsx:199` hard-codes `'pending'`; (b) the WORK list card starts `null` and keeps `null` when the fetch fails (`getAll` swallows errors into `[]`); (c) the hunter payout, review and work screens query with `getCurrentUserId()` before auth hydrates (placeholder `00000000-…0001`), get `[]`, and redirect to (a) | Walkthrough `H04`/`H07` (REJECTED · "Nothing is owed either way"). Network log: `bounty_requests?…hunter_id=eq.00000000-0000-0000-0000-000000000001 → []`, then redirect. Shoal: **4 of 4 hunter agents** that opened My Bounties → WORK (scenario 2: 1/3; scenario 4: 3/3), all signed in through the login form, saw their own accepted jobs as "REJECTED · FILLED · Another hunter was selected · Nothing is owed". For one agent the card later flipped to "SUBMITTED FOR REVIEW" once the request row loaded | `main` (since 09-28). Device exposure unverified. On native the likeliest trigger is a cold start from a push deep link (the rating-prompt push opens the payout screen) |
| N3 | P1 | **The review-window promise is shipped without the review window.** `lib/utils/review-deadline.ts` renders "Bounty support is reviewing your work" or "…is reviewing this" once 72h pass, from the device clock. No server process does that. The same copy appears in `dispute-reasons.ts` ("support reviews it anyway") | Walkthrough `H04b`, `P08`. Shoal: "Your review window closed Sep 13… so Bounty support is reviewing this" on a 19-day-old item. Staging: 20 overdue pending submissions, no queue | `main` client. Staging + prod server |
| N4 | P1 | **Suspension doesn't take a poster's listings down.** Existing open listings stay visible, hunters can still apply, and the suspended poster can still edit them | SEC-SUSP-4/5/6 (200, 201) | Staging; prod uses the same policies |
| N5 | P1 | **Assignment and submission integrity gaps.** A poster can rewrite the accepted application's `hunter_id` or flip it to `rejected`. Any user can insert a completion submission on someone else's job. A hunter can backdate `submitted_at` (forging the review clock). A hunter can submit work on a cancelled bounty | SEC-ACC-7/8, SEC-SUB-1, FR-SUB-CLOCK, FR-CANCEL-6b (all 200/201) | **Staging and prod** (identical policies). The fix exists in `20261002120000` (verified in a rolled-back transaction) but is unapplied |
| N6 | P1 | **Spoofable "security" notifications.** `send_system_notification` (SECURITY DEFINER) is executable by `authenticated` and takes any recipient, title and body, category `security`, and enqueues a push | NEW-NOTIF: a stranger sent "Bounty Security: Your payouts are frozen. Verify your bank at bounty-verify.example" → 1 `notifications` row + 1 `notifications_outbox` row | **Staging and prod** (EXECUTE granted on both) |
| N7 | P1 | **The poster's escrow copy names the wrong person and claims a hold that doesn't exist.** On an open bounty with no hire: "Held safely in escrow. It's released to shoal_poster_04 (the poster) only when you approve the work", next to "You're charged only when you accept" | Walkthrough `P02` | `main` client |
| N8 | P2 | The poster's in-progress card still says "is working on it now" after 4 silent days, with no elapsed time or prompt. The poster's public page says "No one has applied yet" while 1 hunter has applied | `P05`, `P09` | `main` client |
| N9 | P2 | Staging drift. `apply_release_tx` (credits a caller-supplied amount) is executable by **anon** and authenticated on staging; prod is correctly revoked. Staging has a second `fn_close_dispute_hold(uuid)` overload with no admin check, executable by anon. It's unreachable through PostgREST only because of the overload ambiguity, which also breaks admin hold release on staging. Ledger drift: prod has rating-integrity and funding-status objects with no `schema_migrations` rows; staging has `130000`'s content with no row | NEW-RELEASE-TX(-ANON) → 200 `{"applied":false}` (executable). Catalog queries | Staging (and ledger on both) |
| N10 | P3 | QA harness drift. `qa/shoal/bin/seed.mjs state` now fails on the ID-requirement guard (it inserts applications as superuser). `verify-location-privacy` and `verify-rating-integrity` can't be re-run after apply (5 artifact failures). Shoal `--provider subscription` is Haiku-only and gave up in all 4 scenarios; the API key has no credit | Seeder stack trace; suite logs | Tooling |

## 4. Regressions

No *server* regression was found: every fix that is applied still holds, and the legitimate flows still work (accept, escrow, submit, revision, release, double-release blocked, approve, rate both ways, hunter cancellation → poster consent → refund, idempotent refund).

**Promise regressions.** The client now says more than the server does. N3 (review-window copy without the review window) and the "24-48 hours" dispute SLA are new or newly prominent claims with nothing enforcing them. When this client ships, the trust gap between the copy and the mechanics *grows*, even though the mechanics improved.

**Operational regression:** N1. The safety gate added on 10-01 to keep unsafe deploys out has, in practice, kept *every* deploy out, including the fix it was meant to protect.

## 5. Scenario results

### 1. Skeptical poster ("hire a stranger for $45")

| Question | Answered? | Where / quote |
|---|---|---|
| Who is the hunter? | Yes | Applicant card: name, "New to Bounty", pitch, View profile |
| Verified? | **Partly** | Earned badges show when verified; an unverified hunter shows nothing, so a skeptic can't tell absent from unknown (Shoal: "There's no information about identity verification anywhere") |
| Real transaction history? | Yes | "0 Jobs Completed", "Joined September 2026"; ratings are now transaction-verified (T7) |
| What happens to my money? | **Yes, with one error** | "$45 is held in escrow the moment you accept"; "Funds are held safely in escrow once you accept — no payment until you approve the work". Contradicted on the same screen by N7 |
| Address protected? | Yes, and enforced | "Petworth, DC" only; exact address only to the accepted hunter (T3) |
| What if the hunter disappears? | **Partly** | Route exists and works (T22); nothing escalates it; "24-48 hours" isn't backed |
| How to report a problem? | Yes | "Report a problem" on the card and on Cancel |
| Poor work? | Yes | Revision request works (FR-REVISION). The dispute still settles client-side (T13) |
| When does it resolve? | **No** | Shown as "Your review window closed… Bounty support is reviewing this", which isn't true (N3) |

Shoal: a poster agent hired a hunter through the real UI (hunter-03, 00:12:53). Escrow, the hire, and the bounty → `in_progress` were all correct server-side.

### 2. Skeptical hunter

| Question | Answered? | Where / quote |
|---|---|---|
| Is the job legitimate? | Partly | "Limited details · No scope or timing" warning on template posts; poster age and history |
| Who is the poster? | Yes | Name, join date |
| Meaningful reputation? | Yes | "Joined 3 days ago · No completed bounties yet" → agent: "RED FLAG (brand new user)" |
| Is payment funded/protected? | **Yes** | "Payment held" / "Payment not held yet — Bounty takes the payment from the poster when they choose a hunter, before any work starts" / "No payment hold" (all three seen) |
| Will I get paid? | Yes, but enforcement is staging-only | "released to your wallet when they approve the work". On prod the poster can still refund instead (N1) |
| When? | **Misleading** | "The poster didn't respond by…, so Bounty support is reviewing your work" (N3), and for some hired hunters "REJECTED… Nothing is owed" (N2) |
| What if the poster disappears? | **No** (no server mechanism) | Dispute only |
| What if scope changes? | Partly | "The poster changed the job" dispute reason; terms are locked after applications (pre-existing) |
| How to dispute? | Yes | "Report a problem" with reasons; "24-48 hours" unbacked |

### 3. Poster with a silent hunter

Recovery works end to end through the UI (dispute #94 submitted by a Shoal agent, refund correctly refused). What's missing: elapsed-silence information ("is working on it now" after 4 days, N8), any routing to a human, and any enforced timeline.

### 4. Hunter with a silent poster

Server: the dispute works (FR-SILENT-POSTER-2), and the poster can't claw the money back on staging (FR-SILENT-POSTER-3). Nothing ever escalates the overdue submission (FR-SILENT-POSTER-1), and the hunter is told support is already reviewing it (N3). Depending on load timing, they may instead be told they weren't selected (N2).

Shoal (3/3 agents): every hunter first saw the submitted job as "REJECTED · Another hunter was selected · Nothing is owed". One wrote: "This is the job I submitted proof for three days ago. The status shows 'REJECTED' which is concerning." When the card loaded correctly, the work screen still said "Congrats on being selected! Begin work on the bounty…" next to "SUBMITTED FOR REVIEW". "REVIEW & VERIFY" was locked with no explanation. The dispute modal says "Escrow funds remain frozen during review" and "An admin will review the dispute within 24-48 hours". On the other job, where the poster had filed dispute #94, the hunter correctly saw "Waiting on Bounty support — We'll notify both of you as soon as there's a decision."

## 6. Remaining trust gaps

1. **Production money endpoints don't enforce escrow commitment** (N1 → T4).
2. **Nobody owns the stalled middle of a transaction.** No review-window cron, no trust queue, no alert, no SLA, on either side (T6, T22 follow-through, N3), while the copy promises all of them.
3. **Hunter-side status is unreliable** (N2), on the single question hunters care most about.
4. **Integrity holes adjacent to the fixed ones** (N5, N6, N4).
5. **Dispute money still moves from an admin's phone** (T13); one prod dispute has been "won" with no money moved since May.
6. **Payout honesty**: withdrawals shown `completed` before Stripe settles have grown (T17).
7. **Live verification**: T1/T2 have never run on real traffic. T3/T7 client changes and every copy fix are unverified on devices (T11).

## 7. Recommended next work (in order)

1. **Re-run the edge deploy now** (workflow_dispatch on `main`). The RLS gate passes against prod today. Then confirm with `get_edge_function` that `wallet` and `bounty-payments` contain `fn_owner_refund_block_reason`. *Observed when:* a prod owner refund on an accepted bounty returns 409 (test with an internal account pair).
2. **Fix N2 in the resolver, not the screens.** In `resolveHunter`, treat `bounty.accepted_by === viewerId` as selected regardless of `requestStatus`. Make `public.tsx` pass the real request status. Make the three hunter screens wait for auth before loading (or re-run on user change). Add a unit test: accepted_by = viewer + requestStatus null → never "Another hunter was selected".
3. **Apply `20261002120000` then `20261002120100` to staging, then prod** (each with an explicit go). This closes N5, makes T6 real, gives T22 a queue, and turns the N3 copy true. *Until then, gate the N3 copy* behind a server signal (e.g. the queue row) so the client never claims a review that isn't happening.
4. **Revoke `send_system_notification` from `authenticated`** (N6). Check callers first: `dispute-service.ts:49` calls it from the client, so move those sends server-side.
5. **Suspension takes listings down** (N4): add `account_status` to `fn_bounty_moderation_visible`, and block applications/edits on a suspended poster's bounties.
6. **N7 copy**: on an open bounty, say "Nothing is held until you choose a hunter" and never name the poster as payee.
7. **Back or remove "24-48 hours"** (dispute screens, `lib/constants/support.ts`). Once the queue exists, alert on items older than 24h.
8. **T13**: server-side `admin_resolve_dispute` that settles money before status. Settle dispute #19. Drop the staging `fn_close_dispute_hold(uuid)` overload and revoke `apply_release_tx` on staging (N9).
9. **Ops**: resolve `eccfddee` (45 days); reconcile the 7 `stripe_pending` withdrawals.
10. **Tooling**: fix `seed.mjs state` to insert applications as the hunter (as this audit's seeder did), make the verify suites idempotent after apply, and top up the API key so Shoal can run on Opus.

## 8. Method, scope and evidence

- **Target:** staging (`gwumwpoomwvkjyibdmpj`) and a fresh web export of `main` @ `69f806ae`, served at `localhost:8094` (bundle checked: staging ref, `pk_test_`). Staging migrations through `20261002180000` are applied *except* `20261001130000` (content present, no ledger row), `20261002120000` and `20261002120100`. "All approved Trust Spine fixes implemented" is therefore **not** true of staging: the escrow/recourse/review-window fix was never applied. It is tested here in a rolled-back transaction only.
- **HTTP exploit probes** (`scratchpad/reaudit/probe.js`): 87 checks through PostgREST and the deployed staging edge functions, with real JWTs for throwaway `qa+shoal-*@bountyfinder.test` accounts (slots 06–08). **72 behaved correctly; 15 flagged.** 3 of the 15 aren't defects: DSP-6 was refused (overload ambiguity), FR-POSTER-REJECT is an allowed transition, and FR-CANCEL-5/6 were superseded by the corrected re-run (5b/6b). Fixture setup that no client can perform (suspending an account, backdating) used the staging superuser and is labelled. Fixture disputes were closed under a transaction-local admin claim on the reserved operator test account. Full table: Appendix A.
- **Rolled-back suites on staging:** anti-scam gate 92/92 · escrow/recourse/review window 134/134 (applies the unapplied migrations in-transaction) · funding status 19/19 · rating integrity 68/70 · location privacy 92/95 (5 failures are post-apply harness artifacts). RLS manifest check: staging OK, production OK.
- **Production (read-only):** migration ledger, function grants, policy definitions, deployed edge-function source, escalation/notification/dispute/withdrawal aggregates. No writes and no money moved.
- **Scripted UI walkthrough** (Playwright, 390×844, staging build): 20 screens, each with a screenshot and captured text (`scratchpad/reaudit/shots/`).
- **Shoal** (4 new scenarios in `qa/shoal/scenarios/scenarios.json`, swarm 3, slots 01–03, per-slot state seeded through the app's own API): artifacts in `qa/shoal/artifacts/2026-10-03T00-*-trust-reaudit-*`. The API key had no credit, so all runs used `--provider subscription` (Haiku). Every agent "gave up" before finishing, so Shoal's own finding counts are 0. The transcripts were still useful and are quoted above: the full hire flow, the full poster-recourse flow (dispute #94), and an independent reproduction of N2. **Shoal can't test payment** (web stubs Stripe); payment conclusions come from the HTTP probes.
- **Not covered:** native builds; OTA reach (T11); real Stripe (v2/v3) escrow paths; payout failure handling beyond reading prod aggregates; network failure beyond bad-token and idempotency retries.

### Appendix A — probe results

See `scratchpad/reaudit/probe-table.md` (copied into the published report).
