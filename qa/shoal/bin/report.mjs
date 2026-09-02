#!/usr/bin/env node
/**
 * Translate a Shoal run into Bounty's triage format.
 *
 * Shoal writes shoal-report.{md,json}: findings clustered by similarity and ranked by
 * reach, with severity high/medium/low and a confirmed/suspect verdict. That is the right
 * shape for "what did the swarm hit", but not for Bounty's queue, which triages by
 * P0-P3, by funnel step, and by owning area. This maps one to the other and folds in the
 * oracle verdict, which outranks anything an agent claimed.
 *
 *   node qa/shoal/bin/report.mjs --run qa/shoal/artifacts/<run-dir> [--posthog <export.json>]
 *
 * Writes findings.json and findings.md next to the Shoal report.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (f, fallback) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const runDir = opt('run');
if (!runDir) {
  console.error('  Usage: node qa/shoal/bin/report.mjs --run <artifact-dir> [--posthog <export.json>]');
  process.exit(1);
}

const readJson = (p, fallback = null) =>
  existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback;

const meta = readJson(join(runDir, 'run-meta.json'));
const shoal = readJson(join(runDir, 'shoal-report.json'));
const oracle = readJson(join(runDir, 'oracle.json'));

if (!meta) {
  console.error('  No run-meta.json in ' + runDir + ' -- was this produced by qa/shoal/bin/run.mjs?');
  process.exit(1);
}
if (!shoal) {
  console.error('  No shoal-report.json in ' + runDir + ' -- the swarm produced no report.');
  process.exit(1);
}

// --- Severity ------------------------------------------------------------
// P0 blocker / transaction or account integrity
// P1 severe conversion or functional failure
// P2 meaningful UX/usability issue
// P3 polish/minor
const ORDER = ['P0', 'P1', 'P2', 'P3'];
const demote = (p) => ORDER[Math.min(ORDER.indexOf(p) + 1, ORDER.length - 1)];

const MONEY_FUNNELS = ['funnel:payment', 'funnel:payout'];
const MONEY_AREAS = ['area:stripe'];

function severityFor(finding, tags) {
  const touchesMoney =
    tags.funnel.some((f) => MONEY_FUNNELS.includes(f)) || tags.area.some((a) => MONEY_AREAS.includes(a));
  const touchesAuth = tags.area.includes('area:auth');
  let p;
  if (finding.severity === 'high') p = touchesMoney || touchesAuth ? 'P0' : 'P1';
  else if (finding.severity === 'medium') p = touchesMoney ? 'P1' : 'P2';
  else p = 'P3';
  // Shoal's verify pass flags findings whose action trail does not support the claim.
  // Those stay in the report but must not outrank a confirmed one.
  if (finding.verdict?.status === 'suspect') p = demote(p);
  return p;
}

/** Which discipline owns it. Tags give the scenario-level answer; the text refines it. */
function classify(finding, tags) {
  const text = (finding.title + ' ' + finding.description).toLowerCase();
  if (/payment|charge|fee|card|stripe|escrow|payout|refund|wallet|balance/.test(text)) return 'payment';
  if (/sign ?in|sign ?up|log ?in|log ?out|password|session|account|verif/.test(text)) return 'auth';
  if (/saved|not saved|persist|stale|duplicate|server|error 5|failed to load|did not appear/.test(text))
    return 'backend';
  if (tags.area.includes('area:stripe')) return 'payment';
  if (tags.area.includes('area:auth')) return 'auth';
  return 'frontend';
}

const tags = meta.tags ?? { funnel: [], area: [] };
const findings = (shoal.findings ?? []).map((f, i) => {
  const severity = severityFor(f, tags);
  return {
    id: meta.scenario + '-' + String(i + 1).padStart(3, '0'),
    severity,
    persona: f.personaName,
    strategy: (meta.strategy ?? []).join(','),
    scenario: meta.scenario,
    route: meta.url,
    title: f.title,
    observed: f.description,
    // Shoal does not ask the agent for an expected-behaviour field; the persona's
    // expectation is embedded in its narration, so this is stated as the inverse of the
    // observation rather than invented.
    expected: 'The persona expected this step to complete without the behaviour described above.',
    reproductionPath: f.evidence?.recent ?? [],
    artifact: f.evidence?.screenshot ? 'screenshot captured in shoal-report.json (base64)' : null,
    reproducible: f.verdict ? f.verdict.status === 'confirmed' : null,
    verifierNote: f.verdict?.note ?? null,
    category: classify(f, tags),
    funnel: tags.funnel,
    area: tags.area,
    agentId: f.agentId,
    ts: f.ts,
  };
});

