# Environment Architecture

This document describes the actual environment setup for BountyExpo as of
2026-07-15, following an environment audit. It replaces an earlier version of
this doc that described an aspirational/generic three-project setup rather
than what's actually running.

## Overview

There is **one** Supabase project (`Bounty-expo`, ref `xwlwqzzphmmhghiqvkeu`),
with **development** and **staging** as Supabase *branches* of it — not
separate top-level projects. Each branch gets its own project ref, database,
and API credentials, but they're provisioned/managed as children of
production via Supabase's branching feature (`supabase/config.toml` §
`[project]` / branch docs).

| Environment | Supabase ref | Branch type | Purpose |
| :--- | :--- | :--- | :--- |
| **Development** | `ajsbkocnixpwbrjokvnq` | non-persistent | Individual developer sandbox |
| **Staging** | `gwumwpoomwvkjyibdmpj` | persistent | Shared QA / pre-production validation |
| **Production** | `xwlwqzzphmmhghiqvkeu` | — (the parent project) | Live users |

The ref↔environment mapping lives in exactly one file:
[`lib/config/supabase-refs.json`](../lib/config/supabase-refs.json). Both
`app.config.js` (build time) and `lib/config/env-guard.ts` (runtime) import
from it — if you add or change an environment, edit that file only.

There is a second Supabase project, `bountyfinder.app` (ref
`cctxleucvwxxgubbfysm`), currently **INACTIVE** and not referenced anywhere in
this codebase. Its purpose is unconfirmed — do not build against it until
that's resolved.

## Environment variable files

| File | Committed? | Loaded by |
| :--- | :--- | :--- |
| `.env.development` / `.env.staging` / `.env.production` | No (git-ignored, real secrets) | `app.config.js` when `APP_ENV` matches; also the fallback target for Node scripts when `NODE_ENV` matches |
| `.env.*.example` | Yes (no real secrets) | Nothing — reference only, copy to bootstrap the real file |
| `.env` (repo root) | No (git-ignored) | Only when `.env.$APP_ENV` doesn't exist. Intentionally scoped to **development** values — see the warning header in the file itself |

**Rule:** production/staging secrets never belong in root `.env` — only in
`.env.production` / `.env.staging`. Root `.env` exists purely so that a
script run without an explicit `APP_ENV`/`NODE_ENV` lands somewhere safe
instead of silently touching a live environment.

### Loading behavior

- **Expo app** (`app.config.js`): resolves `APP_ENV` from `process.env.APP_ENV`
  → falls back to `EXPO_PUBLIC_ENVIRONMENT` → falls back to `'development'`.
  Loads `.env.$APP_ENV` if present; only falls back to root `.env` if it
  isn't. Refuses to build (`throw`) if a production build resolves a
  localhost API URL or a Supabase ref that doesn't match
  `supabase-refs.json`.
- **Node scripts / legacy backends** (`scripts/load-env.js`,
  `services/api/src/config/index.ts`, and the ad hoc scripts under
  `scripts/`): resolve `.env.$NODE_ENV`, falling back to service-local, then
  repo-root, then plain `.env`. Both shared loaders now print a loud warning
  when neither `NODE_ENV` nor `APP_ENV` is set, since that means the script is
  about to run against whatever's in root `.env` without the caller having
  chosen an environment.
- **`scripts/check-env.js`**: validates that required keys are present *and*
  (new) that `EXPO_PUBLIC_SUPABASE_URL`/`SUPABASE_URL` actually resolve to the
  project ref `supabase-refs.json` expects for the given `APP_ENV` — run via
  `npm run env:dev` / `env:staging` / `env:prod`, or `npm run env:check` with
  `APP_ENV` set.

## EAS build profiles (`eas.json`)

| Profile | Channel | `APP_ENV` |
| :--- | :--- | :--- |
| `development` | `development` | `development` |
| `preview` | `beta` | *(injected via `EXPO_PUBLIC_*` secrets)* |
| `production` | `production` | `production` |

`lib/config/env-guard.ts` compares the **immutable** build channel (baked
into the native binary at build time, cannot change via OTA) against the
**mutable** Supabase URL baked into the JS bundle (can change via `eas
update`). If a production-channel binary ever resolves a bundle pointing at
a non-production Supabase ref, `lib/supabase.ts` refuses to create a real
client and falls back to an inert stub rather than connecting to the wrong
project. This is the safeguard added after a prior incident where an OTA
update caused a production build to read/write against the development
project.

## Edge functions

14 functions in `supabase/functions/`. Deploy with:

