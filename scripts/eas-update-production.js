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
  console.log('='.repeat(72));
  console.log('[update:production] Publishing a PRODUCTION EAS Update (OTA JS update)');
  console.log(`  branch:      ${BRANCH}`);
  console.log(`  channel:     ${CHANNEL}`);
  console.log(`  environment: ${ENVIRONMENT}`);
  console.log('='.repeat(72));

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
      '--platforms=ios,android',
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
    ['update', '--branch', BRANCH, '--environment', ENVIRONMENT],
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
