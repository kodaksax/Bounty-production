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
  in the job summary *before* publishing, and the resulting update group JSON (update IDs, resolved
  runtime version, manifest links) in the summary and as a 90-day-retention build artifact
  *after*.
- Runs under `concurrency: { group: eas-update-production, cancel-in-progress: false }`, so two
  publishes can't race each other.

To check compatibility locally without publishing: `npm run update:production:check`.

### Emergency manual publish (discouraged)

`npm run update:production` (`eas update --branch production --environment production`) still
works directly from a developer machine — it is not blocked. It should only be used when the
GitHub Actions workflow itself is unavailable (e.g. GitHub is down) and the situation genuinely
can't wait. If you do this, run `npm run update:production:check` first (the same guardrail the
workflow runs), and post the command, message, and reasoning wherever the team tracks production
changes, since it won't otherwise appear in the workflow's audit trail.

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
  calls.** The workflow makes publishing reviewable and auditable; it does not decide *whether* a
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
  process convention, not a technical control.
