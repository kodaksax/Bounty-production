#!/usr/bin/env node
/**
 * scripts/deploy-functions.js
 *
 * Deploys Supabase Edge Functions to a specific environment, reading the
 * target project ref from lib/config/supabase-refs.json — the same file
 * app.config.js and lib/config/env-guard.ts use — so there is exactly one
 * place that maps an environment name to a Supabase project.
 *
 * Replaces the old package.json scripts that only covered 4 of the 14
 * functions (auth, payments, webhooks, wallet) for development/staging and
 * had no production equivalent at all, leaving 10 functions deployed
 * ad hoc by hand against whatever project a developer's local Supabase CLI
 * happened to be linked to.
 *
 * Per-function JWT verification is controlled by supabase/config.toml
 * ([functions.<name>] verify_jwt = ...), NOT by flags here — the CLI reads
 * that automatically on every deploy, so there is one source of truth
 * instead of flags that only apply when someone remembers to pass them.
 *
 * Usage:
 *   node scripts/deploy-functions.js development
 *   node scripts/deploy-functions.js staging
 *   node scripts/deploy-functions.js production
 *   node scripts/deploy-functions.js production wallet payments   (subset)
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const refs = require('../lib/config/supabase-refs.json').byAppEnv;

const FUNCTIONS_DIR = path.resolve(__dirname, '..', 'supabase', 'functions');
const ALL_FUNCTIONS = fs
  .readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name)
  .sort();

const [, , envArg, ...fnArgs] = process.argv;

if (!envArg || !refs[envArg]) {
  console.error(
    `[deploy-functions] Missing or unknown environment "${envArg || ''}".\n` +
    `Usage: node scripts/deploy-functions.js <development|staging|production> [function ...]\n` +
    `Known environments: ${Object.keys(refs).join(', ')}`
  );
  process.exit(1);
}

const projectRef = refs[envArg];
const targets = fnArgs.length > 0 ? fnArgs : ALL_FUNCTIONS;

const unknown = targets.filter((f) => !ALL_FUNCTIONS.includes(f));
if (unknown.length > 0) {
  console.error(`[deploy-functions] Unknown function(s): ${unknown.join(', ')}`);
  console.error(`Available: ${ALL_FUNCTIONS.join(', ')}`);
  process.exit(1);
}

if (envArg === 'production') {
  console.warn(
    `\n[deploy-functions] ⚠️  Deploying ${targets.length} function(s) to PRODUCTION ` +
    `(project ref: ${projectRef}). This affects live users.\n`
  );
}

console.log(`[deploy-functions] env=${envArg} project-ref=${projectRef} functions=${targets.join(', ')}\n`);

for (const fn of targets) {
  console.log(`[deploy-functions] Deploying "${fn}"...`);
  execFileSync(
    'npx',
    ['supabase', 'functions', 'deploy', fn, '--project-ref', projectRef],
    { stdio: 'inherit', shell: true }
  );
}

console.log(`\n[deploy-functions] Done. Deployed ${targets.length} function(s) to ${envArg} (${projectRef}).`);
