#!/usr/bin/env node
/**
 * One-off backfill: a user with exactly one payment method gets it as the
 * default, in payment_methods (is_default = true) and on Stripe
 * (customer.invoice_settings.default_payment_method).
 *
 *   node scripts/backfill-sole-payment-method-default.mjs                  # staging, dry run
 *   node scripts/backfill-sole-payment-method-default.mjs --apply          # staging, writes
 *   node scripts/backfill-sole-payment-method-default.mjs --env=production --allow-live-stripe
 *
 * Prints the planned changes and writes nothing unless --apply is passed.
 *
 * The rule is the one the edge functions run on every save, imported from
 * supabase/functions/_shared/sole-payment-method-default.ts (Node strips the
 * types), so the backfill can't drift from it. A method on some customer other
 * than the profile's is skipped and listed: hiring charges the profile customer,
 * so it can't be the default. scripts/report-split-stripe-customers.mjs lists
 * those accounts.
 *
 * Reads .env.<env> (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY).
 * Refuses a live Stripe key unless --allow-live-stripe is passed, so the default
 * never calls live mode, not even to read.
 *
 * Reversible: --apply writes every change with its previous values to a JSON
 * log (--log=<path>, default in the OS temp folder). To undo a row, set
 * is_default back to previous.dbIsDefault and the customer's
 * invoice_settings.default_payment_method back to previous.stripeDefault.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applySoleDefaultPlan,
  readSoleDefaultPlan,
} from '../supabase/functions/_shared/sole-payment-method-default.ts';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const ENV = opt('env', 'staging');
const APPLY = flag('apply');
const ALLOW_LIVE = flag('allow-live-stripe');
const ONLY_USER = opt('user', null);
const LOG_PATH = opt(
  'log',
  join(tmpdir(), `sole-payment-method-default-${ENV}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
);

function envFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function allRows(supabase) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('payment_methods')
      .select('user_id')
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function main() {
  if (!['staging', 'production'].includes(ENV)) fail(`--env must be staging or production, not ${ENV}`);
  const env = envFile(`.env.${ENV}`);
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) fail(`.env.${ENV} needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`);
  if (!STRIPE_SECRET_KEY?.startsWith('sk_')) fail(`.env.${ENV} needs STRIPE_SECRET_KEY`);
  const live = !STRIPE_SECRET_KEY.startsWith('sk_test_');
  if (live && !ALLOW_LIVE) {
    fail(`Refusing: .env.${ENV} has a live Stripe key. Pass --allow-live-stripe to run against live mode.`);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

  console.log(
    `${APPLY ? 'APPLY' : 'DRY RUN'} on ${ENV} (${new URL(SUPABASE_URL).hostname.split('.')[0]}), Stripe ${live ? 'LIVE' : 'test'} mode`
  );

  const counts = new Map();
  for (const r of await allRows(supabase)) counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1);
  const users = [...counts].filter(([id, n]) => n === 1 && (!ONLY_USER || id === ONLY_USER)).map(([id]) => id);
  console.log(`${counts.size} users have payment methods; ${users.length} have exactly one.\n`);

  const planned = [];
  const skipped = {};
  const applied = [];
  const errors = [];
  for (const userId of users) {
    let plan;
    try {
      plan = await readSoleDefaultPlan({ supabase, stripe, userId });
    } catch (err) {
      errors.push({ userId, step: 'read', message: err?.message });
      continue;
    }
    if (!plan.eligible) {
      (skipped[plan.reason] ??= []).push({ userId, paymentMethodId: plan.paymentMethodId });
      continue;
    }
    if (!plan.setDb && !plan.setStripe) continue;
    planned.push({ userId, ...plan });

    console.log(
      `${userId}  ${plan.paymentMethodId}  ` +
        [
          plan.setDb ? `is_default ${plan.previous.dbIsDefault} -> true` : null,
          plan.setStripe
            ? `stripe default ${plan.previous.stripeDefault ?? 'none'} -> ${plan.paymentMethodId} (${plan.profileCustomerId})`
            : null,
        ]
          .filter(Boolean)
          .join(', ')
    );

    if (APPLY) {
      try {
        await applySoleDefaultPlan({ supabase, stripe, plan });
        applied.push({ userId, ...plan, appliedAt: new Date().toISOString() });
      } catch (err) {
        errors.push({ userId, step: 'apply', message: err?.message });
      }
    }
  }

  console.log(`\n${planned.length} to change${APPLY ? `, ${applied.length} changed` : ''}.`);
  for (const [reason, list] of Object.entries(skipped)) {
    console.log(`Skipped, ${reason}: ${list.length}`);
    if (reason === 'not_on_profile_customer') {
      for (const s of list) console.log(`  ${s.userId}  ${s.paymentMethodId}`);
    }
  }
  if (errors.length) {
    console.log(`Errors: ${errors.length}`);
    for (const e of errors) console.log(`  ${e.userId} (${e.step}): ${e.message}`);
  }

  if (APPLY && applied.length) {
    writeFileSync(LOG_PATH, JSON.stringify({ env: ENV, live, applied }, null, 2));
    console.log(`\nWrote the undo log: ${LOG_PATH}`);
  } else if (!APPLY && planned.length) {
    console.log('\nNothing written. Pass --apply to make these changes.');
  }
  process.exit(errors.length ? 1 : 0);
}

main().catch(err => fail(err?.stack ?? String(err)));
