#!/usr/bin/env node
/**
 * verify-bundle.js
 * ---------------------------------------------------------------------------
 * Post-export safety check for the production OTA / EAS Update bundle.
 *
 * Ensures the exported JS bundle points at the CORRECT Supabase project and
 * never accidentally ships a non-production project ref. This is the automated
 * guard that would have caught the incident where a production OTA update was
 * published with the development Supabase URL baked in.
 *
 * Usage:
 *   node scripts/verify-bundle.js [exportDir]   # defaults to ./dist
 *
 * Exit codes:
 *   0  bundle contains the expected production ref and no forbidden refs
 *   1  verification failed (wrong/missing ref) — fail the CI job / release
 *
 * Cross-platform (Node fs) so it runs identically on Windows dev machines and
 * Linux/macOS CI runners, unlike a raw `grep` one-liner.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const refs = require('../lib/config/supabase-refs.json');

const EXPECTED_PROD_REF = refs.byChannel.production; // xwlwqzzphmmhghiqvkeu
// Any ref that must NEVER appear in a production export (all non-production refs).
const FORBIDDEN_REFS = Array.from(
  new Set([
    ...Object.values(refs.byAppEnv),
    ...Object.values(refs.byChannel),
  ])
).filter((ref) => ref && ref !== EXPECTED_PROD_REF);

const exportDir = path.resolve(process.cwd(), process.argv[2] || 'dist');

if (!fs.existsSync(exportDir)) {
  console.error(
    `[verify-bundle] Export directory not found: ${exportDir}\n` +
      `Run an export first, e.g. "npx expo export --output-dir dist" or ` +
      `"eas update ... --export-dir dist".`
  );
  process.exit(1);
}

/** Recursively collect files under a directory. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(exportDir);
let expectedFound = false;
const forbiddenHits = [];

for (const file of files) {
  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch {
    continue; // skip binary/unreadable files
  }
  if (contents.includes(EXPECTED_PROD_REF)) expectedFound = true;
  for (const ref of FORBIDDEN_REFS) {
    if (contents.includes(ref)) {
      forbiddenHits.push({ file: path.relative(exportDir, file), ref });
    }
  }
}

let failed = false;

if (!expectedFound) {
  console.error(
    `[verify-bundle] FAIL: expected production Supabase ref "${EXPECTED_PROD_REF}" ` +
      `was not found anywhere in ${exportDir}. The bundle is likely built with the ` +
      `wrong/absent EXPO_PUBLIC_SUPABASE_URL.`
  );
  failed = true;
}

if (forbiddenHits.length > 0) {
  console.error(
    `[verify-bundle] FAIL: forbidden (non-production) Supabase ref(s) found in the ` +
      `production export:`
  );
  for (const hit of forbiddenHits) {
    console.error(`  - ${hit.ref} in ${hit.file}`);
  }
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(
  `[verify-bundle] OK: "${EXPECTED_PROD_REF}" present and no forbidden refs in ${exportDir}.`
);
process.exit(0);
