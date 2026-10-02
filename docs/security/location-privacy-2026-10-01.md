# Location privacy (Trust Spine audit T3 / S3, P0)

> "Hunters see a neighborhood and a rating — never an address."

Before this change that promise was false. The poster's reverse-geocoded street
address was stored in `bounties.location` and every reader got it: the feed,
detail modal, public page, profile history, share pages, realtime payloads, and
any signed-in API call. Exact `latitude`/`longitude` were readable at 7 decimals.

## What changed

Exact data no longer lives on `public.bounties`. Hiding columns would not
have been enough: service-role readers (share pages), realtime and the
radius-search RPC all bypass column grants, and a column REVOKE would break
every installed build, because they read with `select('*')`.

### Data flow (after)

```
 poster app (any build)                      service role / RPCs / edge fns
   INSERT/UPDATE bounties                       INSERT/UPDATE bounties
   location = "77 Elm St, Pikesville, MD"                 │
   latitude/longitude/unit = exact                        │
            │                                             │
            ▼                                             ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ BEFORE trigger zz_bounties_privatize_location (last BEFORE trigger)  │
 │   exact address/unit/lat/lng ──► stash (INSERT) / upsert (UPDATE)    │
 │   NEW.location     := "Pikesville, MD"   (fn_public_location_label)  │
 │   NEW.neighborhood := sanitized          (fn_public_neighborhood)    │
 │   NEW.latitude/longitude/unit := NULL                                │
 │   NEW.approx_*     := stable 120–350 m jitter (never re-rolled)      │
 │   NEW.geom         := approx point                                   │
 └───────────────┬───────────────────────────────────┬──────────────────┘
                 │ AFTER INSERT                      │
                 ▼ zz_bounties_store_private_location│
 ┌───────────────────────────────┐                   ▼
 │ bounty_private_locations      │      public.bounties (coarse only)
 │  address, unit, lat, lng      │        │
 │  no anon/authenticated grants │        ├─► feed / search / detail / public page
 │  no client policies           │        ├─► profile history, share pages (service role)
 └──────────────┬────────────────┘        ├─► realtime postgres_changes + broadcast
                │                         ├─► notifications (use neighborhood)
                ▼                         └─► search_bounties_nearby (distance to approx point)
 get_bounty_exact_location(bounty_id)  ── SECURITY DEFINER, logs every call
   poster (COALESCE(poster_id,user_id))            → exact, any status
   accepted_by while in_progress /
     cancellation_requested / disputed             → exact
   everyone else (incl. admins, applicants)        → 0 rows
   anon                                            → no EXECUTE
                │
                ▼
 bounty_location_access_log (admin-readable)
```

Client: every public surface renders `formatPublicLocation()`
(`lib/utils/public-location.ts`, mirrors the SQL label so stale cached rows are
safe too). The poster's posting screen, the poster's edit modal, the accepted
hunter's work screen and the detail modal (participants only) fetch the address
through `useBountyExactLocation()` → the RPC. Share text is sanitized at the
sink (`shareBounty`).

### Access matrix (proven by `scripts/verify-location-privacy.js`)

| Caller | Exact address / coords / unit | Public label + neighborhood + approx point |
|---|---|---|
| Anonymous | No (no EXECUTE on RPC; no grant on `bounties` or private tables) | Only where anon can read `bounties` |
| Ordinary signed-in user | No (RPC → 0 rows, logged) | Yes |
| Unrelated user (accepted hunter elsewhere) | No | Yes |
| Applicant (not accepted) | No | Yes |
| Poster | **Yes**, any status | Yes |
| Accepted hunter: `in_progress`, `cancellation_requested`, `disputed` | **Yes** | Yes |
| Accepted hunter: `completed`, `cancelled`, other | No | Yes |
| Admin (`app_metadata.role = 'admin'`) | No through the API (reads the access log; uses service role tools for exact data) | Yes |
| service_role | Table access only (server code); RPC → 0 rows | Yes |

