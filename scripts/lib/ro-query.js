/* scripts/lib/ro-query.js
 *
 * Read-only SQL runner for staging or production. Every query runs inside
 * BEGIN READ ONLY and is always rolled back, so it cannot write.
 *
 * Usage:
 *   node scripts/lib/ro-query.js --env=production "select 1"
 *   node scripts/lib/ro-query.js --env=staging -f path/to/query.sql
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..', '..');

function candidateUrls(env) {
  const text = fs.readFileSync(path.join(ROOT, `.env.${env}`), 'utf8');
  const m = text.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error(`DATABASE_URL not found in .env.${env}`);
  const raw = m[1].trim();
  const u = new URL(raw);
  const urls = [raw];
  const ref = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
  if (ref) {
    for (const host of ['aws-1-us-east-2.pooler.supabase.com', 'aws-0-us-east-2.pooler.supabase.com']) {
      urls.push(`postgresql://postgres.${ref}:${encodeURIComponent(decodeURIComponent(u.password))}@${host}:5432${u.pathname}`);
    }
  }
  return urls;
}

async function connect(env) {
  // --env=local: a throwaway local database (e.g. a PGlite mock) given by
  // LOCAL_DATABASE_URL. Never falls back to a remote project.
  if (env === 'local') {
    if (!process.env.LOCAL_DATABASE_URL) throw new Error('--env=local needs LOCAL_DATABASE_URL');
    const client = new Client({ connectionString: process.env.LOCAL_DATABASE_URL });
    await client.connect();
    return client;
  }
  let lastErr;
  for (const url of candidateUrls(env)) {
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try {
      await client.connect();
      return client;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function main() {
  const args = process.argv.slice(2);
  const env = (args.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
  const fIdx = args.indexOf('-f');
  const sql = fIdx >= 0 ? fs.readFileSync(args[fIdx + 1], 'utf8') : args.filter((a) => !a.startsWith('--'))[0];
  const client = await connect(env);
  try {
    await client.query('BEGIN READ ONLY');
    const res = await client.query(sql);
    for (const r of Array.isArray(res) ? res : [res]) {
      if (r.rows && r.rows.length) console.table(r.rows);
      else console.log(`(${r.command} ${r.rowCount ?? 0})`);
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { connect, candidateUrls };
