#!/usr/bin/env node
/**
 * Run one Bounty scenario as a Shoal swarm.
 *
 * This is the only supported entry point. It resolves the target environment, refuses to
 * start unless the target is provably not production (qa/shoal/bin/lib/env.mjs), expands
 * a scenario from qa/shoal/scenarios/scenarios.json into REAL Shoal CLI flags, runs the
 * swarm with the artifact directory as its working directory (Shoal writes its report to
 * cwd), redacts credentials out of what it wrote, and optionally runs a server-side
 * oracle over the database afterwards.
 *
 *   node qa/shoal/bin/run.mjs <scenario-id> [options]
 *
 *   --env <local|staging>   target environment          (default: shoal.config.json guards.defaultEnv)
 *   --swarm <n>             override the scenario's swarm size
 *   --provider <p>          anthropic | subscription | openai
 *   --model <id>            model for the provider
 *   --effort <level>        low|medium|high|xhigh|max   (anthropic)
 *   --max-steps <n>         override the scenario's step cap
 *   --bounty-id <uuid>      the contended bounty (required by the race-claim scenario)
 *   --headed                show the browser windows
 *   --open                  open Shoal's dashboard in a browser (default: do not)
 *   --no-verify             skip Shoal's verify pass over findings
 *   --no-oracle             skip the post-run database invariant check
 *   --dry-run               print the exact Shoal command and exit without running it
 *   --list                  list the scenarios and exit
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GuardError,
  QA_ROOT,
  assertSafeTarget,
  loadConfig,
  loadScenarios,
  printEvidence,
  resolveEnv,
  shoalHome,
} from './lib/env.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes('--' + f);
const opt = (f, fallback) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const config = loadConfig();
const scenarios = loadScenarios();

if (has('list')) {
  console.log('\n  Bounty Shoal scenarios:\n');
  for (const s of scenarios) {
    console.log(
      '    ' + s.id.padEnd(22) + 'phase ' + s.phase + '  swarm ' + s.swarm +
        '  ' + s.strategy.join(',') + (s.requiresAuth ? '  [needs test account]' : ''),
    );
    console.log('    ' + ' '.repeat(22) + s.title);
    console.log('');
  }
  process.exit(0);
}

// The scenario is the first bare positional argument. Walk the argv skipping flags and
// the values that belong to them, so `--swarm 8 smoke` and `smoke --swarm 8` both work.
const VALUE_FLAGS = new Set([
  'env', 'swarm', 'provider', 'model', 'effort', 'max-steps', 'bounty-id', 'port', 'scenario',
]);
function findScenarioId() {
  if (argv.includes('--scenario')) return argv[argv.indexOf('--scenario') + 1];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a.slice(2))) i++;
      continue;
    }
    return a;
  }
  return undefined;
}
const scenarioId = findScenarioId();
const scenario = scenarios.find((s) => s.id === scenarioId);
if (!scenario) {
  console.error(
    '  Unknown or missing scenario "' + (scenarioId ?? '') + '".\n' +
      '  Known: ' + scenarios.map((s) => s.id).join(', ') + '\n' +
      '  Or:    node qa/shoal/bin/run.mjs --list',
  );
  process.exit(1);
}

// --- Target + guard -------------------------------------------------------
let target;
let evidence;
try {
  target = resolveEnv(config, opt('env'));
  evidence = await assertSafeTarget(config, target, { skipProbe: has('dry-run') });
} catch (err) {
  if (err instanceof GuardError) {
    console.error('\n  BLOCKED\n  ' + err.message + '\n');
    process.exit(2);
  }
  throw err;
}
printEvidence(evidence);

// --- Credentials ----------------------------------------------------------
// Shoal has no way to inject an authenticated browser context (no storageState flag), so
// a scenario that needs a session hands the agent throwaway credentials inside the task
// text. That text is echoed into Shoal's own report, so we redact it afterwards -- and
// these must only ever be a dedicated test account on a non-production project.
const creds = {
  email: process.env.BOUNTY_SHOAL_TEST_EMAIL,
  password: process.env.BOUNTY_SHOAL_TEST_PASSWORD,
  hunterEmail: process.env.BOUNTY_SHOAL_HUNTER_EMAIL,
  hunterPassword: process.env.BOUNTY_SHOAL_HUNTER_PASSWORD,
};

let task = scenario.task;
if (scenario.requiresAuth) {
  const wantsHunter = /hunter/.test(scenario.id) || scenario.id === 'race-claim';
  const email = (wantsHunter && creds.hunterEmail) || creds.email;
  const password = (wantsHunter && creds.hunterPassword) || creds.password;
  if (!email || !password) {
    console.error(
      '\n  Scenario "' + scenario.id + '" needs a signed-in account.\n' +
        '  Set BOUNTY_SHOAL_TEST_EMAIL and BOUNTY_SHOAL_TEST_PASSWORD (and, for hunter-side\n' +
        '  scenarios, BOUNTY_SHOAL_HUNTER_EMAIL / BOUNTY_SHOAL_HUNTER_PASSWORD) to a dedicated\n' +
        '  test account on the target project. Never a real user. See qa/shoal/README.md.\n',
    );
    process.exit(1);
  }
  task =
    'First sign in to the existing test account: email ' + email + ', password ' + password +
    '. If a sign-in form is not on screen, find the way to it. Once you are signed in, do this: ' +
    task;
  creds.active = password;
}

// --- Scenario -> real Shoal flags -----------------------------------------
const home = shoalHome(config);
const cli = join(home, 'packages', 'core', 'dist', 'cli.js');
if (!existsSync(cli)) {
  console.error('\n  Shoal is not built at ' + home + '.\n  Run: npm run qa:shoal:setup\n');
  process.exit(1);
}

let url = target.url;
let racePath = null;
if (scenario.id === 'race-claim' || scenario.strategy.includes('race')) {
  const bountyId = opt('bounty-id', process.env.BOUNTY_SHOAL_RACE_BOUNTY_ID);
  if (!bountyId) {
    console.error(
      '\n  The race scenario needs the bounty every agent will fight over:\n' +
        '    --bounty-id <uuid>   (or BOUNTY_SHOAL_RACE_BOUNTY_ID)\n' +
        '  It must be an OPEN, unclaimed bounty in the target project. Seed one first:\n' +
        '    node qa/shoal/bin/oracle.mjs seed-race --env ' + target.name + '\n',
    );
    process.exit(1);
  }
  racePath = '/bounty/' + bountyId;
  scenario.raceBountyId = bountyId;
} else if (scenario.path) {
  url = new URL(scenario.path, target.url).toString();
}

const swarm = Number(opt('swarm', String(scenario.swarm)));
const provider = opt('provider', process.env.BOUNTY_SHOAL_PROVIDER || config.defaults.provider);
const defaultModel = provider === 'subscription' ? 'claude-haiku-4-5' : config.defaults.model;

const args = [
  cli,
  'run',
  url,
  '--task', task,
  '--swarm', String(swarm),
  '--max-steps', opt('max-steps', String(scenario.maxSteps ?? config.defaults.maxSteps)),
  '--provider', provider,
  '--model', opt('model', process.env.BOUNTY_SHOAL_MODEL || defaultModel),
  '--effort', opt('effort', config.defaults.effort),
  '--port', opt('port', String(config.defaults.port)),
];
if (scenario.personas?.length) args.push('--personas', scenario.personas.join(','));
if (racePath) {
  args.push('--race', '--race-path', racePath);
} else if (scenario.strategy?.length) {
  args.push('--strategy', scenario.strategy.join(','));
}
if (has('headed')) args.push('--headed');
if (!has('open')) args.push('--no-open');
if (has('no-verify')) args.push('--no-verify');
// Non-local targets need an explicit allowlist; Shoal refuses them non-interactively.
const host = new URL(url).hostname;
if (!/^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(host)) args.push('--allow-domain', host, '--yes');

// --- Artifacts ------------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runDir = join(QA_ROOT, 'artifacts', stamp + '-' + scenario.id);

const redact = (s) =>
  creds.active && typeof s === 'string' ? s.split(creds.active).join('***REDACTED***') : s;

const meta = {
  scenario: scenario.id,
  title: scenario.title,
  phase: scenario.phase,
  env: target.name,
  url,
  swarm,
  strategy: racePath ? ['race'] : scenario.strategy,
  personas: scenario.personas,
  tags: scenario.tags,
  raceBountyId: scenario.raceBountyId ?? null,
  guard: evidence,
  startedAt: new Date().toISOString(),
  shoalCommit: config.shoal.commit,
};
const printable = args.map((a) => (a.includes(' ') ? JSON.stringify(redact(a)) : redact(a)));
console.log('\n  scenario: ' + scenario.id + ' -- ' + scenario.title);
console.log('  artifacts: ' + runDir);
console.log('\n  $ node ' + printable.join(' ') + '\n');

if (has('dry-run')) {
  console.log('  --dry-run: not executing (no artifact directory created).\n');
  process.exit(0);
}

mkdirSync(runDir, { recursive: true });
writeFileSync(join(runDir, 'run-meta.json'), JSON.stringify(meta, null, 2), 'utf8');

/**
 * Run the swarm and come back when it is actually finished.
 *
 * Shoal's CLI does NOT exit when the swarm completes: RunController keeps the dashboard
 * server listening so its stop/restart controls stay usable. Waiting on process exit
 * therefore hangs forever (and would hang CI until the job timeout). The swarm's real
 * completion signal is `shoal-report.json` appearing in the working directory, written at
 * the end of runSwarm() -- so wait for that, let it settle, then end the process tree.
 */