// Oracle failures are ground truth and always outrank agent findings.
if (oracle) {
  for (const r of oracle.results ?? []) {
    if (r.ok) continue;
    findings.unshift({
      id: meta.scenario + '-oracle-' + r.id,
      severity: r.severity ?? 'P0',
      persona: '(server-side oracle)',
      strategy: (meta.strategy ?? []).join(','),
      scenario: meta.scenario,
      route: 'database: ' + oracle.env,
      title: 'Invariant violated: ' + r.id,
      observed: r.detail || 'invariant returned false',
      expected: 'This invariant must hold after any run. See qa/shoal/bin/oracle.mjs.',
      reproductionPath: ['oracle check: ' + oracle.check, 'window since ' + oracle.since],
      artifact: 'oracle.json',
      reproducible: true,
      verifierNote: 'Database-verified, not an agent observation.',
      category: r.id.startsWith('pay') ? 'payment' : 'backend',
      funnel: tags.funnel,
      area: tags.area,
      agentId: null,
      ts: Date.now(),
    });
  }
}

findings.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));

// --- Funnel friction: where did the swarm stop? --------------------------
// The clusters Shoal ranks by reach are the abandonment map. Keep its ranking; add the
// Bounty severity so the queue can be worked top-down.
const clusters = (shoal.clusters ?? []).map((c) => ({
  title: c.title,
  reach: c.reach,
  of: shoal.summary?.total ?? meta.swarm,
  personas: c.hitBy,
  shoalSeverity: c.severity,
}));

const counts = ORDER.reduce((acc, p) => {
  acc[p] = findings.filter((f) => f.severity === p).length;
  return acc;
}, {});

const out = {
  scenario: meta.scenario,
  title: meta.title,
  phase: meta.phase,
  env: meta.env,
  url: meta.url,
  swarm: meta.swarm,
  strategy: meta.strategy,
  personas: meta.personas,
  tags,
  shoalCommit: meta.shoalCommit,
  startedAt: meta.startedAt,
  durationMs: meta.durationMs,
  outcome: shoal.summary
    ? {
        total: shoal.summary.total,
        completed: shoal.summary.completed,
        gaveUp: shoal.summary.gaveUp,
        errored: shoal.summary.errored,
        costUsd: shoal.summary.costUsd,
      }
    : null,
  oracle: oracle ? { check: oracle.check, failed: oracle.failed, results: oracle.results } : null,
  counts,
  clusters,
  findings,
};
writeFileSync(join(runDir, 'findings.json'), JSON.stringify(out, null, 2), 'utf8');

// --- Markdown ------------------------------------------------------------
const lines = [];
lines.push('# Shoal findings -- ' + meta.scenario);
lines.push('');
lines.push('| | |');
lines.push('|---|---|');
lines.push('| Scenario | ' + meta.title + ' (phase ' + meta.phase + ') |');
lines.push('| Environment | `' + meta.env + '` -- ' + meta.url + ' |');
lines.push('| Swarm | ' + meta.swarm + ' agents, strategy `' + (meta.strategy ?? []).join(', ') + '` |');
lines.push('| Personas | ' + (meta.personas ?? []).join(', ') + ' |');
lines.push('| Funnel | ' + tags.funnel.join(', ') + ' |');
lines.push('| Area | ' + tags.area.join(', ') + ' |');
lines.push('| Shoal | `' + (meta.shoalCommit ?? '').slice(0, 12) + '` |');
if (out.outcome) {
  lines.push(
    '| Outcome | ' + out.outcome.completed + ' completed, ' + out.outcome.gaveUp + ' gave up, ' +
      out.outcome.errored + ' errored |',
  );
}
if (out.oracle) {
  lines.push('| Oracle | `' + out.oracle.check + '` -- ' + (out.oracle.failed ? out.oracle.failed + ' VIOLATED' : 'all invariants held') + ' |');
}
lines.push('');
lines.push('**' + ORDER.map((p) => counts[p] + ' ' + p).join(' · ') + '**');
lines.push('');

