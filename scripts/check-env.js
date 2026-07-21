#!/usr/bin/env node
/**
 * scripts/check-env.js
 *
 * Validates that required environment variables are present for a chosen APP_ENV.
 * Usage:
 *   APP_ENV=development node scripts/check-env.js
 *   APP_ENV=staging     node scripts/check-env.js
 *   APP_ENV=production  node scripts/check-env.js
 *
 * Options:
 *   --print            Print which env file was loaded and which keys are present
 *                      (never prints values — only booleans / truncated URL prefixes).
 *   --role=frontend    Validate frontend keys only (default: both frontend + backend).
 *   --role=backend     Validate backend keys only.
 *
 * Exit codes:
 *   0  All required keys present.
 *   1  One or more required keys missing (or unknown APP_ENV).
 *
 * In CI / non-interactive mode (when ALLOW_MISSING_SECRETS=1 is set):
 *   the script prints the missing keys but exits 0, so PR checks can complete
 *   without secrets wired up.  Unset ALLOW_MISSING_SECRETS for release pipelines.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Bootstrap dotenv (best-effort: do NOT fail if dotenv is absent)
// ---------------------------------------------------------------------------
let dotenv;
try {
  dotenv = require('dotenv');
} catch {
  // dotenv not available in this environment — rely on the existing process.env
}

// ---------------------------------------------------------------------------
// Resolve APP_ENV
// ---------------------------------------------------------------------------
const APP_ENV = process.env.APP_ENV || process.env.EXPO_PUBLIC_ENVIRONMENT || 'development';
const validEnvs = ['development', 'staging', 'production'];
if (!validEnvs.includes(APP_ENV)) {
  console.error(
    `[check-env] ❌ Unknown APP_ENV="${APP_ENV}". ` +
    `Valid values: ${validEnvs.join(', ')}.`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load the env file for this APP_ENV
// ---------------------------------------------------------------------------
const envFilePriority = [
  path.resolve(process.cwd(), `.env.${APP_ENV}`),
  path.resolve(process.cwd(), '.env'),
];

let loadedFrom = null;
if (dotenv) {
  for (const f of envFilePriority) {
    if (fs.existsSync(f)) {
      // override: false means variables already set in process.env (e.g. via shell
      // export or CI env injection) take precedence over the .env file.
      // This is intentional: CI secrets and shell exports should win over file defaults.
      dotenv.config({ path: f, override: false });
      loadedFrom = f;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Parse CLI flags
// ---------------------------------------------------------------------------
const argv   = process.argv.slice(2);
const print  = argv.includes('--print');
const roleArg = (argv.find((a) => a.startsWith('--role=')) || '').replace('--role=', '');
const role   = roleArg || 'all'; // 'frontend' | 'backend' | 'all'

// ---------------------------------------------------------------------------
// Ref validation: confirm EXPO_PUBLIC_SUPABASE_URL / SUPABASE_URL actually
// point at the project this APP_ENV is supposed to use, per the single
// source of truth in lib/config/supabase-refs.json (shared with
// app.config.js and lib/config/env-guard.ts). Presence checks alone don't
// catch "right variable name, wrong project" — this does.
// ---------------------------------------------------------------------------
const { byAppEnv: EXPECTED_REFS } = require('../lib/config/supabase-refs.json');

function projectRefFromUrl(url) {
  if (!url) return null;
  const match = /^https?:\/\/([^./?#]+)\./i.exec(String(url).trim());
  return match ? match[1] : null;
}

function checkSupabaseRef() {
  const expectedRef = EXPECTED_REFS[APP_ENV];
  if (!expectedRef) return null; // unknown APP_ENV already rejected above

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const actualRef = projectRefFromUrl(url);

  if (!actualRef) return null; // presence check below already reports this as missing
  if (actualRef !== expectedRef) {
    return (
      `EXPO_PUBLIC_SUPABASE_URL resolves to project "${actualRef}", but APP_ENV="${APP_ENV}" ` +
      `expects project "${expectedRef}" (see lib/config/supabase-refs.json). ` +
      `This is exactly the mismatch that lets a dev/staging build talk to the wrong ` +
      `Supabase project — double check .env.${APP_ENV}.`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Required key definitions
// ---------------------------------------------------------------------------

/** Keys the mobile app ALWAYS needs. */
const FRONTEND_REQUIRED = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_API_URL',
];

/** Stripe publishable key — required for staging/prod; optional in local dev. */
const FRONTEND_REQUIRED_PROD = [
  'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY',
];

/** Keys the backend Node/Supabase server needs. */
const BACKEND_REQUIRED = [
  'SUPABASE_URL',
  'DATABASE_URL',
];