async function runSwarm() {
  const child = spawn(process.execPath, args, { cwd: runDir, stdio: 'inherit', env: process.env });
  const reportPath = join(runDir, 'shoal-report.json');

  const exited = new Promise((resolve) => child.on('exit', (code) => resolve({ code, killed: false })));

  const reportWritten = new Promise((resolve) => {
    const poll = setInterval(() => {
      if (!existsSync(reportPath)) return;
      clearInterval(poll);
      // The .md is written just after the .json; give both a moment to flush.
      setTimeout(() => resolve({ code: 0, killed: true }), 2000);
    }, 1000);
    child.on('exit', () => clearInterval(poll));
  });

  const result = await Promise.race([exited, reportWritten]);
  if (result.killed && child.pid) {
    // The CLI owns a listening server and browser processes; kill the whole tree.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
  return result;
}

const started = Date.now();
const res = await runSwarm();

// Shoal writes shoal-report.{md,json} into cwd; strip the credential it was handed.
for (const f of ['shoal-report.md', 'shoal-report.json']) {
  const p = join(runDir, f);
  if (existsSync(p)) writeFileSync(p, redact(readFileSync(p, 'utf8')), 'utf8');
}
meta.finishedAt = new Date().toISOString();
meta.durationMs = Date.now() - started;
meta.exitCode = res.code;
writeFileSync(join(runDir, 'run-meta.json'), JSON.stringify(meta, null, 2), 'utf8');

if (res.code !== 0) {
  console.error('\n  Shoal exited with code ' + res.code + '.\n');
  process.exit(res.code ?? 1);
}

// --- Server-side oracle ---------------------------------------------------
// Agent observations never settle money or state questions. If this scenario has an
// invariant check, it runs now and its verdict is what counts.
if (scenario.oracle && !has('no-oracle')) {
  console.log('\n  running oracle: ' + scenario.oracle + '\n');
  const oracleArgs = [
    join(QA_ROOT, 'bin', 'oracle.mjs'),
    scenario.oracle,
    '--env', target.name,
    '--out', join(runDir, 'oracle.json'),
  ];
  if (scenario.raceBountyId) oracleArgs.push('--bounty-id', scenario.raceBountyId);
  const o = spawnSync(process.execPath, oracleArgs, { stdio: 'inherit', env: process.env });
  if (o.status !== 0) console.error('  oracle reported a failure (see above and oracle.json).');
}

// --- Bounty finding format ------------------------------------------------
const report = spawnSync(
  process.execPath,
  [join(QA_ROOT, 'bin', 'report.mjs'), '--run', runDir],
  { stdio: 'inherit', env: process.env },
);
process.exit(report.status ?? 0);
