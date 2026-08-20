#!/usr/bin/env node
/**
 * scripts/eas-update-production.js
 *
 * Safe wrapper around `eas update` for the production branch/channel, invoked by
 * `npm run update:production`. Previously that script was a bare
 * `eas update --branch production --environment production` with no enforcement
 * of the fingerprint-compatibility guardrail (scripts/eas-update-guardrails.js) —
 * the guardrail only ran inside the GitHub Actions workflow
 * (.github/workflows/eas-update-production.yml), so a local run of the npm
 * script could (and did — see commit 37c6a5bf / update group 9e86317a) publish
 * an update whose runtimeVersion doesn't match any finished production build,
 * i.e. an update no installed binary can ever receive despite `eas update`
 * exiting 0. This wrapper makes the local path exercise the same guardrail the
 * CI workflow does, prints exactly what is about to be published, and prints
 * what actually landed afterward so success can be verified rather than assumed.
 *
 * Usage:
 *   npm run update:production
 *   npm run update:production -- --platforms=ios      # only publish/verify iOS
 *
 * See docs/deployment/EAS_UPDATE_POLICY.md.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const BRANCH = 'production';
const CHANNEL = 'production';
const ENVIRONMENT = 'production';
// app.json -> expo.extra.eas.projectId. Kept in sync manually; this is a sanity
// check, not the source of truth (app.json/eas.json remain that).
const EXPECTED_PROJECT_ID = 'b5485f88-0b1f-4622-bbed-b1ae142dcb46';
const ALL_PLATFORMS = ['ios', 'android'];

/**
 * Resolve which platforms this publish covers, from `--platforms=ios,android`.
 *
 * Defaults to both. A narrower scope exists because the two stores can drift
 * apart: if the latest iOS build and the latest Android build were produced
 * from different commits, no single working tree can be fingerprint-compatible
 * with both, and a both-platforms run is unpublishable until the lagging
 * platform is rebuilt. The escape hatch has to be a first-class, guardrailed
 * option — otherwise the only way out is `update:production:raw`, which skips
 * the compatibility check entirely and is exactly how the 2026-08-11 incident
 * happened.
 *
 * Whatever is chosen here is applied to BOTH the guardrail and `eas update`,
 * so an unverified platform is never published rather than published blind.
 */
function parsePlatforms(argv) {
  const flag = argv.find(arg => arg.startsWith('--platforms='));
  if (!flag) return ALL_PLATFORMS;

  const platforms = flag
    .slice('--platforms='.length)
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(Boolean);

  const invalid = platforms.filter(p => !ALL_PLATFORMS.includes(p));
  if (platforms.length === 0 || invalid.length > 0) {
    console.error(
      `[update:production] BLOCKED: invalid --platforms value "${flag}". ` +
        `Expected a comma-separated subset of: ${ALL_PLATFORMS.join(',')}.`
    );
    process.exit(1);
  }
  return [...new Set(platforms)];
}

function runInherited(cmd, args, extraEnv) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  if (result.error) {
    console.error(
      `[update:production] Failed to run "${cmd} ${args.join(' ')}": ${result.error.message}`
    );
    process.exit(1);
  }
  return result.status === null ? 1 : result.status;
}

function runCaptured(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', shell: true, maxBuffer: 20 * 1024 * 1024 });
}

