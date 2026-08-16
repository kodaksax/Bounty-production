# Incident: split composer UI on build 2.0.4(70), caused by the 2026-08-11 OTA update

**Status:** Resolved (runtime version policy + publish process hardened 2026-08-15/16).
**Severity:** Low user impact (a UI inconsistency, not data loss or a crash), but the underlying
mechanism could have shipped a genuinely breaking change. Treated as a real incident because of
that mechanism, not because of the observed symptom.

## What happened

On 2026-08-15, a support review found that iOS build **2.0.4 (70)** — a single, identical native
binary — was serving two different bounty-posting composers to different users at the same time:

- 46 users saw the old long-form composer, starting with a "Title & Category" step
  (`app/screens/CreateBounty/StepTitle.tsx`, since removed).
- 11 users saw the new "quick" composer, starting with a "Task" step
  (`app/screens/CreateBounty/quick/StepTask.tsx`).

Both groups were running the exact same App Store build. There was no feature flag, A/B test, or
routing bug involved.

## Why it happened

1. **`runtimeVersion` was a hardcoded string.** Since 2026-01-23 (commit `fb1c643d`), `app.json`
   set `"runtimeVersion": "1.0.1"` — a static value shared by every native build EAS produced from
   that point forward, through iOS build 2.0.5(81). Nothing about this value changed as the app's
   native dependencies and config plugins changed underneath it.

2. **Build 70 predates the flow change.** Build 2.0.4(70) was compiled 2026-07-31 from commit
   `52c956c2`. The commit that switched bounty posting from the long-form flow to the quick flow,
   `1ce313f7` ("Enabling new poster flow"), merged five days later, on 2026-08-04T20:10:18Z.

3. **No native build succeeded for two weeks.** Every iOS build attempt between build 70 (07-31)
   and build 80 (08-13) failed — builds 68, 71, 77, 78, and 79 all errored on Xcode/pod issues
   (`RCTBridge` not found, incompatible pods). Build 70 was the *only* live iOS binary in the field
   for that entire window.

4. **The flow change shipped as an OTA update, not a build.** Because no native build could ship,
   the only way `1ce313f7` reached users was via EAS Update. The publish history
   (`eas update:list --branch production`) shows:
   - Last update before the change: `2026-08-03T21:32:42Z` (commit `a03e2bd`, still the old flow).
   - Next update: `2026-08-11T06:59:00Z` (commit `1f283427`), which bundled `1ce313f7` along with
     everything else merged in the intervening week.

   That update was published to the `production` channel with runtime version `"1.0.1"` — the same
   static string every build since January carried, including build 70. `expo-updates` had no way
   to know the JS being published now assumed a composer flow that didn't exist when build 70 was
   compiled; as far as the compatibility check was concerned, they matched.

5. **Cold-start timing explains the 46-vs-11 split.** `expo-updates` fetches an available update on
   launch and applies it on the *next* relaunch — it doesn't hot-swap a running session. From
   2026-08-11 onward, whichever fraction of build-70 users happened to force-quit and reopen the
   app got the new composer; everyone else kept running whatever JS was already loaded (which, for
   anyone who hadn't relaunched since before 08-11, was still the pre-migration long-form flow).
   The 46/11 split observed on 08-15 is exactly what that relaunch-driven convergence looks like
   mid-way through.

## Root cause

Not the specific commit, and not the composer migration itself — the underlying problem is
structural: **a single, unbounded `production` OTA channel with no runtime-version boundary between
native builds.** Any update published to that channel, at any time, by anyone with EAS access, was
delivered to *every* native build the project had shipped since January, regardless of whether the
JS being published actually matched the native code already installed. The 08-11 update happened to
be safe (a UI/JS-only change, with no missing native API calls) — the same mechanism could just as
easily have shipped an update that called into a native module a given build didn't have, which
`expo-updates`' error-recovery would have caught as a crash-and-rollback rather than a silent UI
mismatch.

Contributing factors:

- OTA publishing was manual and irregular — `eas update` run from a developer's machine
  (`npm run update:production`), with gaps as long as seven days between publishes and no
  record of who ran it, when, or why beyond whatever the current git HEAD's commit message
  happened to be.
- Nothing checked, before publishing, whether the JS being shipped was actually compatible with
  the native code already in the field.

## Remediation

1. **`runtimeVersion` now uses the `"fingerprint"` policy** (`app.json`), computed by
   `@expo/fingerprint` from native-relevant sources (native dependencies, config plugins, patches).
   Verified directly against this project's EAS build history: build 70's recorded fingerprint is
   `eeef5faf2622268a273a80b054a12168d42e5619`; the fingerprint of the code the current OTA policy
   change ships with is different. Had this policy been active on 08-11, the update would have
   carried a runtime version that build 70 didn't share, and `expo-updates` would have correctly
   left build-70 installs on their existing update rather than silently offering an incompatible
   one.

   `appVersion` (the simpler, commonly-recommended policy) was considered and rejected for this
   project specifically: `app.config.js` conditionally includes native config plugins
   (`@config-plugins/react-native-branch`, the Google Sign-In plugin) based on which EAS
   environment secrets are present at build time, so two builds can carry the *same* `app.json`
   `version` string while linking different native code — confirmed in this project's own history,
   where Branch's native SDK was added (`085d3549`, 2026-08-08) without any version bump, entirely
   inside the "2.0.4" version window. `appVersion` policy would not have caught that; `fingerprint`
   does, by construction.

2. **Production OTA publishing now goes through a reviewable GitHub Actions workflow**
   (`.github/workflows/eas-update-production.yml`, `workflow_dispatch` only) instead of an
   unaudited local CLI command. It records who triggered it, the commit SHA, branch, timestamp,
   target channel, rollout percentage, and update message in the run's job summary and as a
   90-day build artifact.

3. **A pre-publish guardrail** (`scripts/eas-update-guardrails.js`) compares the fingerprint of the
   commit about to be published against the fingerprint EAS recorded on the latest finished
   production build, per platform, and refuses to publish on any mismatch — the direct technical
   fix for "how do we stop this from happening again."

4. **Sentry now tags every event with the running update's identity**
   (`eas_update_id`, `eas_update_channel`, `eas_runtime_version`,
   `lib/services/sentry-init.ts`) so that if a future OTA update does cause a
   regression, the affected update — and by extension the affected build population — is
   identifiable from crash/error reports, not just inferred from timing.

## Migration / cutover implications

Switching `runtimeVersion` to a policy that's derived from the actual project state (instead of a
string nobody was updating) creates a new compatibility boundary the moment it ships. What that
means concretely:

