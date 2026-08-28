/**
 * One-off backfill: put existing Stripe Connect accounts on a MANUAL payout
 * schedule.
 *
 * WHY: standard withdrawals (POST /connect/transfer and the Connect-native
 * /connect/payout path) create an explicit stripe.payouts.create({ method:
 * 'standard' }). Stripe REJECTS API-created standard payouts on accounts left
 * on the default AUTOMATIC schedule with
 * `cannot_create_connect_standard_payouts_through_api`, which stranded
 * withdrawals 'pending' forever (the 2026-08-16 regression). The edge function
 * now self-heals each account on its next withdrawal (ensureManualPayoutSchedule),
 * but this script fixes every account proactively so no user hits the broken
 * path first.
 *
 * SAFE TO RE-RUN: accounts already on `manual` are skipped. Read-only unless an
 * account actually needs the change.
 *
 * Trade-off (deliberate, see docs/payments/CONNECT_NATIVE_PAYOUT_ARCHITECTURE.md
 * §7 R1): under a manual schedule Stripe no longer auto-sweeps the connected
 * account; funds move only when the hunter taps Withdraw. That is the intended
 * "connected account balance == wallet" model this whole flow was built for.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/backfill-manual-payout-schedule.js
 *   # dry run (no writes):
 *   DRY_RUN=1 STRIPE_SECRET_KEY=sk_live_... node scripts/backfill-manual-payout-schedule.js
 */
require('dotenv').config({ path: './api/.env' });
require('dotenv').config();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error('Missing STRIPE_SECRET_KEY in the environment.');
  process.exit(1);
}
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const stripe = require('stripe')(STRIPE_SECRET_KEY);

async function main() {
  console.log(`Backfilling connected accounts to MANUAL payout schedule${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  let processed = 0;
  let changed = 0;
  let alreadyManual = 0;
  let failed = 0;

  // Walk every connected account on the platform.
  for await (const account of stripe.accounts.list({ limit: 100 })) {
    processed += 1;
    const interval = account.settings?.payouts?.schedule?.interval;
    const label = `${account.id} (${account.settings?.dashboard?.display_name || account.email || 'unknown'})`;

    if (interval === 'manual') {
      alreadyManual += 1;
      console.log(`  = ${label}: already manual`);
      continue;
    }

    if (DRY_RUN) {
      changed += 1;
      console.log(`  ~ ${label}: would change ${interval || 'default'} -> manual`);
      continue;
    }

    try {
      await stripe.accounts.update(account.id, {
        settings: { payouts: { schedule: { interval: 'manual' } } },
      });
      changed += 1;
      console.log(`  + ${label}: ${interval || 'default'} -> manual`);
    } catch (err) {
      failed += 1;
      console.error(`  ! ${label}: FAILED — ${err.message}`);
    }
  }

  console.log('\nDone.');
  console.log(`  processed:      ${processed}`);
  console.log(`  already manual: ${alreadyManual}`);
  console.log(`  ${DRY_RUN ? 'would change' : 'changed'}:   ${changed}`);
  console.log(`  failed:         ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