### Files

| Area | File |
|---|---|
| Migration | `supabase/migrations/20261001160000_bounty_location_privacy.sql` |
| Rollback | `supabase/rollbacks/production/20261001160000_bounty_location_privacy.down.sql` (same file for staging) |
| Phase 2 (not applied) | `supabase/staged/20261001160100_bounty_location_column_revoke.sql` |
| Dry run | `scripts/location-privacy-dry-run.js` (BEGIN READ ONLY, counts only, safe pre-migration) |
| DB security test | `scripts/verify-location-privacy.js` (staging, single txn, always ROLLBACK) |
| API security test | `scripts/e2e-location-privacy-http.js` (staging, real sign-ins, cleans up) |
| Policy gate | `supabase/security/rls-manifest.json` (new protected tables, required triggers, function grants) |
| Client | `lib/utils/public-location.ts`, `hooks/useBountyExactLocation.ts`, `lib/services/bounty-location-service.ts`, `components/location/ExactLocationReveal.tsx`, `components/bounty-card.tsx`, `components/bountydetailmodal.tsx`, `components/bounty-feed.tsx`, `components/bounty-grid-feed.tsx`, `components/profile-bounty-history-section.tsx`, `components/edit-posting-modal.tsx`, `app/bounty/[id]/public.tsx`, `app/tabs/search.tsx`, `app/postings/[bountyId]/index.tsx`, `app/in-progress/[bountyId]/hunter/work-in-progress.tsx`, `lib/utils/share-utils.ts`, `lib/services/database.types.ts`, `lib/services/bounty-service.ts` (comment) |
| Unit tests | `__tests__/unit/public-location.test.ts`, `__tests__/unit/location-privacy-guards.test.ts`, fixture `__tests__/fixtures/public-location-label-cases.json` |

Edge functions: no change or redeploy needed. `share-bounty` and
`share-og-image` read `bounties.location`, which now holds only the label.

## Production sequence

Nothing here has been run against staging or production yet. Each numbered step
needs an explicit go.

1. **Dry run on production** (read-only, prints counts and post-fix labels, never raw addresses):
   `node scripts/location-privacy-dry-run.js --env=production`
   Record `rows_with_any_location_data`, `rows_location_street_number`,
   `rows_with_exact_coords`, `live_rows_exposed`, `in_progress_with_location`.
2. **Staging: DB test** `node scripts/verify-location-privacy.js` (and `--with-revoke`).
   Must be all PASS. Review the two INFO lines:
   - legacy address copies: historical leaks in other tables (e.g.
     `realtime.messages`, `notifications`), which the migration does not rewrite
   - functions mentioning bounty coordinates: live functions git doesn't know about
3. **Staging: apply** the migration (`supabase db push` or MCP `apply_migration`,
   then rename the file to the recorded version, see migration-drift note).
   Capture the NOTICE with the backfill counts.
4. **Staging: API test** `node scripts/e2e-location-privacy-http.js` — all PASS.
5. **Staging: policy gate** `node scripts/check-rls-policies.js --env staging`;
   then `--print-protected` and paste the live `bounty_location_access_log`
   policy into the manifest.
6. **Production: re-run step 1**, then apply the migration (same transaction
   semantics; it aborts by itself if any post-condition fails).
7. **Production: observe** (done = observed rows):
   - `SELECT count(*) FROM bounties WHERE location ~ '[0-9#]' OR latitude IS NOT NULL OR unit IS NOT NULL;` → 0
   - `SELECT count(*) FROM bounty_private_locations;` = dry-run `rows_with_any_location_data` (± online "Remote"-style rows)
   - After the next real post: one new `bounty_private_locations` row with `source='write'`.
   - `bounty_location_access_log`: grants only to poster/accepted hunter;
     `SELECT count(*) FROM bounty_location_access_log l JOIN bounties b ON b.id=l.bounty_id WHERE l.granted AND l.caller_id NOT IN (COALESCE(b.poster_id,b.user_id), b.accepted_by);` → 0
   - `node scripts/check-rls-policies.js --env production` → clean.