- **Existing build 2.0.4(70) installs:** unaffected by the config change itself — they keep running
  whatever JS they already have (old or new composer, depending on individual relaunch history
  since 08-11), and keep polling `production` for updates as before. But because the *next* update
  published under the new fingerprint policy will carry a runtime version build 70 never had (its
  own recorded fingerprint is `eeef5faf...`, permanently different from anything built after this
  change), **build 70 stops receiving further OTA updates once the first fingerprint-versioned
  update is published.** It is not bricked — it keeps running its last-applied JS indefinitely —
  it just stops being reachable by OTA. The only way to move those installs forward is a native
  update from the App Store.
- **Current App Store/TestFlight build:** based on the tracked EAS submission history
  (`eas update:list` / EAS Workflows), the last successful App Store submission was build 70's,
  on 2026-07-31 — builds 77 through 81 do not appear to have been submitted since. **Verify the
  actual live App Store Connect/TestFlight version directly before relying on this** — submissions
  run outside the tracked EAS Workflow (e.g. a bare `eas submit` from a terminal) wouldn't show up
  in that history.
- **The next native build:** will compute its own fingerprint from the code at build time and
  receive that as its runtime version — automatically, no manual version bump required. This is
  the boundary that makes the 08-11 failure mode structurally impossible going forward: an OTA
  update can only reach a build whose native surface it actually matches.
- **OTA updates already published** (everything in `eas update:list` prior to this change): untouched.
  They remain associated with runtime version `"1.0.1"` and continue serving any remaining `"1.0.1"`
  builds (i.e. build 70, until it's replaced) exactly as before. Nothing is deleted or rolled back
  by this change.
- **The `production` channel/branch:** unchanged structurally (still one branch, one channel,
  1:1-mapped). What changes is every *future* update published to it: each will carry whatever
  runtime version its commit's fingerprint computes to, not `"1.0.1"`.
- **Users who haven't opened the app since 08-11:** still on the pre-migration composer, still on
  build 70, still polling the same channel. They converge to the 08-11 update (new composer) on
  their next relaunch exactly as they would have without this change — this fix doesn't alter that
  in-flight convergence, it only prevents the *next* incompatible thing from reaching them the same
  way.

**Recommended cutover:** treat this as immediately requiring a new native build. `git status`/build
history should be checked at that time to confirm what's actually live; if the last live build really
is 70, the very next production build + submission both closes that two-week gap and gives the fleet
a build whose runtime version matches the new policy, so it can receive future OTA updates again.
This repository does not build or submit automatically — see the final report for the exact command
and an explicit ask before running it, since it has real cost and App Store visibility.

See `docs/deployment/EAS_UPDATE_POLICY.md` for the resulting publish/rollout/rollback process.

## New release policy (summary)

- Production OTA updates are published only through the GitHub Actions workflow, never directly
  from a developer machine except for a documented emergency (see the policy doc's rollback
  section).
- A publish is blocked automatically if the fingerprint of the code being published doesn't match
  the latest finished production build — that's the system telling you a native build is required
  first.
- Every publish is now attributable to a commit, an actor, and a timestamp, and is recorded
  somewhere durable (the workflow run + artifact), not just "whatever HEAD's message was."
