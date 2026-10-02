# Rating integrity: reputation earned only through real transactions

2026-10-02. Trust-spine audit items T7, T19, T24, S5, S7 (`docs/trust-spine-audit-2026-09-30.md` §8).

> Principle: reputation should be earned through real Bounty transactions. A rating
> displayed as reputation must be traceable to bounty → participants → completion → rating.

## 1. What was already fixed (20261001120300, live on prod and staging)

| Rule | State before this change |
|---|---|
| Score 1–5 | `ratings_rating_check` CHECK, validated |
| One rating per (bounty, rater, ratee) | `ratings_bounty_from_to_uidx` unique index |
| Insert only by a party of a completed bounty, about the other party | `ratings_insert_transaction_party` policy |
| No edit or delete by users | No UPDATE/DELETE policy. `anon` has only SELECT; `authenticated` has SELECT and INSERT |

## 2. Gaps found 2026-10-02 (live inspection, read-only)

| # | Gap | Env | Effect |
|---|---|---|---|
| G1 | Aggregates (`get_profile_activity_stats(_batch)`, `ratingsService.getAggregatedStats`, `share-profile`, `share-og-image`) count every row in `ratings`, including legacy rows with no transaction | both | Unattached ratings still shape reputation |
| G2 | `user_ratings` is a VIEW over `ratings` (owner `postgres`, not `security_invoker`) with INSERT/UPDATE/DELETE granted to `anon` and `authenticated` | staging | Bypasses every `ratings` policy: anyone, even signed out, can write, edit or delete any rating |
| G3 | `user_ratings` is a second ratings TABLE (0 rows) with `insert/update/delete_rater` policies and full write grants to `anon` | prod | A parallel, ungated rating store. The client falls back to it when a `ratings` insert error message contains "relation", which every CHECK violation does |
| G4 | Insert evidence is bounty `status` only. The lifecycle guard lets a poster move `in_progress → completed` directly, and staging (no `20261001130000`) still lets a client INSERT a bounty that is already `completed` with any `accepted_by` | both / staging | A poster can "complete" a job with no delivered work and rate. On staging anyone can fabricate a whole transaction |
| G5 | `created_at` is client-supplied (`completion-service.ts` sends it) | both | Backdated reviews |
| G6 | `bounties.average_rating` / `rating_count`: the poster has UPDATE on them for their own bounty | both | Self-set reputation figure on a card. Dormant: all 187 prod rows are NULL/0 and the client never maps the column, but `bounty-card.tsx` renders `averageRating` if present |
| G7 | `ratings.bounty_id` is `ON DELETE SET NULL` | both | A hard-deleted bounty leaves an unattached rating that keeps counting |
| G8 | Star-only ratings are filtered out of `RecentReviewsSection` | client | A profile can say "1 review" and show nothing |
| G9 | 42 "Please rate the poster" pushes sent on prod, 0 hunter→poster ratings ever. The tap opens the public bounty page, which has no rating UI | client | Posters have no reputation |
| G10 | `ratings.rating` is `numeric(3,1)` on staging, `integer` on prod | staging | 4.5 accepted on staging |

## 3. Existing rows

### Prod (9 rows; every one written by an `is_internal` account)

| Rating | Bounty | Evidence | Treatment |
|---|---|---|---|
| `df2889d1` `93653f6f` `37d39aa6` | completed, paid ($20/$20/$18), external hunter | approved submission + escrow released | **verify** (legacy) |
| `e1eae4f0` | completed, paid $8, internal → internal | approved submission + released | verify; excluded from aggregates (internal pair) |
| `5d597e1a` | completed honor "Honor testing", internal → internal | approved submission | verify; excluded from aggregates (internal pair) |
| `db2fc6a4` `43a3d424` | status `deleted` (09-13), paid $40/$15, external hunter | approved submission + escrow released | **verify**. The work was real and paid. The bounty was soft-deleted afterwards, and deletion must not erase the hunter's earned rating |
| `e843479f` | status `deleted`, honor, external hunter | approved submission | verify |
| `a73e1382` | **no bounty** (5★, star-only, 08-21) | none | **exclude** (stays in table, never counts, hidden from other users) |

Result after treatment: 8 verified, 1 excluded. 6 count toward someone's public reputation.

### Staging (8 rows)

2 verify. 6 stay excluded: 3 with no bounty, 2 whose rater profile is gone (`from_user_id` NULL), and 1 on a completed bounty with no approved submission.

### Why this treatment