8. **Merge** the PR (client changes ship with the next build/OTA). The DB fix
   protects installed builds immediately; the client change only improves
   presentation and gives participants the exact address back in-app.
9. **Phase 2** (later, separate go): when ≥95% of sessions run a build with
   explicit column lists, apply `supabase/staged/20261001160100_…` (column
   REVOKE as defence in depth). Drop `bounty_location_backfill_snapshot`
   after a 30-day soak.

### Known effect on installed builds

- Everyone sees "City, ST" instead of the street address. That is the intended fix.
- On an installed (pre-update) build, the **accepted hunter** also sees only
  "City, ST" on the work screen: those builds read `bounties.location` and never
  call the RPC. Until the update reaches them, the poster shares the exact
  address in chat. As of the audit, `in_progress_with_location` in the dry run
  measures how many live jobs this touches.
- Editing the location text from an old build replaces the stored address with
  what was typed (it's the poster's own action).

## Rollback

`supabase/rollbacks/production/20261001160000_bounty_location_privacy.down.sql`

- Puts the exact values back onto `bounties` from `bounty_private_locations`
  (current values, so post-migration edits survive), with user triggers paused.
- Restores `get_bounty_exact_location`, `fn_compute_bounty_quality_score`,
  `bounties_compute_approx_location` and its trigger from the definitions the
  migration captured **from that database** at apply time
  (`location_privacy_rollback_defs`), not from git.
- Non-destructive: private, snapshot, log and defs tables are kept.
- Rolling back re-exposes addresses. Only use it for an outage.

Verified: the round trip restores data and the md5 of every captured definition.

## Residual risks (not fixed here)

- **Historical copies**: rows written before the migration may carry the old
  address in `realtime.messages` (short retention) and any notification/event
  payload that embedded it. The staging run lists where; decide per table.
- **Free text**: posters can still type an address into the title/description.
  The dry run counts descriptions with a street pattern. Candidate for the
  moderation scanner.
- **`pending_bounties.location`** (deferred funding drafts) still holds the
  typed address; owner-only RLS, not public.
- **Analytics**: `coarseRegionFromLocationText` keeps the last two comma parts.
  For app-generated addresses that's region + ZIP, but an unusual
  "Apt 4, 55 Elm St, Boston" would send "55 Elm St, Boston" to PostHog.
  Switching it to `publicLocationLabel` changes `metro_region` values, so it
  needs a taxonomy decision.
- **Moderation hold vs nearby search**: `search_bounties_nearby` is SECURITY
  DEFINER and doesn't apply `fn_bounty_moderation_visible`. That's an anti-scam
  gap (held listings stay findable by radius), separate from this fix.
- **Approximate point**: the 120–350 m jitter is the public precision by
  design (neighborhood-level, ~0.4 km² circle).

## Local verification performed

The migration, trigger, RPC, backfill, staged revoke and rollback were run
against PostgreSQL 18 + PostGIS (PGlite) with Supabase-style roles and default
grants. That mock carries the real pre-migration definitions from git, plus a
realtime broadcast trigger that ships OLD/NEW rows and a naive notification that
embeds `NEW.location`. Result: `verify-location-privacy.js` 96/96, and 99/99 with
`--with-revoke`. The mock run caught three bugs that are fixed in this version:
(1) a deferred-FK write path that broke under `SET CONSTRAINTS ALL IMMEDIATE`;
(2) the quality-score patch referencing a field its record didn't select, which
would have failed silently inside a swallowing trigger; (3) `$'` expansion in
the dry-run SQL inliner. This is not a substitute for the staging runs above:
staging has live-only triggers and policies git doesn't know about.
