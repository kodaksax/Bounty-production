/* scripts/location-privacy-dry-run.js
 *
 * Dry run for supabase/migrations/20261001160000_bounty_location_privacy.sql.
 * Counts rows that carry potentially identifying address data, and previews
 * the public label each row would get. Runs inside BEGIN READ ONLY and always
 * rolls back, so it is safe against production BEFORE the migration exists
 * there: the label SQL is extracted from the migration file and inlined, no
 * function has to be created.
 *
 * Prints counts and post-fix labels only. It never prints a raw address or
 * coordinate.
 *
 * Usage:
 *   node scripts/location-privacy-dry-run.js --env=production
 *   node scripts/location-privacy-dry-run.js --env=staging
 */
const fs = require('fs');
const path = require('path');
const { connect } = require('./lib/ro-query');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261001160000_bounty_location_privacy.sql');

function between(text, begin, end) {
  const i = text.indexOf(begin);
  const j = text.indexOf(end, i + begin.length);
  if (i < 0 || j < 0) throw new Error(`markers ${begin} / ${end} not found in migration`);
  return text.slice(i + begin.length, j).trim();
}

/** SQL expressions equivalent to the migration's functions, usable without creating them. */
function inlineLabelSql() {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const pred = between(sql, '-- @pred-begin', '-- @pred-end');
  const label = between(sql, '-- @label-begin', '-- @label-end');
  // Replacer functions, not strings: the SQL contains `$'`, which String#replace
  // would otherwise expand as a special pattern.
  const predFor = (v) => pred.replace(/\bp_c\b/g, () => v);
  const labelFor = (v) =>
    label
      .replace('public.fn_location_component_is_public(s.c)', () => predFor('s.c'))
      .replace(/\bp_raw\b/g, () => v);
  const neighborhoodFor = (v) => `(CASE
      WHEN position(',' IN COALESCE(${v}, '')) > 0 THEN NULL
      WHEN ${predFor(`btrim(regexp_replace(COALESCE(${v}, ''), '\\s+', ' ', 'g'))`)}
        THEN btrim(regexp_replace(${v}, '\\s+', ' ', 'g'))
      ELSE NULL END)`;
  return { labelFor, neighborhoodFor };
}

function countsSql({ labelFor, neighborhoodFor }) {
  return `
WITH b AS (
  SELECT b.*,
         ${labelFor('b.location')} AS label_after,
         ${neighborhoodFor('b.neighborhood')} AS neighborhood_after
  FROM public.bounties b
)
SELECT
  count(*)                                                                         AS rows_total,
  count(*) FILTER (WHERE NULLIF(btrim(location), '') IS NOT NULL OR latitude IS NOT NULL
                     OR longitude IS NOT NULL OR NULLIF(btrim(unit), '') IS NOT NULL
                     OR geom IS NOT NULL)                                          AS rows_with_any_location_data,
  count(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)           AS rows_with_exact_coords,
  count(*) FILTER (WHERE latitude IS NOT NULL
                     AND abs(latitude * 10000 - round(latitude * 10000)) > 0)     AS rows_with_4plus_decimal_coords,
  count(*) FILTER (WHERE geom IS NOT NULL)                                         AS rows_with_geom,
  count(*) FILTER (WHERE NULLIF(btrim(unit), '') IS NOT NULL)                      AS rows_with_unit,
  count(*) FILTER (WHERE location ~ '[0-9#]')                                      AS rows_location_with_digits,
  count(*) FILTER (WHERE location ~ '(^|,)\\s*#?[0-9]+[A-Za-z]?\\s+\\S')           AS rows_location_street_number,
  count(*) FILTER (WHERE NULLIF(btrim(location), '') IS NOT NULL
                     AND COALESCE(label_after, '') IS DISTINCT FROM btrim(location)) AS rows_location_label_changes,
  count(*) FILTER (WHERE NULLIF(btrim(location), '') IS NOT NULL
                     AND label_after IS NULL)                                      AS rows_label_empty_after,
  count(*) FILTER (WHERE neighborhood IS NOT NULL
                     AND neighborhood_after IS DISTINCT FROM neighborhood)         AS rows_neighborhood_sanitized,
  count(*) FILTER (WHERE status::text IN ('open','in_progress','cancellation_requested','disputed')
                     AND (latitude IS NOT NULL OR location ~ '[0-9#]'
                          OR NULLIF(btrim(unit), '') IS NOT NULL))                 AS live_rows_exposed,
  count(*) FILTER (WHERE status::text = 'in_progress' AND accepted_by IS NOT NULL
                     AND NULLIF(btrim(location), '') IS NOT NULL)                  AS in_progress_with_location,
  count(*) FILTER (WHERE COALESCE(is_test, false))                                 AS rows_is_test
FROM b`;
}

function previewSql({ labelFor }) {
  return `
SELECT left(b.id::text, 8)                              AS bounty,
       b.status::text                                   AS status,
       (b.location ~ '(^|,)\\s*#?[0-9]+[A-Za-z]?\\s+\\S') AS had_street_number,
       (b.latitude IS NOT NULL)                         AS had_coords,
       (NULLIF(btrim(b.unit), '') IS NOT NULL)          AS had_unit,
       COALESCE(${labelFor('b.location')}, '')          AS public_label_after
FROM public.bounties b
WHERE b.location ~ '[0-9#]' OR b.latitude IS NOT NULL OR NULLIF(btrim(b.unit), '') IS NOT NULL
ORDER BY b.created_at DESC
LIMIT 40`;
}

// Copies of addresses outside bounties. Informational: these are not changed
// by the migration, the report says who can read each.
const OTHER_COPIES_SQL = `
SELECT 'pending_bounties.location (owner-only, deferred funding)' AS source,
       count(*) FILTER (WHERE location ~ '(^|,)\\s*#?[0-9]+[A-Za-z]?\\s+\\S') AS rows_with_street_number
FROM public.pending_bounties
UNION ALL
SELECT 'bounties.description (poster-authored free text)',
       count(*) FILTER (WHERE description ~* '\\m[0-9]{2,6}\\s+[A-Za-z]+(\\s+[A-Za-z]+)?\\s+(st|street|rd|road|ave|avenue|blvd|dr|drive|ln|lane|way|ct|court)\\M')
FROM public.bounties`;

async function main() {
  const env = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
  const exprs = inlineLabelSql();
  const client = await connect(env);
  try {
    await client.query('BEGIN READ ONLY');
    const migrated = await client.query("SELECT to_regclass('public.bounty_private_locations') IS NOT NULL AS applied");
    console.log(`env=${env} migration_already_applied=${migrated.rows[0].applied}`);

    const counts = await client.query(countsSql(exprs));
    console.log('\nCounts (public.bounties):');
    console.table(Object.entries(counts.rows[0]).map(([k, v]) => ({ metric: k, rows: Number(v) })));

    const preview = await client.query(previewSql(exprs));
    console.log('\nRows that change (newest 40; raw values deliberately not shown):');
    console.table(preview.rows);

    try {
      await client.query('SAVEPOINT other');
      const other = await client.query(OTHER_COPIES_SQL);
      console.log('\nCopies outside public.bounties (not modified by the migration):');
      console.table(other.rows);
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT other');
      console.log(`\n(other-copies check skipped: ${e.message})`);
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

module.exports = { inlineLabelSql, countsSql };