- **Nothing is deleted or rewritten.** Rating, comment, rater, ratee, bounty and timestamp stay byte-identical. The treatment only adds a verification stamp (`verified_at`, `rater_role`, `verification_source='legacy_backfill'`).
- **Exclusion is the default.** A row counts only after it has been positively verified. A row we cannot trace is simply never stamped.
- **Reversible.** `admin_revert_legacy_rating_verification()` clears exactly the `legacy_backfill` stamps. The guard trigger allows clearing only that source.
- **Dry run first.** `admin_verify_legacy_ratings(true)` reports per-row outcomes and writes nothing. Production runs only after the operator reviews that output and gives an explicit go.
- **The legacy rule is slightly wider than the new-row rule, on purpose.** It also accepts a bounty now soft-deleted, provided it has an approved submission from the accepted hunter (the hunter's own evidence of completion), and it does not require the application row (12 pre-08-20 bounties lack one). The new-row rule stays strict.

## 4. Design

### Verification at write time (snapshot), counted at read time

A rating is stamped when it is written. Every insert, from any role (including `service_role` and the staging view), goes through `trg_ratings_guard`. The trigger calls `fn_rating_transaction_role(bounty, from, to)` and returns `'poster'` or `'hunter'` only when all of these hold:

1. the bounty exists, `accepted_by` is set, and from ≠ to;
2. (from, to) is (poster, accepted hunter) or (accepted hunter, poster);
3. the bounty is `completed`, or `archived` after completion;
4. there is an **approved completion submission by the accepted hunter**, so a poster's unilateral status flip is not enough (45/45 prod completions have one);
5. there is an **accepted application by that hunter**, so `accepted_by` came through `fn_accept_bounty_request` (this matters on staging, where `accepted_by` is still client-forgeable).

The trigger then forces `rater_role`, `verified_at = now()`, `verification_source = 'transaction_guard'`, `created_at = now()` and `hidden_* = NULL`, whatever the client sent. Old clients that still send `created_at` keep working.

Snapshotting means later bounty changes cannot erase earned ratings, for example a poster soft-deleting the bounty to bury a bad review.

### Reputation predicate (single source of truth)

`fn_rating_counts_toward_reputation(verified_at, hidden_at, bounty_id, from, to)` is true when the row is verified, not hidden, still attached to a bounty, and not an internal↔internal pair. It is used by:

- the `ratings` SELECT policy. Other users see only reputation rows, and raters see their own. This also fixes aggregates in already-shipped clients, which matters while OTA is blocked;
- `get_profile_activity_stats` and `get_profile_activity_stats_batch` (`rating_avg`, `rating_count`);
- `get_user_reviews` (the list behind the count);
- the `share-profile` and `share-og-image` edge functions, through `get_profile_activity_stats`.

### Immutability

| Who | INSERT | UPDATE | DELETE |
|---|---|---|---|
| anon | no grant | no grant; trigger refuses | no grant; trigger refuses |
| authenticated | policy + trigger | no grant; trigger refuses | no grant; trigger refuses |
| service_role / postgres | trigger (same evidence rule) | content immutable. Only `hidden_at`/`hidden_reason` (moderation), the one-time verification stamp, revert of a legacy stamp, and the FK's `bounty_id → NULL` | allowed (account deletion cascade) |

Admins hide a review (`hidden_at`) instead of deleting it. A hidden review drops out of every aggregate and list.

### Other changes

- `user_ratings`: all `anon`/`authenticated` privileges revoked and prod write policies dropped. The table/view itself and its rows are kept.
- `bounties_no_stored_rating` CHECK: `average_rating IS NULL AND rating_count IN (NULL, 0)`. Reputation is never stored on a bounty.
- `ratings_rating_whole_star` CHECK: `rating = trunc(rating)`, for staging's numeric column.
- `get_my_rating_status(bounty)`: the caller's role, the counterparty, whether they already rated, and whether they are eligible. Drives the hunter UI.

## 5. Hunter → poster (no parallel system)

Reused:

- the existing `completion / rating_prompt` notification, already sent on approval;
- the `ratings` table and `completionService.submitRating`;
- `RatingStars`;
- the `rating_prompt_shown` / `rating_submitted` / `rating_skipped` / `review_submitted` events, now with `role: 'hunter'`.

New pieces:

- the deep-link registry routes `rating_prompt` to the hunter's payout screen;
- the payout screen shows a "Rate {poster}" card once the payout is released and `get_my_rating_status` says eligible and not yet rated.

Not built (follow-up): a 24h hunter reminder. It mirrors `fn_remind_pending_hunter_ratings` and needs one more column on `completion_submissions`.

## 6. Review visibility

`RecentReviewsSection` reads `get_user_reviews`, the same predicate as the count. Each review shows its stars, the reviewer and their role ("Poster" or "Hunter"), the bounty title (or "a completed bounty" when deleted), "Paid" or "For honor", and the date. Star-only reviews render with "No written review". The section title carries the count, so "1 review" always has one visible row behind it.

## 7. Verification (2026-10-02)

- `node scripts/verify-rating-integrity.js`, staging, one transaction, always rolled back:
  - before apply: **72/72**, including migrate → rollback restoring an identical fingerprint (policies, grants, constraints, columns, triggers, stats function md5s);
  - after apply: **70/70** against the live objects, plus rollback → re-apply equal to live.
- Attacks it runs, all refused:
  - **Forge:** someone else's name; no bounty; `service_role`; `anon`; suspended account.
  - **Strangers:** a non-participant; a non-hunter ratee; self; an `accepted_by` who never applied.
  - **Before completion:** open; in progress; status flipped to completed with no approved work.
  - **Scores:** 0, 6, −1, 4.5.
  - **Duplicate.**
  - **Edit:** by the rater; hiding by a party; via the `user_ratings` view; `service_role` changing score, text or ratee; removing a verification.
  - **Delete:** by the rater; by the ratee; by `anon` via the view.
  - **Aggregates:** bounty columns; an unattached row; an internal pair; a hidden review; a shipped client averaging raw rows.
- Staging state after apply (observed):
  - policies `ratings_insert_transaction_party` and `ratings_select_reputation`;
  - `trg_ratings_guard` enabled (O);
  - `user_ratings` has no anon/authenticated grants;
  - ledger row `20261002160000`;
  - legacy dry run 2 verify / 6 exclude; applied, so 2 rows are `legacy_backfill` and 6 are NULL;
  - `check-rls-policies --env staging`: ratings clean (3 pre-existing `bounties` errors from missing `130000`/`140000`).
- Jest: full suite 363 suites / 4,803 tests pass. `tsc`: no errors in touched files. `deno check` passes for `share-profile` and `share-og-image`.
- Prod (read-only) `check-rls-policies --env production`: the 10 expected pre-migration ratings/function differences, plus the 2 known stale `bounties` manifest entries.

## 8. Rollout

1. Staging: apply `20261002160000`, then run `node scripts/verify-rating-integrity.js`, then the dry run, then the backfill.
2. Prod, **before merging** (the manifest in this change makes the edge-deploy RLS gate fail until prod has the migration): `node scripts/check-rls-policies.js --env production` (expect the 10 ratings/function diffs, plus the 2 known `bounties` entries). Apply the migration with an explicit go, then run the dry run. The operator reviews the 9 outcomes, then runs the backfill with an explicit go. Afterwards, `select verification_source, count(*) from ratings group by 1` should show `legacy_backfill = 8` and NULL = 1.
3. Client (OTA blocked): payout-screen card, deep link, reviews list. The server part already protects shipped clients through the SELECT policy.

**Observed = done:**

- `ratings` rows with `rater_role = 'hunter'` (target > 0 within 2 weeks of the client shipping);
- `select count(*) filter (where verified_at is null) from ratings where created_at > <deploy>` = 0;
- `rating_submitted{role:'hunter'}` in PostHog.

Rollback: `supabase/rollbacks/{staging,production}/20261002160000_rating_reputation_integrity.down.sql`.

## 9. Remaining reputation risks

1. **Collusion / sybil.** Two accounts the same person controls can post, apply, accept, submit, approve and rate. On an honor bounty this costs $0. On a paid bounty it costs the fee. The 09-25 Radar "fraudulent" self-dealing ring shows this happens. Mitigations, not built: weight or count only paid transactions; show "N paid jobs" next to stars; cap the same counterparty pair at one counted rating; flag accounts that share a device or payment method.
2. **Honor bounties count.** They are real app transactions but carry no money at stake. Product decision needed: show "For honor" (done in the list), exclude from the average, or both.
3. **Retaliation.** Ratings are visible as soon as they're written, so the second rater can see the first rating and retaliate. A double-blind window (reveal both once both have rated or after 14 days) is the standard fix.
4. **No rating window.** A party can rate months later. Consider requiring the rating within 30 days of completion.
5. **Review text moderation.** A report on a rating (`showReportAlert('rating')`) has no admin action yet. `hidden_at` is the mechanism, but nothing writes it.
6. **Internal accounts.** Internal↔internal pairs are excluded. An internal poster rating an external hunter for real paid work counts, which is correct but worth knowing (all 9 current prod ratings come from internal raters).
7. **`profiles.is_internal` drives exclusion.** Whoever can set it can hide a pair. It is not client-writable (protected-columns trigger), but verify this again after any profiles policy change.
8. **Drift.** Staging differs from prod: `rating` numeric, `user_ratings` view, FK `SET NULL` on raters, no `20261001130000`. The migration handles both shapes, but the CI manifest should gain `trg_ratings_guard` as a required trigger. It has.