/** Service-role key — at least one variant must be present (backend only). */
const SERVICE_ROLE_VARIANTS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'SERVICE_ROLE_KEY',
];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
function present(key) {
  const v = process.env[key];
  return v !== undefined && v !== null && String(v).trim() !== '';
}

function checkKeys(keys, label) {
  const missing = keys.filter((k) => !present(k));
  return missing;
}

function truncate(key) {
  const v = process.env[key];
  if (!v) return '(not set)';
  const s = String(v).trim();
  return s.length > 12 ? s.substring(0, 10) + '…' : s;
}

// ---------------------------------------------------------------------------
// Run checks
// ---------------------------------------------------------------------------
const allMissing = [];
const warnings   = [];

if (role === 'frontend' || role === 'all') {
  const missingFE = checkKeys(FRONTEND_REQUIRED, 'frontend');
  allMissing.push(...missingFE);

  // Stripe key: required in staging/production, optional in development
  if (APP_ENV !== 'development') {
    const missingStripe = checkKeys(FRONTEND_REQUIRED_PROD, 'frontend (stripe)');
    allMissing.push(...missingStripe);
  } else {
    const missingStripe = checkKeys(FRONTEND_REQUIRED_PROD, 'frontend (stripe)');
    if (missingStripe.length > 0) {
      warnings.push(`${missingStripe.join(', ')} (optional in development)`);
    }
  }
}

if (role === 'backend' || role === 'all') {
  const missingBE = checkKeys(BACKEND_REQUIRED, 'backend');
  allMissing.push(...missingBE);

  // At least one service-role variant required
  const hasServiceRole = SERVICE_ROLE_VARIANTS.some(present);
  if (!hasServiceRole) {
    allMissing.push(`one of: ${SERVICE_ROLE_VARIANTS.join(' | ')}`);
  }
}

const refMismatch = checkSupabaseRef();

// ---------------------------------------------------------------------------
// Print diagnostic (safe — never prints full values)
// ---------------------------------------------------------------------------
if (print) {
  console.log(`\n[check-env] APP_ENV = ${APP_ENV}`);
  console.log(`[check-env] Env file: ${loadedFrom || '(none found — relying on process.env)'}\n`);

  const allKeys = [
    ...FRONTEND_REQUIRED,
    ...FRONTEND_REQUIRED_PROD,
    ...BACKEND_REQUIRED,
    ...SERVICE_ROLE_VARIANTS,
  ];
  for (const k of allKeys) {
    const ok = present(k);
    const prefix = ok ? '✅' : '❌';
    const hint   = ok ? truncate(k) : '(missing)';
    console.log(`  ${prefix}  ${k.padEnd(48)} ${hint}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Report warnings
// ---------------------------------------------------------------------------
for (const w of warnings) {
  console.warn(`[check-env] ⚠️  Not set (optional): ${w}`);
}

// ---------------------------------------------------------------------------
// Report ref mismatch (wrong Supabase project for this APP_ENV)
// ---------------------------------------------------------------------------
if (refMismatch) {
  console.error(`\n[check-env] ❌ Supabase project mismatch:\n\n  ${refMismatch}\n`);
}

// ---------------------------------------------------------------------------
// Report missing keys
// ---------------------------------------------------------------------------
if (allMissing.length === 0 && !refMismatch) {
  console.log(`[check-env] ✅ All required env keys present and Supabase project matches for APP_ENV="${APP_ENV}" (role=${role}).`);
  process.exit(0);
}

if (allMissing.length === 0) {
  // Only the ref mismatch failed — still a hard failure, but skip the
  // "missing keys" banner below since there aren't any.
  process.exit(1);
}

console.error(
  `\n[check-env] ❌ Missing ${allMissing.length} required env key(s) for APP_ENV="${APP_ENV}":\n`
);
for (const k of allMissing) {
  console.error(`  - ${k}`);
}

// Helpful next steps for interactive / local dev
const isCI  = process.env.CI === 'true' || process.env.CI === '1';
const allow = process.env.ALLOW_MISSING_SECRETS === '1';

if (!isCI) {
  console.error(
    `\nNext steps:\n` +
    `  1. Copy the example file:  cp .env.${APP_ENV}.example .env.${APP_ENV}\n` +
    `  2. Fill in the missing values in .env.${APP_ENV}\n` +
    `  3. Re-run:  npm run env:check\n`
  );
}

if (allow) {
  console.warn(
    '\n[check-env] ⚠️  ALLOW_MISSING_SECRETS=1 — exiting 0 despite missing keys (CI PR mode).'
  );
  process.exit(0);
}

process.exit(1);
