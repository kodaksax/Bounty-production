/* scripts/load-zip-centroids.js
 *
 * Loads supabase/data/zcta_centroids_2023.csv into public.zip_centroids
 * (created by 20261023120000_nearby_zip_targeting.sql). Idempotent: an
 * upsert on zip, safe to re-run.
 *
 * Source: US Census Bureau 2023 Gazetteer, ZIP Code Tabulation Areas
 * (2023_Gaz_zcta_national.txt, public domain). One row per ZCTA: the
 * internal point (INTPTLAT/INTPTLONG) and radius_mi = sqrt(total sq mi / pi),
 * the radius of a circle with the ZCTA's area.
 *
 * Until this runs the migration is a no-op: zip_centroids is empty, so
 * ZIP-only hunters stay exact-ZIP only and no bounty ZIP is ever cleared.
 *
 * Usage:
 *   node scripts/load-zip-centroids.js --env=staging
 *   node scripts/load-zip-centroids.js --env=production --yes
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const CSV = path.join(ROOT, 'supabase/data/zcta_centroids_2023.csv');
const BATCH = 2000;

const ENV = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
if (!['staging', 'production'].includes(ENV)) {
  console.error('--env must be staging or production');
  process.exit(2);
}
if (ENV === 'production' && !process.argv.includes('--yes')) {
  console.error('Writing to production needs --yes.');
  process.exit(2);
}

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function readRows() {
  const [header, ...lines] = fs.readFileSync(CSV, 'utf8').trim().split(/\r?\n/);
  if (header !== 'zip,latitude,longitude,radius_mi') throw new Error(`unexpected CSV header: ${header}`);
  return lines.map((line) => {
    const [zip, lat, lng, radius] = line.split(',');
    const row = { zip, latitude: Number(lat), longitude: Number(lng), radius_mi: Number(radius) };
    if (!/^\d{5}$/.test(zip) || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)
      || Math.abs(row.latitude) > 90 || Math.abs(row.longitude) > 180 || !(row.radius_mi >= 0)) {
      throw new Error(`bad CSV row: ${line}`);
    }
    return row;
  });
}

async function main() {
  const env = readEnv(`.env.${ENV}`);
  const url = env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) throw new Error(`.env.${ENV} needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`);
  if (ENV === 'staging' && /xwlwqzzphmmhghiqvkeu/.test(url)) {
    throw new Error('refusing: .env.staging points at the production project');
  }

  const rows = readRows();
  const supabase = createClient(url, service, { auth: { persistSession: false } });
  console.log(`Loading ${rows.length} ZIP centroids into ${url} ...`);

  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from('zip_centroids')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'zip' });
    if (error) throw new Error(`batch at row ${i}: ${error.message}`);
    process.stdout.write(`\r  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }

  const { count, error } = await supabase.from('zip_centroids').select('zip', { count: 'exact', head: true });
  if (error) throw error;
  console.log(`\nDone. zip_centroids now has ${count} rows.`);
  if (count < rows.length) throw new Error('row count is lower than the CSV; investigate before relying on it');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
