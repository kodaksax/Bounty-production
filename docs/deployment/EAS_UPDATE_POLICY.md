# Production EAS Update (OTA) policy

Why this exists: see `docs/deployment/EAS_UPDATE_INCIDENT_2026-08-11.md`. In short, a single
native build (iOS 2.0.4/70) served two different UIs to different users because production OTA
updates had no runtime-version boundary and no pre-publish compatibility check. This document is
the resulting process.

## Runtime version policy

`app.json` → `expo.runtimeVersion` uses the **`fingerprint`** policy:

```json
"runtimeVersion": { "policy": "fingerprint" }
```

`@expo/fingerprint` hashes the project's native-relevant surface (native dependencies, config
plugins as actually resolved — including the env-var-conditional ones in `app.config.js` — patches,
etc.) on every build and every `eas update`/`eas fingerprint:generate` invocation. Two builds get
the same runtime version only if their native surface is actually identical; an OTA update is only
offered to a build whose fingerprint matches.

We use `fingerprint` instead of the more common `appVersion` policy because this project's
`app.config.js` conditionally includes native config plugins (Branch, Google Sign-In) based on
which EAS environment secrets are present at build time — so two builds can share the same
`app.json` `"version"` while linking different native code. That already happened once (Branch's
native SDK was added mid-"2.0.4" cycle, no version bump). `appVersion` policy would not catch that
class of drift; `fingerprint` does, by construction. Expo's own guidance
(https://docs.expo.dev/eas-update/runtime-versions/) flags exactly this failure mode as the reason
to prefer `fingerprint` when native code/config can change without a version bump.

**Consequence:** every future build gets its own runtime version, derived from its actual native
surface, not a number someone has to remember to bump. An OTA update published for one runtime
version physically cannot land on a build with a different one.

## Keeping fingerprints reproducible

The fingerprint policy only works if the same commit produces the same hash everywhere. Three
things broke that in August 2026 and left production un-updatable; all three are now guarded.

**Line endings.** `@expo/fingerprint` hashes the raw bytes of tracked text files — `.gitignore`,
`eas.json`, `plugins/*.js`, `patches/*.patch`, and config-plugin inputs such as
`lib/config/apple-pay.json` and `lib/config/supabase-refs.json`. With `core.autocrlf=true` on
Windows, those files are CRLF in the working tree, while EAS Build and the GitHub Actions workflow
check them out as LF on Linux — so the *same commit* fingerprints differently depending on who
runs it. iOS builds 2.0.5(85) and 2.0.5(86) were the same commit and got different fingerprints for
exactly this reason. `.gitattributes` now pins `eol=lf`, which makes a Windows checkout
byte-identical to the Linux one. The index was already 100% LF, so nothing tracked changed content.

If your working copy predates `.gitattributes`, refresh it once:

```bash
git config core.autocrlf false
git rm --cached -r . && git reset --hard   # requires a clean tree
npm ci                                     # re-applies patches/ against LF sources
```

`npm ci` matters: `patch-package` writes the patch's line endings into `node_modules`, and
`node_modules/expo-updates/ios` is itself a fingerprint source.

**`expo.version` is a fingerprint input.** Builds 2.0.5(86) and 2.0.6(87) are the same commit and
differ *only* by the version string, and still got different fingerprints. Every version bump
therefore invalidates OTA compatibility with every build already in the field. The remedy is a
`fingerprint.config.js` declaring `SourceSkips.ExpoConfigVersions` (plus `PackageJsonScriptsAll`,
since adding any unrelated npm script has the same effect) — but adding it *changes* the hash, so
it can only land together with a native build for both platforms, not on its own.

**Build only from committed, merged code.** `eas build` uploads the working tree, not the commit.
Build 2.0.6(87) — the binary currently in the App Store — was produced from branch
`fix/hermes-compiler-bytecode-mismatch`, which was not on `main`, plus an uncommitted `app.json`
version bump. Nothing in git reproduced it, so no OTA update could reach it until `main` was
reconciled with what actually shipped. Build from `main`, with a clean `git status`.

## How to publish a production OTA update

Production OTA updates are published **only** through the
`.github/workflows/eas-update-production.yml` GitHub Actions workflow (`workflow_dispatch`):

1. Go to **Actions → EAS Update - Production → Run workflow**.
2. Fill in:
   - **message** — what changed and why. This becomes the update's permanent label in
     `eas update:list` and the job summary; write it like a commit message, not "Update".
   - **rollout_percentage** — defaults to `100`. Use a smaller number (see below) for anything
     that isn't a trivial, low-risk fix.
   - **confirm_production** — must be checked. This is the "I meant to do this" gate; the job
     fails immediately if it's unchecked.
3. Run it from the branch/commit you intend to ship (the workflow publishes whatever ref you
   dispatch it from — `github.sha` is recorded in the job summary and artifact).

The job:

- Fails closed if `confirm_production` isn't checked, or if `rollout_percentage` isn't an integer
  1–100.
- Sets `APP_ENV=production` and passes `--environment production` to every `eas` call, so the
  publish always resolves EAS's `production` environment secrets — not whatever happens to be in
  a runner's ambient env.
- Runs `scripts/eas-update-guardrails.js`, which fetches the latest **finished** production build's
  recorded fingerprint (per platform, via `eas build:list --channel production --status finished`)
  and compares it against the fingerprint of the commit about to be published (via
  `eas fingerprint:generate`). **A mismatch fails the job before anything is published.** That
  mismatch means the code being published relies on native code/config the shipped binary doesn't
  have — the fix is a new native build, not a smaller OTA update, and no amount of rollout-percentage
  tuning makes that safe.
- Publishes with `eas update --branch production --environment production --message "..." --rollout-percentage N --non-interactive --json`.
- Records triggering actor, commit SHA, branch, timestamp, channel, rollout percentage, and message
  in the job summary _before_ publishing, and the resulting update group JSON (update IDs, resolved
  runtime version, manifest links) in the summary and as a 90-day-retention build artifact
  _after_.
- Runs under `concurrency: { group: eas-update-production, cancel-in-progress: false }`, so two
  publishes can't race each other.

To check compatibility locally without publishing: `npm run update:production:check`.

### When the two stores hold different builds

The guardrail checks every platform and fails if any one of them mismatches. If the latest iOS
build and the latest Android build came from different commits, no working tree is compatible with
both and every publish is blocked until the lagging platform is rebuilt.

Narrow the publish instead of reaching for `update:production:raw`:

```bash
npm run update:production -- --platforms=ios
```

The selected platforms are passed to *both* the guardrail and `eas update`, so an unverified
platform is never published. That restriction matters: an update published for a platform whose
installed builds match no runtime version reaches nobody, while `eas update` still exits 0 and the
group still shows up in `eas update:list` — an OTA that looks shipped and isn't. The excluded
platform stays on the JS baked into its installed build until it gets a native build from the same
commit.

### Emergency manual publish (discouraged)

`npm run update:production` still works directly from a developer machine — it is not blocked. It
should only be used when the GitHub Actions workflow itself is unavailable (e.g. GitHub is down)
and the situation genuinely can't wait. As of 2026-08-17 this script
(`scripts/eas-update-production.js`) runs the same fingerprint guardrail the CI workflow runs
before publishing, prints the project/commit/branch/channel being targeted, and prints the
resulting update group afterward — it is no longer a bare `eas update` call. It still won't appear
in the workflow's audit trail, so post the command, message, and reasoning wherever the team
tracks production changes.

**`npm run update:production:raw`** is the actual bare `eas update --branch production
--environment production` command with _no_ guardrail, project check, or verification — it exists
only for the case where the guardrail script itself is broken and you've manually confirmed
compatibility another way. Do not use it as a shortcut to skip the fingerprint check.

## Staged rollout

EAS Update supports per-update rollout percentages natively — no extra infrastructure needed
(https://docs.expo.dev/eas-update/rollouts.md):

- **Start:** pass `rollout_percentage` < 100 in the workflow (or `--rollout-percentage=N` to
  `eas update`). Users not in the rollout keep receiving the previous update on the branch.
- **Progress/increase:** `eas update:edit` (interactive) walks you through picking the update and
  setting a new percentage.
- **Finish fully:** progress the rollout to 100.
- **Abort and revert:** `eas update:revert-update-rollout` — reverts everyone back to the
  pre-rollout state (republishes the prior update, or issues a rollback-to-embedded update if the
  branch had nothing published before).
- **Check status:** `eas update:list --branch production` or `eas update:view <group>`.

Constraint to know: only one rollout can be in progress on a branch at a time, and it must be
ended (100% or reverted) before a new update with the same runtime version can be published on
that branch — plan sequential rollouts accordingly, don't try to stack them.

**When to stage:** anything that touches a flow used by real money (posting/funding/payouts),
anything with meaningfully complex new UI logic, or anything you're not fully confident in.
Trivial copy/config fixes can reasonably go straight to 100%. This is a judgment call for whoever
publishes — the workflow doesn't enforce a threshold, it just makes staging one input away instead
of a separate manual process.

## Rollback

Two real EAS mechanisms exist (https://docs.expo.dev/eas-update/rollbacks.md) — nothing here is
invented:

1. **`eas update:rollback`** — interactive; walks you through rolling the `production` branch back
   to either a previously-published update or the build's embedded update.
2. **Non-interactive equivalents** (for scripting/emergencies):
   - `eas update:republish` — re-publish a previously-published update group, functionally rolling
     clients back to it.
   - `eas update:roll-back-to-embedded` — instruct clients to run the update embedded in the
     native build instead of any published update.

### Runbook: a bad update is live

1. **Identify it.** `eas update:list --branch production --json` shows recent groups with their
   message, commit, and runtime version. Cross-reference against Sentry: every event is now tagged
   with `eas_update_id`, `eas_update_channel`, and `eas_runtime_version`
   (`lib/services/sentry-init.ts`) — filter Sentry by `eas_update_id` to find the exact update
   group responsible and estimate how many sessions/users it reached.
2. **Stop further rollout**, if the bad update is still an active percentage rollout:
   `eas update:revert-update-rollout`.
3. **Roll back** the branch: `eas update:rollback` (interactive) or `eas update:republish` /
   `eas update:roll-back-to-embedded` (scripted) to the last known-good update or the embedded
   build.
4. **Determine affected users** via the Sentry `eas_update_id` tag from step 1 — that's the
   population that fetched and ran the bad update before rollback.
5. **Publish a corrected update** through the normal workflow once the fix is ready — this
   automatically re-runs the fingerprint guardrail, so a corrected update is checked exactly like
   any other.
6. **Decide if a native build is required**, not just a JS revert: if the bad update's problem was
   a genuine native/JS incompatibility, `scripts/eas-update-guardrails.js` will already have
   refused to publish it in the first place going forward — so if you're here, the cause is almost
   always a logic bug rather than a native mismatch. If a native build does turn out to be needed
   (e.g. you need to add a native module to fix this properly), the guardrail will make that
   unavoidable the next time you try to publish an OTA update that assumes it exists.

## Remaining operational risks

These require ongoing human discipline; nothing here fully automates them:

- **The `confirm_production` checkbox and rollout-percentage choice are still human judgment
  calls.** The workflow makes publishing reviewable and auditable; it does not decide _whether_ a
  given change is safe to ship as an OTA update versus needing a native build/staged rollout — the
  fingerprint guardrail only catches native/JS incompatibility, not logic bugs.
  - The workflow does not gate on `--rollout-percentage` for its updates, but only one rollout can be
    active on the branch at a time — publishing while a prior rollout is still in progress will error;
    finish or revert it first (see Staged Rollout above).
- **GitHub environment protection is not configured yet.** The workflow declares
  `environment: production`; if that GitHub Environment doesn't have required reviewers configured
  in repo settings, `workflow_dispatch` still runs on demand for anyone with write access. Adding
  required reviewers there would add a second-person approval gate on top of what's here.
- **The emergency manual-publish escape hatch (`npm run update:production`) bypasses the audit
  trail by design** — it still works, and still isn't blocked at the CLI/token level. It's a
  process convention, not a technical control. It does, however, run the same fingerprint guardrail
  as CI as of 2026-08-17; only `npm run update:production:raw` truly bypasses everything.

## 2026-08-17 audit finding: a real orphaned production update

A production-OTA audit on 2026-08-17 found that the most recent update published to the
`production` branch/channel at that time (group `9e86317a-...` iOS / `fcb0e9f6-...` Android,
commit `37c6a5bf`, message "Wire location permission request in poster flow Step 3 (StepWhere)")
had a `runtimeVersion` (fingerprint) that did not match **any** finished production build ever
produced for either platform — including the latest one (iOS build 81 / Android build 68,
fingerprints `d8ffbf27...` / `3247ae3c...`). That update was therefore unreachable by every
installed production binary, current and historical, despite `eas update` having exited
successfully. This is the same failure mode as the 2026-08-11 incident, and it recurred because
`npm run update:production` had no enforcement of the guardrail script — only the CI workflow ran
it. See `scripts/eas-update-production.js` for the fix (guardrail now runs on every local publish
too). **A new native build from the commit you intend to ship next is required before the next
OTA update can reach real users** — publishing more OTA updates on top of the current mismatch
will not fix it; only a build whose fingerprint matches the code being published will.