function main() {
  const platforms = parsePlatforms(process.argv.slice(2));

  console.log('='.repeat(72));
  console.log('[update:production] Publishing a PRODUCTION EAS Update (OTA JS update)');
  console.log(`  branch:      ${BRANCH}`);
  console.log(`  channel:     ${CHANNEL}`);
  console.log(`  environment: ${ENVIRONMENT}`);
  console.log(
    `  platforms:   ${platforms.join(',')}${
      platforms.length === ALL_PLATFORMS.length ? '' : '  (narrowed via --platforms)'
    }`
  );
  console.log('='.repeat(72));

  if (platforms.length !== ALL_PLATFORMS.length) {
    const excluded = ALL_PLATFORMS.filter(p => !platforms.includes(p));
    console.warn(
      `\n[update:production] NOTE: ${excluded.join(', ')} is excluded from this publish. Users on ` +
        `${excluded.join(', ')} will NOT receive this update and will stay on the JS baked into their ` +
        `installed build until a new native build is made from this commit and they update.`
    );
  }

  // 1. Verify this CLI/account actually resolves to the expected project.
  //    A wrong-account login would otherwise publish to (or fail against) a
  //    different Expo project silently.
  const projectInfo = runCaptured('eas', ['project:info', '--non-interactive']);
  const projectOutput = `${projectInfo.stdout || ''}${projectInfo.stderr || ''}`;
  console.log(projectOutput.trim() || '(no output from "eas project:info")');
  if (!projectOutput.includes(EXPECTED_PROJECT_ID)) {
    console.error(
      `\n[update:production] BLOCKED: "eas project:info" did not report the expected project id ` +
        `(${EXPECTED_PROJECT_ID}, from app.json extra.eas.projectId). You may be logged into the ` +
        `wrong EAS account, or running from the wrong directory. Not publishing.`
    );
    process.exit(1);
  }

  // 2. Surface the exact commit being published, and warn (do not block) on an
  //    unclean working tree — publishing uncommitted changes means the shipped
  //    JS won't correspond to anything in git history.
  const head = runCaptured('git', ['rev-parse', 'HEAD']);
  const commit = (head.stdout || '').trim();
  console.log(
    `\n[update:production] Publishing from commit: ${commit || '(unknown — not a git checkout?)'}`
  );
  const gitStatus = runCaptured('git', ['status', '--porcelain']);
  if ((gitStatus.stdout || '').trim().length > 0) {
    console.warn(
      '[update:production] WARNING: working tree has uncommitted changes. Those changes will be ' +
        'included in the published update but are not associated with any commit. Ctrl+C now to abort ' +
        'if that is unintended.'
    );
  }

  // 3. Fingerprint-compatibility guardrail — identical check to the CI workflow.
  //    Blocks publishing if the code about to ship relies on native code/config
  //    that the latest finished production build doesn't have.
  console.log(
    '\n[update:production] Running OTA compatibility guardrails (fingerprint check)...\n'
  );
  const guardStatus = runInherited(
    'node',
    [
      path.join(__dirname, 'eas-update-guardrails.js'),
      `--channel=${CHANNEL}`,
      `--environment=${ENVIRONMENT}`,
      `--platforms=${platforms.join(',')}`,
    ],
    { APP_ENV: ENVIRONMENT }
  );
  if (guardStatus !== 0) {
    console.error(
      '\n[update:production] BLOCKED: guardrails failed — see above. A new native build is required ' +
        'before this code can ship as an OTA update. Not publishing.'
    );
    process.exit(guardStatus);
  }

  // 4. Publish.
  console.log('\n[update:production] Guardrails passed. Publishing...\n');
  const publishStatus = runInherited(
    'eas',
    [
      'update',
      '--branch',
      BRANCH,
      '--environment',
      ENVIRONMENT,
      // Publish exactly what was verified above. Passing 'all' when only one
      // platform cleared the guardrail would publish an update the other
      // platform's installed builds can never match — a silent no-op that
      // still looks like a successful publish in `eas update:list`.
      '--platform',
      platforms.length === ALL_PLATFORMS.length ? 'all' : platforms[0],
    ],
    {
      APP_ENV: ENVIRONMENT,
    }
  );
  if (publishStatus !== 0) {
    console.error('\n[update:production] "eas update" exited non-zero — publish did not succeed.');
    process.exit(publishStatus);
  }

  // 5. Post-publish verification — show what actually landed on the branch so
  //    success isn't assumed just because the command exited 0.
  console.log('\n[update:production] Publish command succeeded. Latest group on this branch:\n');
  runInherited('eas', ['update:list', '--branch', BRANCH, '--limit', '1']);
  console.log(
    '\n[update:production] Confirm the runtimeVersion above matches the target native build before ' +
      'assuming production users can receive it: eas build:list --channel production --status finished ' +
      '--platform ios --limit 1 --json  (and --platform android)'
  );
}

main();
