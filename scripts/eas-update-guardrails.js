#!/usr/bin/env node
/**
 * scripts/eas-update-guardrails.js
 *
 * Pre-flight checks for publishing a production EAS Update (OTA JS update).
 *
 * Background: on 2026-08-11 an OTA update was published to the "production"
 * channel while `runtimeVersion` was a hardcoded string ("1.0.1") shared by
 * every native build since January 2026. That update was silently delivered
 * to iOS build 2.0.4(70) — a build compiled a week before the update's
 * changes even existed — because nothing checked whether the JS being
 * published actually matched the native code of the build it would run on.
 * See docs/deployment/EAS_UPDATE_INCIDENT_2026-08-11.md for the full writeup.
 *
 * Now that `runtimeVersion` uses the "fingerprint" policy
 * (@expo/fingerprint, computed from native-relevant sources: package.json
 * deps, config plugins, native project files), this script makes that
 * protection explicit and CI-checkable *before* publishing: it compares the
 * fingerprint of the commit about to be published against the fingerprint
 * EAS actually recorded on the latest finished build for the target
 * channel. A mismatch means the JS being published relies on native code
 * (or native config) the shipped binary doesn't have — that requires a new
 * native build, not an OTA update.
 *
 * Usage:
 *   node scripts/eas-update-guardrails.js [--channel production] [--environment production] [--platforms ios,android]
 *
 * Exit codes:
 *   0  All platforms verified compatible with the latest finished build on
 *      the target channel.
 *   1  A mismatch, missing build, or missing fingerprint was found — do NOT
 *      publish.
 */

'use strict';

const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { channel: 'production', environment: 'production', platforms: ['ios', 'android'] };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'channel' && value) args.channel = value;
    if (key === 'environment' && value) args.environment = value;
    if (key === 'platforms' && value) args.platforms = value.split(',').map(p => p.trim()).filter(Boolean);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Shell out to the EAS CLI, expecting JSON on stdout (eas-cli prints a
// version-upgrade banner on stderr/stdout ahead of the JSON in some
// versions, so we slice from the first '{' or '[' rather than trusting the
// whole stream is clean JSON).
// ---------------------------------------------------------------------------
function runEasJson(args) {
  // `fingerprint:generate --json` can emit several MB of JSON (a full native
  // source-hash tree) — the default spawnSync maxBuffer (1MB) truncates that
  // silently and surfaces as a null exit status, so raise it explicitly.
  const result = spawnSync('eas', args, { encoding: 'utf8', shell: true, maxBuffer: 100 * 1024 * 1024 });
  if (result.error) {
    throw new Error(`eas ${args.join(' ')} failed to run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`eas ${args.join(' ')} failed (exit ${result.status}):\n${result.stderr || result.stdout}`);
  }
  const stdout = result.stdout || '';
  const start = Math.min(
    ...['{', '['].map(ch => {
      const idx = stdout.indexOf(ch);
      return idx === -1 ? Infinity : idx;
    })
  );
  if (!Number.isFinite(start)) {
    throw new Error(`eas ${args.join(' ')} did not return JSON:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(start));
}

function getLatestFinishedBuild(channel, platform) {
  const builds = runEasJson([
    'build:list',
    '--channel', channel,
    '--status', 'finished',
    '--platform', platform,
    '--limit', '1',
    '--json',
    '--non-interactive',
  ]);
  return Array.isArray(builds) && builds.length > 0 ? builds[0] : null;
}

function getLocalFingerprint(platform, environment) {
  const result = runEasJson([
    'fingerprint:generate',
    '--platform', platform,
    '--environment', environment,
    '--json',
    '--non-interactive',
  ]);
  // eas-cli returns either the fingerprint object directly or wraps it —
  // normalize to always look for a top-level `hash`.
  return result && result.hash ? result : (result && result.fingerprint) || result;
}

// ---------------------------------------------------------------------------
// Pure comparison logic — exported separately so it can be unit tested
// without shelling out to the EAS CLI.
// ---------------------------------------------------------------------------
function evaluateCompatibility({ platform, latestBuild, localFingerprint }) {
  if (!latestBuild) {
    return {
      platform,
      ok: false,
      reason: `No finished build found for platform "${platform}" on this channel. Cannot verify OTA compatibility — publish blocked.`,
    };
  }
  if (!latestBuild.fingerprint || !latestBuild.fingerprint.hash) {
    return {
      platform,
      ok: false,
      buildId: latestBuild.id,
      reason: `Latest build ${latestBuild.id} has no recorded fingerprint hash. Cannot verify OTA compatibility — publish blocked.`,
    };
  }
  if (!localFingerprint || !localFingerprint.hash) {
    return {
      platform,
      ok: false,
      reason: `Could not compute a local fingerprint for platform "${platform}". Publish blocked.`,
    };
  }

  const ok = latestBuild.fingerprint.hash === localFingerprint.hash;
  return {
    platform,
    ok,
    buildId: latestBuild.id,
    buildGitCommit: latestBuild.gitCommitHash,
    buildFingerprintHash: latestBuild.fingerprint.hash,
    localFingerprintHash: localFingerprint.hash,
    reason: ok
      ? null
      : 'Fingerprint mismatch — the code being published relies on native code/config that differs from the latest ' +
        'production build. This requires a new native build before it can ship as an OTA update.',
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const { channel, environment, platforms } = parseArgs(process.argv.slice(2));

  if (process.env.APP_ENV && process.env.APP_ENV !== environment) {
    console.error(
      `[eas-update-guardrails] ❌ APP_ENV="${process.env.APP_ENV}" does not match --environment="${environment}". ` +
        'Refusing to publish with a mismatched environment (this is exactly how a dev/debug config ships to production by accident).'
    );
    process.exit(1);
  }

  console.log(
    `[eas-update-guardrails] Checking OTA compatibility for channel="${channel}" environment="${environment}" platforms=${platforms.join(',')}\n`
  );

  const results = platforms.map(platform => {
    console.log(`[eas-update-guardrails] Fetching latest finished "${channel}" build for ${platform}...`);
    const latestBuild = getLatestFinishedBuild(channel, platform);
    console.log(`[eas-update-guardrails] Computing local fingerprint for ${platform} (environment=${environment})...`);
    const localFingerprint = getLocalFingerprint(platform, environment);
    return evaluateCompatibility({ platform, latestBuild, localFingerprint });
  });

  console.log('\n[eas-update-guardrails] Result:');
  for (const r of results) {
    if (r.ok) {
      console.log(
        `  ✅ ${r.platform}: compatible with build ${r.buildId} (commit ${r.buildGitCommit ? r.buildGitCommit.slice(0, 12) : 'unknown'}), fingerprint ${r.buildFingerprintHash}`
      );
    } else {
      console.log(`  ❌ ${r.platform}: ${r.reason}`);
      if (r.buildFingerprintHash || r.localFingerprintHash) {
        console.log(`     build fingerprint: ${r.buildFingerprintHash || '(none)'}`);
        console.log(`     local fingerprint: ${r.localFingerprintHash || '(none)'}`);
      }
    }
  }

  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    console.error(
      `\n[eas-update-guardrails] ❌ BLOCKED: ${failed.length} platform(s) failed compatibility checks. ` +
        'A new native build is required before publishing this OTA update. See docs/deployment/EAS_UPDATE_POLICY.md.'
    );
    process.exit(1);
  }

  console.log('\n[eas-update-guardrails] ✅ All platforms compatible with the latest production build. Safe to publish.');
  process.exit(0);
}

module.exports = { parseArgs, evaluateCompatibility };

if (require.main === module) {
  main();
}