```
npm run deploy:functions:dev          # all functions -> development
npm run deploy:functions:staging      # all functions -> staging
npm run deploy:functions:production   # all functions -> production
node scripts/deploy-functions.js production wallet payments   # subset
```

`scripts/deploy-functions.js` reads the target project ref from
`supabase-refs.json` — there's no more hand-copied `--project-ref` per
function/environment. Per-function JWT verification is controlled entirely
by `supabase/config.toml`'s `[functions.<name>] verify_jwt = false` entries
(the CLI applies these automatically on deploy); functions that verify the
caller's JWT themselves (`auth`, `apple-pay`, `review-id`, `admin-review-id`,
`admin-verifications-list`, `payments`, `wallet`, `completion`, `connect`)
must be listed there or the gateway can reject valid tokens before the
function runs. `webhooks` and `expire-bounties` are also listed since they
authenticate via Stripe signature / service-role rather than a user JWT.

## Known gaps / follow-up work

These were found during the audit and are documented rather than silently
fixed, since they touch live data or need a decision:

1. **Migration drift across environments.** The migrations in
   `supabase/migrations/` do not match what's actually applied to any one
   branch:
   - **Development**: 0 migrations recorded as applied (branch status
     `MIGRATIONS_FAILED`). Live tables mostly exist but are missing
     `ratings`, `feedback_reports`, `feature_requests`, and everything from
     roughly `20260107_add_performance_indexes` onward is unconfirmed.
   - **Staging**: 36 migrations applied, frozen at
     `20260402_fix_payment_method_persistence`. Nothing since has been
     applied — staging is missing ~70 migration files, including RLS
     hardening, escrow/withdrawal correctness fixes, and the dispute/ratings
     system additions.
   - **Production**: 51 migrations applied and current as of
     `20260715072009_harden_activation_trigger_privileges`, but several of
     the most recent ones (the `20260714`/`20260715` onboarding/activation
     changes) existed only as uncommitted files on one machine until this
     audit — now committed.

   **Recommended approach** (not yet executed — needs a deliberate decision,
   not a blind replay): development is non-persistent with no real data
   worth preserving, so resetting the branch (`mcp: reset_branch` /
   `supabase branches reset`) to replay all migrations cleanly is simpler
   and safer than trying to repair a broken migration ledger incrementally.
   Staging is persistent and holds real QA data (100+ bounties, wallet
   transactions, disputes) — before replaying ~70 migrations onto a
   3.5-month-stale schema, diff staging's live schema against production's
   (e.g. `supabase db diff` or comparing `information_schema` per table)
   to catch any staging-only manual patches that could conflict with a
   migration expecting an intermediate state staging never had. A full
   branch reset + reseed via `scripts/migrate-prod-to-staging.sql` (already
   referenced in `supabase/config.toml`) is likely more reliable than
   incremental replay given how far staging has drifted.

2. **RLS disabled on 13 (staging) / 17 (development) tables.** Confirmed via
   live schema inspection, not just the migration ledger — `payment_methods`,
   `bounty_disputes` (dev only), `stripe_events`, `dispute_*`, `user_devices`,
   `push_tokens`, and others have Row Level Security disabled on
   development/staging, meaning the anon/authenticated roles (the app's own
   credentials) can read or write every row directly. Production has RLS
   correctly configured on all of these.
   `supabase/migrations/20260715i_sync_rls_policies_across_environments.sql`
   ports production's exact policies for review — **intentionally not yet
   applied to any branch**. Review it, then apply via `supabase db push` (or
   the MCP `apply_migration` tool) against development and staging.

3. **`.history/` git leak.** 71 VS Code local-history snapshot files were
   tracked in git despite `.gitignore` listing `.history/` (added after the
   fact, so it didn't retroactively untrack them). Two contained a plaintext
   legacy Hostinger database password. Untracked in this pass
   (`git rm -r --cached .history/`) — this stops future leakage but does
   **not** remove the password from past commits. That password should be
   treated as compromised; a history rewrite (`git filter-repo`/BFG) plus a
   coordinated force-push would be needed to purge it from history, which
   was intentionally left for a separate, deliberate pass.

4. **`bountyfinder.app` project** (ref `cctxleucvwxxgubbfysm`, INACTIVE) is
   unreferenced anywhere in this repo. Confirm what it is before assuming
   it's safe to ignore or delete.

5. **Legacy backend consolidation.** `api/server.js`, `server/index.js`, and
   `services/api/` are three separate Node backends still wired into
   `npm run`, on top of Supabase Edge Functions (the documented current
   backend per comments in `.env.staging`/`.env.production`). Not addressed
   in this pass beyond hardening their shared env-loading fallback — worth a
   dedicated cleanup to confirm which, if any, are still actually deployed.
