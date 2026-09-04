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
import {
  POOL_SECRET_ENV,
  derivePassword,
  poolAccounts,
  requirePoolSecret,
} from './lib/accounts.mjs';
import { installRunPersonas, removeRunPersonas } from './lib/run-personas.mjs';

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
    if (s.requiresAuth) {
      // Operators pick scenarios from this list; anything that must be true before the
      // run can produce a trustworthy result belongs here, not only in the README.
      console.log(
        '    ' + ' '.repeat(22) +
          'needs ' + s.swarm + ' seeded pool account(s) + ' + POOL_SECRET_ENV +
          '  (seed.mjs accounts)',
      );
    }
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

// --- Credentials: one account per agent -----------------------------------
// Shoal has no way to inject an authenticated browser context (no storageState flag), so
// a scenario that needs a session has to hand the agent credentials in text.
//
// It used to put ONE account into the shared --task string, which every agent in the
// swarm then signed into at the same time. Six agents on one user post, apply, fund and
// cancel over each other's rows, so "my draft vanished" and "there are bounties I never
// posted" become indistinguishable from another agent's writes -- every state finding was
// confounded, and the duplicate-bounties oracle (which groups by poster_id) could not
// tell five agents posting once from one agent posting five times.
//
// So each agent now gets its OWN pool account. The delivery mechanism is the persona,
// not the task: Shoal assigns personas to swarm slots by cycling the selected list
// (pickPersonas -> pool[i % pool.length]), so N distinct persona ids across a swarm of N
// is a guaranteed 1:1 binding, and persona.profile goes verbatim into exactly that one
// agent's system prompt. The task text carries no credentials at all any more, which
// also keeps them out of Shoal's report and out of every other agent's context.
const swarm = Number(opt('swarm', String(scenario.swarm)));
if (!Number.isInteger(swarm) || swarm < 1) {
  console.error('\n  --swarm must be a positive integer, got "' + opt('swarm') + '".\n');
  process.exit(1);
}

/** Passwords to strip from anything this run writes to disk. */
const secrets = [];
let agentAccounts = null;

let task = scenario.task;
if (scenario.requiresAuth) {
  const wantsHunter = /hunter/.test(scenario.id) || scenario.id === 'race-claim';
  const role = wantsHunter ? 'hunter' : 'poster';
  let secret;
  try {
    secret = requirePoolSecret();
  } catch (err) {
    console.error(
      '\n  Scenario "' + scenario.id + '" needs one signed-in account per agent.\n  ' +
        err.message + '\n',
    );
    process.exit(1);
  }
  agentAccounts = poolAccounts(role, swarm).map((a) => ({
    ...a,
    password: derivePassword(secret, a.email),
  }));
  secrets.push(...agentAccounts.map((a) => a.password));
  task =
    'You already have an account on this site; its email address and password are in your ' +
    'persona above. Sign in with those first -- if a sign-in form is not on screen, find ' +
    'the way to it. Do not create a new account, and do not use any other credentials. ' +
    'Once you are signed in, do this: ' +
    task;
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
// Route the agent should navigate to AFTER signing in (authenticated scenarios only).
let postAuthRoute = null;
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
} else if (scenario.path && scenario.path !== '/') {
  // An authenticated scenario must not START on the protected route. Observed in the
  // composer-adversarial run: agents dropped straight onto /screens/CreateBounty spent
  // most of their step budget hunting for a way back to a sign-in form. Start them at the
  // root, where sign-in is reachable, and tell them where to go once they are in.
  if (scenario.requiresAuth) {
    postAuthRoute = scenario.path;
  } else {
    url = new URL(scenario.path, target.url).toString();
  }
}

