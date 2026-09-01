# Shoal swarm testing for Bounty

[Shoal](https://github.com/kodaksax/shoal) points a swarm of persona-driven AI agents at a
URL. Each agent drives a real Chromium through Claude computer-use, attempts a task in
character, and files findings the moment something breaks, misleads, or silently fails.
This directory is Bounty's QA layer on top of it: Bounty personas, Bounty scenarios, a
production-safety gate, database oracles, and a triage format that matches how Bounty
works.

**Shoal is a testing capability, not part of the product.** Nothing here is imported by
the Expo app, React Native screens, navigation, or payment code, and nothing here appears
in any production bundle. The Shoal checkout itself lives *outside* this repository (see
[How Shoal is integrated](#how-shoal-is-integrated)) so Metro, ESLint, `tsc` and Jest
never see it.

---

## Contents

| Path | What it is |
|---|---|
| `shoal.config.json` | Bounty-owned config: pinned Shoal commit, target environments, safety guards |
| `personas/bounty-personas.yaml` | The five Bounty marketplace personas |
| `scenarios/scenarios.json` | Named scenarios -> real Shoal CLI flags + Bounty triage tags |
| `bin/setup.mjs` | Provisions and builds the pinned Shoal checkout; merges Bounty personas into its library |
| `bin/serve.mjs` | Builds and serves the Bounty web app for the swarm to attack |
| `bin/run.mjs` | The only supported entry point: guard -> swarm -> oracle -> report |
| `bin/oracle.mjs` | Server-side invariant checks against the database (the ground truth) |
| `bin/report.mjs` | Shoal findings -> Bounty P0-P3 / funnel / area format |
| `artifacts/` | Per-run output (gitignored) |

---

## How Shoal is integrated

Shoal is used as a **pinned sibling checkout driven through its real CLI**, provisioned by
`bin/setup.mjs` into `%LOCALAPPDATA%/bounty-shoal/<commit>` (override with
`BOUNTY_SHOAL_HOME`).

It is deliberately **not** a dependency of this repo. `@shoal/core` is not published to
npm, so it could only be added as a git dependency — which would pull `playwright`, `ws`
and `@anthropic-ai/sdk` into the root workspace, i.e. into Metro's resolution graph and
every `npm install` for the mobile app. Keeping the checkout outside the repo means the
production bundle is untouched and this layer adds **zero** new entries to Bounty's
dependency tree (`bin/oracle.mjs` uses `pg`, which the repo already depends on).

Pinned version: **`771aad1fb3cacea6ff4303cb286fd0afa18cb868`** (2026-08-18,
`kodaksax/shoal`). Shoal has no releases or tags; a moving `HEAD` would silently change
agent behaviour between runs. Bump the commit in `shoal.config.json` deliberately and
re-run setup.

### Personas

Shoal loads its persona library from exactly one file inside its own package
(`packages/core/src/personas.ts` → `../personas/personas.yaml`) and exposes no flag for a
different path. So `bin/setup.mjs` **merges** `personas/bounty-personas.yaml` into that
file, keeping a pristine copy of the upstream library beside it so the merge is idempotent
and reversible. `--personas bounty-new-poster,...` then selects ours. Setup verifies the
merge by calling Shoal's own `loadPersonas()` and failing if any Bounty id is missing.

### Strategies

Bounty adds **no** strategies. Shoal's built-in library already covers everything needed —
`complete-task`, `explore`, `adversarial-input`, `rage-quit`, `dark-patterns`,
`state-breaker`, `race` — and the Bounty specificity lives in the scenario's task text and
persona selection instead, which is where it belongs.

---

## Setup

```bash
npm run qa:shoal:setup
```

Clones the pinned commit, `npm install`s and builds it, merges the Bounty personas, and
installs Chromium. Re-run it after changing `personas/bounty-personas.yaml` or the pinned
commit. `--force` re-clones from scratch; `--skip-install` re-syncs personas only.

You also need model credentials. Either:

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # metered, best driving
# ...or, on a Claude Pro/Max plan, no key at all:
npm run qa:shoal:run -- smoke --provider subscription
```

Subscription mode draws on the same rate pool as your own Claude Code usage, so keep those
swarms to 2–3 agents.

---

## Running

Two terminals. First, serve the app under test:

```bash
npm run qa:shoal:web            # exports the web app and serves it on :8090
npm run qa:shoal:web -- --skip-build    # re-serve an existing export, instantly
```

Then run a scenario:

```bash
npm run qa:shoal:smoke                                  # Phase 1 smoke, 2 agents
npm run qa:shoal:list                                   # every scenario
npm run qa:shoal:run -- poster-rage-quit                # where posters abandon
npm run qa:shoal:run -- composer-adversarial            # hostile input at the composer
npm run qa:shoal:run -- trust-audit --swarm 5           # dark patterns / trust
npm run qa:shoal:run -- smoke --dry-run                 # print the exact Shoal command, run nothing
```

Race testing needs a bounty for the agents to fight over:

```bash
node qa/shoal/bin/oracle.mjs seed-race --env staging --poster-id <uuid>
npm run qa:shoal:race -- --bounty-id <uuid> --swarm 10
```

Every run writes to `qa/shoal/artifacts/<timestamp>-<scenario>/`:

```
run-meta.json      what was run, against what, with which guard evidence
shoal-report.md    Shoal's own clustered report (credentials redacted)
shoal-report.json  full findings incl. base64 screenshots and action trails
oracle.json        database invariant results, when the scenario has an oracle
findings.json      Bounty triage format
findings.md        the human-readable version
```

Shoal's live dashboard runs at <http://localhost:4321> during a run (`--open` to launch a
browser at it).

---

## Safety: how production is kept out of reach

This is the part that matters most. Shoal creates accounts, posts bounties, applies to
them and drives payment UI. Pointed at production it would do all of that for real.

`bin/lib/env.mjs` refuses to start unless the target is **provably** not production:

1. `BOUNTY_SHOAL_ENV=production` is rejected outright and cannot be overridden.
2. The target host is checked against `guards.deniedHosts`.
3. **The app actually served at the target URL is fetched and inspected.** If the
   production Supabase project ref appears in the bundle, the run is refused. This is not
   inferred from `.env` files — see [Known hazards](#known-hazards) for why they cannot be
   trusted.
4. Any `pk_live_` Stripe key visible in the bundle refuses the run. Stripe test mode only.
5. An unreachable target is refused, never assumed safe.

`bin/oracle.mjs` applies the same rule to `BOUNTY_SHOAL_DATABASE_URL`, which is a separate
variable from `DATABASE_URL` precisely so that a stale shell export cannot point it at
production by accident.

Steps 2–4 can be relaxed with
`BOUNTY_SHOAL_I_UNDERSTAND_THIS_IS_PRODUCTION=yes-really`. There is no legitimate routine
reason to set it.

### Safe targets

| Environment | Safe? | Notes |
|---|---|---|
| `local` (`http://localhost:8090`) | ✅ | The default. Backend is whichever non-production project the bundle was built against. |
| `staging` | ✅ | Same local server today — Bounty has no hosted staging **web** deployment. |
| development Supabase (`ajsbkocnixpwbrjokvnq`) | ✅ | Allowlisted. |
| staging Supabase (`gwumwpoomwvkjyibdmpj`) | ✅ | Allowlisted. |
| production Supabase (`xwlwqzzphmmhghiqvkeu`) | ❌ | Denylisted. |
| `bountyfinder.app` | ❌ | Denylisted. |

---

## Environment variables

| Variable | Required for | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | any real run | Drives the agents (or use `--provider subscription`) |
| `BOUNTY_SHOAL_ENV` | optional | `local` \| `staging` (default from `guards.defaultEnv`) |
| `BOUNTY_SHOAL_URL` | optional | Override the target URL for the chosen env |
| `BOUNTY_SHOAL_HOME` | optional | Where the Shoal checkout lives (set this in CI for caching) |
| `BOUNTY_SHOAL_PROVIDER` / `_MODEL` | optional | Defaults for provider/model |
| `BOUNTY_SHOAL_TEST_EMAIL` / `_PASSWORD` | auth scenarios | Dedicated poster-side test account |
| `BOUNTY_SHOAL_HUNTER_EMAIL` / `_PASSWORD` | hunter scenarios | Dedicated hunter-side test account |
| `BOUNTY_SHOAL_DATABASE_URL` | oracles | Postgres URL for the **non-production** target project |
| `BOUNTY_SHOAL_POSTER_ID` | `seed-race` | The test poster who owns the seeded bounty |
| `BOUNTY_SHOAL_RACE_BOUNTY_ID` | race scenario | The contended bounty |

**Never** put a Stripe live secret key, a Supabase service-role key, a production
credential, or a real user's credentials in any of these. Everything here is designed
around throwaway accounts on non-production projects.

### Test accounts

Create these by hand, once, on the target project:

* **Poster** — completed onboarding, some wallet balance in Stripe test mode, at least one
  posted bounty (needed by `poster-review`, `completion`, `state-breaker`).
* **Hunter** — completed onboarding, not the same person as the poster (needed by
  `hunter-conversion`, `hunter-rage-quit`, `race-claim`).

Shoal has no way to inject an authenticated browser context, so scenarios that need a
session hand the agent the credentials **inside the task text**. `bin/run.mjs` redacts the
password from the written report afterwards, but it is visible in the live dashboard
stream while the run is in flight. Use accounts you would be happy to throw away.

---

## Reporting format

`findings.md` / `findings.json` classify every finding:

**Severity** — `P0` blocker / transaction or account integrity · `P1` severe conversion or
functional failure · `P2` meaningful UX/usability issue · `P3` polish.

Mapping: Shoal `high` becomes P0 when the scenario touches money or auth, else P1;
`medium` → P1 on money, else P2; `low` → P3. A finding Shoal's verify pass marked
**suspect** is demoted one level and flagged, never silently dropped. **A violated oracle
invariant is always P0 and always outranks agent findings.**

**Funnel** — `funnel:signup` `funnel:post` `funnel:browse` `funnel:apply` `funnel:chat`
`funnel:completion` `funnel:payment` `funnel:payout` `funnel:trust`

**Area** — `area:web` `area:auth` `area:supabase` `area:stripe` `area:analytics`
`area:marketplace` `area:ux`

Each finding carries persona, strategy, scenario, route, observed behaviour, expected
behaviour, the agent's action trail as a reproduction path, whether a screenshot exists,
and whether it was confirmed reproducible.

### Correlating with PostHog

Shoal ships a PostHog connector. Pull the real funnel and put it beside the synthetic one:

```bash
node <shoal>/packages/core/dist/cli.js connect \
  --posthog-key <personal-api-key> --posthog-project <id> \
  --posthog-funnel <insightId> --out analytics.json

node qa/shoal/bin/report.mjs --run qa/shoal/artifacts/<run> --posthog analytics.json
```

That adds a table comparing each real drop-off step with the swarm findings at that stage.
The same export also feeds Shoal's `--generate N --from-logs analytics.json`, which
synthesizes personas weighted by real traffic.

Shoal generates **no** analytics events of its own, so nothing here pollutes production
funnels. Agent traffic is identifiable by its throwaway `@example.com` addresses and, for
seeded rows, the `[shoal-race]` title prefix.

---

## Known hazards

**Root `.env` carries the production Supabase ref.** `EXPO_PUBLIC_SUPABASE_URL` in `.env`
points at `xwlwqzzphmmhghiqvkeu` (production). `APP_ENV` is read only by `app.config.js`;
Expo CLI separately loads `.env.local`, `.env.<mode>` and `.env` when it bakes
`EXPO_PUBLIC_*` into the bundle, and `APP_ENV=staging npx expo start --web` logs
`env: load .env.local .env.development .env` on startup. Which of the two wins depends on
the code path: the `expo export` used by `bin/serve.mjs` was measured producing a
correctly staging-wired bundle, but that is an observed outcome, not a guarantee the repo
enforces.

This is exactly why the guard inspects the **served bundle** rather than trusting env
files. Check the `[guard] supabase refs in served bundle` line it prints on every run —
that line is the actual evidence about which backend the swarm is about to hit.

**`expo start --web` crashes here.** On Windows it dies with `EMFILE: too many open files`
during source-map generation for the static-render bundle, after ~8 minutes of bundling.
`bin/serve.mjs` uses `expo export` instead, which does not hit that path.

---

## Shoal limitations found during integration

* **Fixed 1024×768 viewport.** `DISPLAY_WIDTH`/`DISPLAY_HEIGHT` in
  `packages/core/src/browser.ts` are constants with no flag, so there is no true mobile
  viewport. The `bounty-impatient-mobile` persona reasons about phone constraints but is
  looking at a desktop-sized window and is told to say when it is inferring. Real
  small-viewport coverage stays with Playwright's `mobile-chromium` project
  (`playwright.config.ts`).
* **No custom persona/strategy file path.** Both libraries load from fixed paths inside
  the package; hence the merge in `setup.mjs`.
* **No authenticated-context injection.** No `storageState` equivalent, so credentials go
  in the task text (see above).
* **Race ground truth is demo-only.** Shoal's server-verified race oracle is wired to its
  bundled bait shop, not to arbitrary targets — `bin/oracle.mjs` supplies Bounty's.
* **Reports are written to `process.cwd()`** with fixed filenames, so `run.mjs` runs each
  swarm with the artifact directory as its working directory.

---

## CI

`.github/workflows/shoal.yml`. Manual dispatch and a nightly schedule, staging only, never
on production. PRs are deliberately **not** wired to run a swarm: it costs money per run
and is far slower than the Playwright suite that already gates PRs.
