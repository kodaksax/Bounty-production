/* scripts/verify-reports-id-migration.js
 *
 * Release-step check for #871: applies
 * supabase/migrations/20260928120000_reports_id_default.sql (idempotent — a
 * second SET DEFAULT is a no-op) against the real production database, then
 * proves the fix the way the client actually exercises it: a REAL,
 * COMMITTED insert into public.reports with no `id` supplied, executed under
 * RLS as an authenticated user (not service role), followed by a fresh
 * connection re-reading the row and deleting it via the same RLS-scoped
 * identity.
 *
 * This intentionally does NOT use a BEGIN...ROLLBACK wrapper. A prior
 * verification of this exact migration used
 * BEGIN; <DDL>; RAISE EXCEPTION; ROLLBACK; as one batch and assumed it was
 * self-cleaning — on a different migration that same pattern left DDL live
 * on prod, untracked, because the trailing ROLLBACK didn't reliably run
 * after the error (see reference_execute_sql_rollback_unreliable memory).
 * The only way to know an authenticated insert really survives is to let it
 * commit, then check for it, then delete it — that is what this script does.
 *
 * Usage:
 *   node scripts/verify-reports-id-migration.js
 *
 * Reads DATABASE_URL from .env.production (see
 * verify-request-outcomes-migration.js for why it goes through the pooler).
 * Exits non-zero if any check fails. Safe to re-run: it always deletes the
 * row it inserts, and never touches real user data.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20260928120000_reports_id_default.sql');

function dbUrls() {
  const env = fs.readFileSync(path.join(ROOT, '.env.production'), 'utf8');
  const m = env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error('DATABASE_URL not found in .env.production');
  const u = new URL(m[1].trim());
  const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '');
  const hosts = process.env.PG_POOLER_HOST
    ? [process.env.PG_POOLER_HOST]
    : ['aws-1-us-east-2.pooler.supabase.com', 'aws-0-us-east-2.pooler.supabase.com'];
  return hosts.map((host) => `postgresql://postgres.${ref}:${u.password}@${host}:5432${u.pathname}`);
}

async function connect() {
  let lastError;
  for (const connectionString of dbUrls()) {
    const c = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    try {
      await c.connect();
      return c;
    } catch (err) {
      lastError = err;
      await c.end().catch(() => {});
    }
  }
  throw lastError;
}

const results = [];
function record(name, ok, info) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  -- ' + info : ''}`);
}

async function main() {
  const client = await connect();
  let insertedId = null;
  let reporterId = null;
  try {
    // ── Apply (idempotent) ────────────────────────────────────────────────
    await client.query(fs.readFileSync(MIGRATION, 'utf8'));
    record('migration applies cleanly (idempotent SET DEFAULT)', true);

    const defaults = (await client.query(
      `SELECT table_name, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('reports', 'moderation_actions') AND column_name = 'id'`
    )).rows;
    record('reports.id and moderation_actions.id both have a server-side default',
      defaults.length === 2 && defaults.every((r) => (r.column_default || '').includes('gen_random_uuid')),
      JSON.stringify(defaults));

    // ── Pick a reporter identity — internal test accounts only, never real users ──
    const internal = (await client.query(
      `SELECT id FROM public.profiles WHERE is_internal = true ORDER BY id LIMIT 2`
    )).rows;
    if (internal.length === 0) {
      record('authenticated insert smoke test (no is_internal profile available to test with)', false);
    } else {
      reporterId = internal[0].id;
      const reportedId = (internal[1] || internal[0]).id;

      // ── Real, committed insert under RLS — exactly what report-service.ts sends: no id ──
      await client.query('SET ROLE authenticated');
      await client.query(
        `SELECT set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)`,
        [reporterId]
      );
      const ins = (await client.query(
        `INSERT INTO public.reports (reporter_id, content_type, content_id, reason, details)
         VALUES ($1, 'user', $2, 'spam', 'release-step smoke test for #871 — auto-deleted by verify-reports-id-migration.js')
         RETURNING id`,
        [reporterId, reportedId]
      )).rows[0];
      insertedId = ins.id;
      record('authenticated insert with no client-supplied id succeeds and gets a generated uuid',
        !!insertedId && insertedId.length === 36, insertedId);
      await client.query('RESET ROLE');

      // ── Prove it actually committed: re-read on a second connection ───────
      const check = await connect();
      const row = (await check.query('SELECT id FROM public.reports WHERE id = $1', [insertedId])).rows[0];
      record('row is visible on a fresh connection (proves it committed, not just RETURNING)', !!row);
      await check.end();
    }
  } catch (err) {
    record('verification run', false, err.message);
  } finally {
    // ── Clean up the smoke-test row via the same RLS-scoped identity ───────
    if (insertedId) {
      try {
        await client.query('SET ROLE authenticated');
        await client.query(
          `SELECT set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)`,
          [reporterId]
        );
        const del = await client.query('DELETE FROM public.reports WHERE id = $1 RETURNING id', [insertedId]);
        await client.query('RESET ROLE');
        record('smoke-test row deleted via reports_delete_own RLS policy', del.rows.length === 1);
      } catch (err) {
        record('smoke-test row cleanup', false, err.message);
      }
    }
    await client.end();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