if (postAuthRoute) {
  task +=
    ' Everything above happens on the screen reached from ' + postAuthRoute +
    ' -- once you are signed in, navigate there first (the address bar works: ' +
    new URL(postAuthRoute, target.url).toString() + ').';
}

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
// Authenticated scenarios select the ephemeral per-agent personas installed below;
// everything else selects the scenario's personas straight from the merged library.
let runPersonas = null;
if (agentAccounts) {
  runPersonas = installRunPersonas(home, {
    basePersonaIds: scenario.personas ?? [],
    accounts: agentAccounts,
    scenarioId: scenario.id,
    stamp: process.pid + '-' + Date.now().toString(36),
  });
  args.push('--personas', runPersonas.ids.join(','));

  // Those personas carry this run's account passwords, inside Shoal's own checkout.
  // Take them out again however this process ends -- normal exit, --dry-run's early
  // exit, an uncaught throw, or a signal. Registered here rather than alongside the
  // swarm's own handlers because the window opens the moment the file is written.
  let personasRemoved = false;
  const cleanupPersonas = () => {
    if (personasRemoved) return;
    personasRemoved = true;
    try {
      removeRunPersonas(home);
    } catch (err) {
      console.error('  !! could not restore ' + runPersonas.path + ': ' + err.message);
      console.error('     Remove the "BEGIN shoal per-run agent personas" block by hand.');
    }
  };
  process.on('exit', cleanupPersonas);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      cleanupPersonas();
      process.exit(130);
    });
  }
} else if (scenario.personas?.length) {
  args.push('--personas', scenario.personas.join(','));
}
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

/** Strip every pool password this run handed out, not just one. */
const redact = (s) => {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const secret of secrets) out = out.split(secret).join('***REDACTED***');
  return out;
};

const meta = {
  scenario: scenario.id,
  title: scenario.title,
  phase: scenario.phase,
  env: target.name,
  url,
  swarm,
  strategy: racePath ? ['race'] : scenario.strategy,
  personas: scenario.personas,
  // The accounts, not the passwords: enough to attribute a state finding to a user and
  // to go and look at that user's rows afterwards.
  agentAccounts: agentAccounts ? agentAccounts.map((a) => ({ slot: a.slot, email: a.email })) : null,
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
/**
 * Kill a child and everything it spawned. Shoal owns a listening dashboard server plus a
 * pool of Chromium processes, none of which die just because the parent does -- so a
 * plain child.kill() leaves browsers resident and the port held.
 */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGKILL'); // negative pid = the whole process group
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}

/** Hard ceiling so a wedged swarm can never hang CI until the job timeout. */
const RUN_TIMEOUT_MS = Number(opt('timeout-ms', String(45 * 60 * 1000)));

async function runSwarm() {
  const child = spawn(process.execPath, args, {
    cwd: runDir,
    stdio: 'inherit',
    env: process.env,
    // Own process group on POSIX so killTree can take the whole tree down at once.
    detached: process.platform !== 'win32',
  });
  const reportPath = join(runDir, 'shoal-report.json');

  // Whatever happens to this process -- normal exit, Ctrl+C, SIGTERM from CI, an
  // unhandled throw -- the swarm must not outlive it.
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    killTree(child.pid);
  };
  process.on('exit', cleanup);
  const onSignal = (sig) => {
    console.error('\n  received ' + sig + ' -- terminating the swarm and its browsers.');
    cleanup();
    process.exit(130);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('uncaughtException', (err) => {
    cleanup();
    throw err;
  });

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

  const timedOut = new Promise((resolve) =>
    setTimeout(() => resolve({ code: 124, killed: true, timedOut: true }), RUN_TIMEOUT_MS),
  );

  const result = await Promise.race([exited, reportWritten, timedOut]);
  if (result.timedOut) {
    console.error(
      '\n  TIMEOUT: no report after ' + Math.round(RUN_TIMEOUT_MS / 60000) + ' minutes. ' +
        'Killing the swarm.\n  Raise the ceiling with --timeout-ms if this was legitimate.',
    );
  }
  if (result.killed) cleanup();
  // Give the OS a moment to reap the tree before we report on the artifacts.
  await new Promise((r) => setTimeout(r, 500));
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
