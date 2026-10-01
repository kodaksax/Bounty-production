#!/usr/bin/env node
/* scripts/check-rls-policies.js
 *
 * RLS regression check: compares the live database's policies, grants and
 * guard triggers against supabase/security/rls-manifest.json. Rules and
 * rationale: scripts/rls-policy-check/rules.js.
 *
 * Always read-only: the session is opened with default_transaction_read_only
 * and the snapshot runs inside BEGIN READ ONLY.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/check-rls-policies.js
 *   node scripts/check-rls-policies.js --env staging      # reads .env.staging
 *   node scripts/check-rls-policies.js --env production   # reads .env.production
 *   ... --print-protected   emit live policy/grant definitions for the
 *                           manifest's protected tables (after a reviewed migration)
 *   ... --print-findings    emit the current ratchet findings (baseline candidates)
 *
 * With DATABASE_URL, set RLS_CHECK_ENV=staging|production to pick the baseline.
 *
 * Exit codes: 0 clean, 1 policy errors, 2 could not connect / snapshot.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { analyze } = require('./rls-policy-check/rules');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'supabase/security/rls-manifest.json');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function candidateUrls() {
  let raw = process.env.DATABASE_URL;
  const env = opt('--env');
  if (env) {
    const file = path.join(ROOT, `.env.${env}`);
    const m = fs.readFileSync(file, 'utf8').match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (!m) throw new Error(`DATABASE_URL not found in ${file}`);
    raw = m[1].trim();
  }
  if (!raw) throw new Error('Set DATABASE_URL or pass --env <staging|production>');
  const u = new URL(raw);
  const urls = [raw];
  // Direct db.<ref>.supabase.co hosts are IPv6-only on most networks; fall
  // back to the session pooler (user becomes postgres.<ref>).
  const ref = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
  if (ref) {
    for (const host of ['aws-1-us-east-2.pooler.supabase.com', 'aws-0-us-east-2.pooler.supabase.com']) {
      urls.push(`postgresql://postgres.${ref}:${encodeURIComponent(decodeURIComponent(u.password))}@${host}:5432${u.pathname}`);
    }
  }
  return urls;
}

async function connect() {
  let lastError;
  for (const connectionString of candidateUrls()) {
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      options: '-c default_transaction_read_only=on',
    });
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastError = err;
      await client.end().catch(() => {});
    }
  }
  throw lastError;
}

async function snapshot(client) {
  await client.query('BEGIN READ ONLY');
  try {
    const q = async (sql) => (await client.query(sql)).rows;
    const policies = await q(`
      SELECT tablename, policyname, permissive, cmd, roles::text AS roles, qual, with_check
        FROM pg_policies WHERE schemaname = 'public'`);
    const grants = await q(`
      SELECT table_name, grantee, privilege_type
        FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`);
    const triggers = await q(`
      SELECT c.relname AS table_name, t.tgname, t.tgenabled::text AS enabled
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal`);
    const columns = await q(`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
    const functions = await q(`
      SELECT p.oid::regprocedure::text AS signature,
             array(SELECT x.grantee::regrole::text
                     FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                    WHERE x.privilege_type = 'EXECUTE' AND x.grantee <> 0) AS grantees,
             EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                      WHERE x.privilege_type = 'EXECUTE' AND x.grantee = 0) AS public_execute
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'`);
    // A PUBLIC execute grant reaches anon and authenticated too.
    for (const f of functions) if (f.public_execute) f.grantees.push('anon', 'authenticated', 'PUBLIC');
    const [{ db }] = await q(`SELECT current_database() || ' / ' || split_part(current_setting('server_version'), ' ', 1) AS db`);
    return { policies, grants, triggers, columns, functions, db };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let client;
  let snap;
  try {
    client = await connect();
    snap = await snapshot(client);
  } catch (err) {
    console.error(`rls-policy-check: could not snapshot the database: ${err.message}`);
    process.exit(2);
  } finally {
    if (client) await client.end().catch(() => {});
  }

  if (flag('--print-protected')) {
    const out = {};
    for (const table of Object.keys(manifest.protected)) {
      out[table] = {
        policies: snap.policies
          .filter((p) => p.tablename === table)
          .sort((a, b) => a.policyname.localeCompare(b.policyname))
          .map(({ policyname, cmd, permissive, roles, qual, with_check }) => ({
            policyname, cmd, permissive, roles: roles.replace(/[{}]/g, '').split(',').sort(), qual, with_check,
          })),
        grants: Object.fromEntries(['anon', 'authenticated'].map((r) => [r,
          snap.grants.filter((g) => g.table_name === table && g.grantee === r).map((g) => g.privilege_type).sort()])),
      };
    }
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // The ratchet baseline is per environment: staging and production have
  // drifted differently, and a shared list would hide one behind the other.
  const envName = opt('--env') || process.env.RLS_CHECK_ENV;
  if (manifest.baseline && !Array.isArray(manifest.baseline)) {
    if (!envName || !manifest.baseline[envName]) {
      console.error(`rls-policy-check: pass --env or set RLS_CHECK_ENV to one of: ${Object.keys(manifest.baseline).join(', ')}`);
      process.exit(2);
    }
    manifest.baseline = manifest.baseline[envName];
  }

  const { errors, warnings, findings } = analyze(snap, manifest);
  if (flag('--print-findings')) {
    console.log(JSON.stringify(findings, null, 2));
    return;
  }

  console.log(`rls-policy-check against ${snap.db}`);
  console.log(`  ${snap.policies.length} policies, ${Object.keys(manifest.protected).length} protected tables, ${findings.length} ratchet findings (${(manifest.baseline || []).length} baselined)`);
  for (const w of warnings) console.log(`  warn  ${w}`);
  for (const e of errors) console.log(`  FAIL  ${e}`);
  if (errors.length) {
    console.log(`\n${errors.length} RLS policy error(s). If a change is intended, update supabase/security/rls-manifest.json in the same PR so it is reviewed.`);
    process.exit(1);
  }
  console.log('  OK: live policies match the manifest');
})();