if (clusters.length > 0) {
  lines.push('## Friction map -- where the swarm stopped');
  lines.push('');
  lines.push('| Reach | Issue | Personas |');
  lines.push('|---|---|---|');
  for (const c of clusters) {
    lines.push('| ' + c.reach + '/' + c.of + ' | ' + c.title + ' | ' + c.personas.join(', ') + ' |');
  }
  lines.push('');
}

lines.push('## Findings');
lines.push('');
if (findings.length === 0) lines.push('_No findings filed._');
for (const f of findings) {
  lines.push('### ' + f.severity + ' -- ' + f.title);
  lines.push('');
  lines.push('- **id:** `' + f.id + '`');
  lines.push('- **persona:** ' + f.persona + ' · **strategy:** ' + f.strategy + ' · **scenario:** ' + f.scenario);
  lines.push('- **route:** ' + f.route);
  lines.push('- **classification:** ' + f.category + ' · ' + f.funnel.join(', ') + ' · ' + f.area.join(', '));
  const repro =
    f.persona === '(server-side oracle)'
      ? 'yes (database-verified)'
      : f.reproducible === null
        ? 'not verified'
        : f.reproducible
          ? 'yes (Shoal verify pass confirmed)'
          : 'SUSPECT -- may be an agent artifact';
  lines.push('- **reproducible:** ' + repro + (f.verifierNote ? ' -- _' + f.verifierNote + '_' : ''));
  lines.push('');
  lines.push('**Observed:** ' + f.observed);
  lines.push('');
  lines.push('**Expected:** ' + f.expected);
  lines.push('');
  if (f.reproductionPath.length > 0) {
    lines.push('**Reproduction path:**');
    lines.push('');
    // Shoal's action trail interleaves clicks with the agent's full narration, which can
    // run to hundreds of words per step. Keep the markdown skimmable; the untruncated
    // trail is in findings.json and shoal-report.json.
    for (const step of f.reproductionPath) {
      const one = String(step).replace(/\s+/g, ' ').trim();
      lines.push('1. ' + (one.length > 240 ? one.slice(0, 240) + ' …' : one));
    }
    lines.push('');
  }
  if (f.artifact) {
    lines.push('**Artifact:** ' + f.artifact);
    lines.push('');
  }
}

// --- Optional PostHog juxtaposition --------------------------------------
// Deliberately a comparison, not a claim: synthetic friction and real friction are two
// different measurements, and the value is in seeing them side by side.
const posthogPath = opt('posthog');
if (posthogPath && existsSync(posthogPath)) {
  const ph = JSON.parse(readFileSync(posthogPath, 'utf8'));
  const dropoffs = ph.dropoffs ?? [];
  if (dropoffs.length > 0) {
    lines.push('## Shoal friction vs. real-user funnel');
    lines.push('');
    lines.push('| Real funnel step | Real drop-off | Swarm findings at this stage |');
    lines.push('|---|---|---|');
    for (const d of dropoffs) {
      const words = d.step.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
      const related = findings.filter((f) =>
        words.some((w) => (f.title + ' ' + f.observed).toLowerCase().includes(w)),
      );
      lines.push(
        '| ' + d.step + ' | ' + (d.rate * 100).toFixed(1) + '% | ' +
          (related.length ? related.map((r) => r.severity + ' ' + r.title).join('; ') : '--') + ' |',
      );
    }
    lines.push('');
    lines.push(
      '_Pull the real numbers with Shoal\'s own connector:_ `shoal connect --posthog-key <k> ' +
        '--posthog-project <id> --posthog-funnel <insightId> --out analytics.json`',
    );
    lines.push('');
  }
}

writeFileSync(join(runDir, 'findings.md'), lines.join('\n'), 'utf8');

console.log('\n  ' + basename(runDir));
console.log('  ' + ORDER.map((p) => counts[p] + ' ' + p).join(' · ') + '  (' + findings.length + ' findings)');
console.log('  wrote findings.json + findings.md\n');

// Non-zero when the run produced something that must block: a P0, or a violated invariant.
if (counts.P0 > 0) process.exit(3);
