#!/usr/bin/env node
/**
 * Read-only report: people whose website checkout used a different Stripe
 * customer from profiles.stripe_customer_id, so their payments and cards are
 * split across two customers.
 *
 *   node scripts/report-split-stripe-customers.mjs                    # staging
 *   node scripts/report-split-stripe-customers.mjs --env=production
 *   node scripts/report-split-stripe-customers.mjs --show-email --json
 *
 * Merges nothing and deletes nothing. Stripe has no customer merge: fixing an
 * account means a person deciding which customer to keep, moving or re-saving
 * its cards, and setting profiles.stripe_customer_id. This lists who needs it.
 *
 * Where a checkout customer is recorded:
 *   bounty_payments.stripe_customer_id  every paid website post (and any other
 *                                       payment that stored one), by poster
 *   pending_bounties.claim_card         a card-at-post card held for sign-in,
 *                                       on a customer made for it
 *
 * The database is read with scripts/lib/ro-query.js: BEGIN READ ONLY, then
 * ROLLBACK, so this cannot write. It makes no Stripe calls.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { connect } = require('./lib/ro-query.js');

const args = process.argv.slice(2);
const ENV = (args.find(a => a.startsWith('--env=')) ?? '--env=staging').slice(6);
const SHOW_EMAIL = args.includes('--show-email');
const AS_JSON = args.includes('--json');

async function hasColumns(client, table, columns) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = any($2)`,
    [table, columns]
  );
  return rows.length === columns.length;
}

async function main() {
  if (!['staging', 'production', 'local'].includes(ENV)) {
    throw new Error(`--env must be staging, production or local, not ${ENV}`);
  }
  const client = await connect(ENV);
  try {
    await client.query('BEGIN READ ONLY');

    // claim_card arrived with card-at-post (20261104120000); read it only where it exists.
    const withHeld = await hasColumns(client, 'pending_bounties', ['claim_card', 'claim_user_id']);
    const held = withHeld
      ? `union all
         select pb.claim_user_id, pb.claim_card ->> 'customer_id', 'held_card',
                coalesce(pb.claim_requested_at, pb.created_at)
           from public.pending_bounties pb
          where pb.claim_user_id is not null
            and pb.claim_card ->> 'customer_id' is not null`
      : '';

    const { rows } = await client.query(`
      with seen as (
        select bp.poster_id as user_id,
               bp.stripe_customer_id as customer_id,
               coalesce(bp.metadata ->> 'source', 'bounty_payment') as source,
               bp.created_at as at
          from public.bounty_payments bp
         where bp.stripe_customer_id is not null
           and bp.poster_id is not null
        ${held}
      )
      select p.id as user_id,
             ${SHOW_EMAIL ? 'p.email,' : ''}
             coalesce(p.is_internal, false) as is_internal,
             p.stripe_customer_id as profile_customer,
             s.customer_id as other_customer,
             string_agg(distinct s.source, ',' order by s.source) as seen_in,
             count(*)::int as times,
             max(s.at) as last_seen,
             (select count(*)::int from public.payment_methods pm where pm.user_id = p.id) as saved_methods,
             (select count(*)::int from public.payment_methods pm
               where pm.user_id = p.id and pm.is_default) as default_methods
        from seen s
        join public.profiles p on p.id = s.user_id
       where p.stripe_customer_id is distinct from s.customer_id
       group by p.id, ${SHOW_EMAIL ? 'p.email,' : ''} p.is_internal, p.stripe_customer_id, s.customer_id
       order by coalesce(p.is_internal, false), max(s.at) desc
    `);

    if (AS_JSON) {
      console.log(JSON.stringify({ env: ENV, rows }, null, 2));
      return;
    }

    const people = new Set(rows.map(r => r.user_id));
    const noProfileCustomer = rows.filter(r => !r.profile_customer).length;
    console.log(`Split Stripe customers on ${ENV} (read-only): ${people.size} people, ${rows.length} pairs.`);
    console.log(
      `  ${noProfileCustomer} have no profile customer (setting it to the checkout customer is the fix);` +
        ` ${rows.length - noProfileCustomer} have two (a person picks which to keep).`
    );
    if (rows.length) {
      console.table(
        rows.map(r => ({
          ...r,
          last_seen: r.last_seen ? new Date(r.last_seen).toISOString().slice(0, 10) : null,
        }))
      );
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

main().catch(err => {
  console.error(err?.message ?? err);
  process.exit(1);
});
