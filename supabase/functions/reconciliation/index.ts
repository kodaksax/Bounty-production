// Supabase Edge Function: reconciliation
//
// Phase 8 of the Stripe Connect native wallet migration.
//
// Continuously verifies that Stripe and the local ledger agree, and makes the
// disagreements visible. Three rules govern everything in this file:
//
//   1. Stripe is the source of truth. The ledger mirrors it. Where they
//      disagree, Stripe is right and the ledger is stale or wrong.
//   2. Never silently repair. A repair is only performed when it is provably
//      safe (see isSafeStatusRepair), it only ever moves the LEDGER toward
//      what Stripe already did, and every repair is recorded as a finding.
//   3. Never fabricate. No Stripe object is created here, no money moves, and
//      nothing is marked complete unless Stripe has already completed it.
//
// Routes:
//   POST /reconciliation          { action: 'run' }     — the 15-minute job (cron secret)
//   POST /reconciliation          { action: 'health' }  — admin dashboard summary (admin JWT)
//
// @ts-ignore: Allow runtime URL import for Deno/edge function.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// @ts-ignore: Allow runtime npm import for Deno/edge function.
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
// @ts-ignore: Allow runtime URL import for Deno/edge function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// @ts-ignore: Deno global is not present in the Node typecheck environment.
declare const Deno: { env: { get(key: string): string | undefined } };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------
// Tuned to Stripe's own timings rather than round numbers: a standard payout
// legitimately takes 1-2 business days, so 24h pending is normal and only
// becomes suspicious well beyond that.

/** A payout still not paid after this long is a WARNING. */
const PAYOUT_PENDING_WARN_HOURS = 24;
/** A transfer not settled after this long is a WARNING — transfers are near-instant.
 * TODO: not currently checked anywhere in this file — payouts (line ~568) and
 * generic stale-pending withdrawals (line ~757) are, but pending transfers
 * have no dedicated staleness check yet. */
// deno-lint-ignore no-unused-vars
const TRANSFER_PENDING_WARN_HOURS = 2;
/** A ledger withdrawal stuck 'pending' with no Stripe payout at all. */
const STALE_PENDING_WARN_HOURS = 2;
/** Beyond this, a stuck payout stops being slow and starts being broken. */
const PAYOUT_PENDING_CRITICAL_HOURS = 72;

/** How far back each run looks. Generous overlap so nothing falls between runs. */
const RECONCILE_WINDOW_HOURS = 72;

const HOUR_MS = 60 * 60 * 1000;

type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
type Health = 'GREEN' | 'YELLOW' | 'RED';

interface Finding {
  findingType: string;
  severity: Severity;
  userId: string | null;
  details: Record<string, unknown>;
}

interface UnreconciledEntry {
  kind: string;
  payoutId?: string;
  transactionId?: string;
  userId?: string | null;
  stripeStatus?: string;
  ledgerStatus?: string;
  amountCents?: number;
  ageHours?: number;
}

interface DriftReport {
  timestamp: string;
  durationMs: number;
  reconciled: number;
  mismatched: number;
  orphanStripe: number;
  orphanLedger: number;
  stalePending: number;
  totalStripeAmountCents: number;
  totalLedgerAmountCents: number;
  deltaCents: number;
  safeRepairs: number;
  /** Withdrawals asserting completion with no Stripe payout behind them. */
  completedWithoutPayout: number;
  /** Withdrawals still pending long past normal payout settlement. */
  paidButNotCompleted: number;
  health: Health;
  unreconciled: UnreconciledEntry[];
}

/**
 * Projects a Stripe payout status onto ledger vocabulary.
 *
 * in_transit maps to 'pending' deliberately: the money is still in flight.
 * Treating in-flight as settled is the legacy bug this whole migration exists
 * to remove, and re-introducing it here would make reconciliation certify it.
 */
export function normalizeStripeStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'paid':
      return 'completed';
    case 'pending':
    case 'in_transit':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'cancelled';
    default:
      return stripeStatus;
  }
}

/**
 * Whether a ledger row may be moved to match Stripe automatically.
 *
 * Safe means: Stripe has reached a TERMINAL state, the ledger has not caught
 * up, and applying Stripe's state removes information asymmetry without
 * inventing anything. Concretely we only ever advance a 'pending' ledger row
 * to what Stripe already finished doing.
 *
 * Everything else — amount disagreements, orphans, a ledger row that claims
 * completion Stripe does not corroborate — is NOT repairable here. Those
 * indicate we are wrong about something real, and quietly overwriting them
 * would destroy the evidence.
 */
export function isSafeStatusRepair(
  stripeStatus: string,
  ledgerStatus: string,
  metadata?: Record<string, unknown> | null
): boolean {
  // Only ever repair FROM pending. A ledger row already claiming a terminal
  // state that disagrees with Stripe is a genuine conflict, not a lag.
  if (ledgerStatus !== 'pending') return false;

  if (stripeStatus === 'paid') return true;

  // Failed/canceled only auto-repair for Connect-native payouts, which never
  // debited profiles.balance in the first place. Legacy withdrawals need an
  // atomic balance refund with the status change; reconciliation only reports
  // those mismatches so a separate repair path can apply both together.
  if (stripeStatus === 'failed' || stripeStatus === 'canceled') {
    return metadata?.connect_native === true;
  }

  return false;
}

/** Health rolls up from the worst thing seen. */
export function computeHealth(counts: {
  mismatched: number;
  orphanStripe: number;
  orphanLedger: number;
  stalePending: number;
  deltaCents: number;
  criticalFindings: number;
}): Health {
  if (
    counts.criticalFindings > 0 ||
    counts.orphanStripe > 0 ||
    counts.orphanLedger > 0 ||
    counts.deltaCents !== 0
  ) {
    return 'RED';
  }
  if (counts.mismatched > 0 || counts.stalePending > 0) return 'YELLOW';
  return 'GREEN';
}

/**
 * Emits an alert through the project's existing structured-logging convention:
 * console.error for CRITICAL (picked up as an error by the log drain), warn
 * for WARNING. The [reconciliation-alert] prefix is the searchable key.
 */
function alert(severity: Severity, findingType: string, details: Record<string, unknown>): void {
  const payload = JSON.stringify({ severity, findingType, ...details });
  if (severity === 'CRITICAL') {
    console.error(`[reconciliation-alert][CRITICAL] ${findingType}`, payload);
  } else if (severity === 'WARNING') {
    console.warn(`[reconciliation-alert][WARNING] ${findingType}`, payload);
  } else {
    console.log(`[reconciliation-alert][INFO] ${findingType}`, payload);
  }
}

const hoursSince = (epochSecondsOrIso: number | string): number => {
  const ms =
    typeof epochSecondsOrIso === 'number'
      ? epochSecondsOrIso * 1000
      : new Date(epochSecondsOrIso).getTime();
  return (Date.now() - ms) / HOUR_MS;
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return jsonResponse({ error: 'Stripe not configured' }, 500);
  const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === 'string' ? body.action : 'run';

  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const cronSecret = Deno.env.get('RECONCILIATION_CRON_SECRET') ?? '';

  // ---------------------------------------------------------------------
  // Auth. The cron job presents a shared secret; a human presents an admin
  // JWT. Health is readable by either; running is restricted to cron/admin
  // so a reconciliation pass cannot be triggered as a denial-of-service.
  // ---------------------------------------------------------------------
  const isCron = !!cronSecret && bearer === cronSecret;
  let isAdmin = false;
  if (!isCron && bearer) {
    const { data: userData } = await supabase.auth.getUser(bearer);
    const role = (userData?.user?.app_metadata as { role?: string } | undefined)?.role;
    isAdmin = role === 'admin';
  }
  if (!isCron && !isAdmin) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // =====================================================================
  // action: health — admin dashboard summary
  // =====================================================================
  if (action === 'health') {
    const { data: latest } = await supabase
      .from('reconciliation_reports')
      .select('*')
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: openFindings } = await supabase
      .from('reconciliation_findings')
      .select('id, finding_type, severity, user_id, details, run_at')
      .is('resolved_at', null)
      .order('run_at', { ascending: false })
      .limit(100);

    const findings = (openFindings ?? []) as Array<Record<string, unknown>>;
    const criticalOpen = findings.filter(f => f.severity === 'CRITICAL').length;
    const warningOpen = findings.filter(f => f.severity === 'WARNING').length;

    const report = latest as Record<string, unknown> | null;

    // A stale job is itself a health problem: if reconciliation has not run,
    // GREEN would be a claim we have no evidence for.
    const lastRunAt = report?.run_at ? new Date(report.run_at as string) : null;
    const minutesSinceRun = lastRunAt ? (Date.now() - lastRunAt.getTime()) / 60000 : null;
    const jobStale = minutesSinceRun === null || minutesSinceRun > 45;

    let health: Health = (report?.health as Health) ?? 'RED';
    if (jobStale) health = 'RED';
    else if (criticalOpen > 0) health = 'RED';
    else if (warningOpen > 0 && health === 'GREEN') health = 'YELLOW';

    return jsonResponse({
      health,
      jobStale,
      minutesSinceLastRun: minutesSinceRun,
      lastReport: report,
      openFindings: {
        critical: criticalOpen,
        warning: warningOpen,
        total: findings.length,
        items: findings.slice(0, 25),
      },
    });
  }

  // =====================================================================
  // action: migration_report — Phase 7 Stage B
  //
  // Per-user comparison of the legacy ledger balance against the money
  // actually held in Stripe, classified Clean / Mismatch / Needs Review.
  // Strictly read-only: this decides nothing and changes nothing, it only
  // tells us whether profiles.balance can ever be retired.
  //
  // Note the two figures are NOT expected to be equal in general. Under the
  // legacy model profiles.balance is money the platform custodies on the
  // user's behalf and has NOT sent to Stripe; under the Connect-native model
  // the money is in the connected account and profiles.balance is 0. A user
  // with balance in both places is mid-migration, which is the case that
  // needs a human.
  // =====================================================================
  if (action === 'migration_report') {
    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, username, balance, balance_on_hold, stripe_connect_account_id')
      .or('balance.gt.0,stripe_connect_account_id.not.is.null');

    const rows = (allProfiles ?? []) as Array<{
      id: string;
      username: string | null;
      balance: number | null;
      balance_on_hold: number | null;
      stripe_connect_account_id: string | null;
    }>;

    const entries: Array<Record<string, unknown>> = [];
    let clean = 0;
    let mismatch = 0;
    let needsReview = 0;

    for (const r of rows) {
      const legacyCents = Math.round(Number(r.balance ?? 0) * 100);
      const holdCents = Math.round(Number(r.balance_on_hold ?? 0) * 100);

      let stripeAvailableCents: number | null = null;
      let stripePendingCents: number | null = null;
      let readError: string | null = null;

      if (r.stripe_connect_account_id) {
        try {
          const bal = await stripe.balance.retrieve({
            stripeAccount: r.stripe_connect_account_id,
          });
          stripeAvailableCents = (bal.available ?? [])
            .filter((b: { currency: string }) => b.currency === 'usd')
            .reduce((t: number, b: { amount: number }) => t + (b.amount ?? 0), 0);
          stripePendingCents = (bal.pending ?? [])
            .filter((b: { currency: string }) => b.currency === 'usd')
            .reduce((t: number, b: { amount: number }) => t + (b.amount ?? 0), 0);
        } catch (e) {
          readError = (e as { message?: string })?.message ?? 'balance read failed';
        }
      }

      // Classification:
      //   Clean        — legacy balance drained to zero; nothing to migrate.
      //   Mismatch     — legacy balance remains and the user CAN be paid out
      //                  (has an onboarded Connect account) — actionable.
      //   Needs Review — legacy balance remains with no way to pay it out, or
      //                  we could not read Stripe. A human must decide.
      let status: 'Clean' | 'Mismatch' | 'Needs Review';
      if (readError) {
        status = 'Needs Review';
      } else if (legacyCents === 0 && holdCents === 0) {
        status = 'Clean';
      } else if (r.stripe_connect_account_id) {
        status = 'Mismatch';
      } else {
        status = 'Needs Review';
      }

      if (status === 'Clean') clean++;
      else if (status === 'Mismatch') mismatch++;
      else needsReview++;

      // Only report rows that matter — a Clean row with no Connect account and
      // no balance is just an ordinary user, not migration state.
      if (status !== 'Clean' || legacyCents !== 0) {
        entries.push({
          userId: r.id,
          username: r.username,
          legacyBalanceCents: legacyCents,
          legacyOnHoldCents: holdCents,
          hasConnectAccount: !!r.stripe_connect_account_id,
          stripeAvailableCents,
          stripePendingCents,
          // Difference is informational only. These are different pots of
          // money, so a non-zero value is expected mid-migration.
          differenceCents:
            stripeAvailableCents === null ? null : legacyCents - stripeAvailableCents,
          status,
          readError,
        });
      }
    }

    const totalLegacyCents = entries.reduce(
      (t, e) => t + ((e.legacyBalanceCents as number) ?? 0),
      0
    );

    const retirementReady = mismatch === 0 && needsReview === 0;

    console.log('[reconciliation] migration report', {
      clean,
      mismatch,
      needsReview,
      totalLegacyCents,
      retirementReady,
    });

    return jsonResponse({
      timestamp: new Date().toISOString(),
      summary: { clean, mismatch, needsReview, totalLegacyCents },
      // profiles.balance may only be retired once every account reconciles.
      retirementReady,
      entries,
    });
  }

  if (action !== 'run') {
    return jsonResponse({ error: `Unknown action: ${action}`, code: 'unknown_action' }, 400);
  }

  // =====================================================================
  // action: run — the reconciliation pass
  // =====================================================================
  const startedAt = Date.now();
  const findings: Finding[] = [];
  const unreconciled: UnreconciledEntry[] = [];
  let reconciled = 0;
  let mismatched = 0;
  let orphanStripe = 0;
  let orphanLedger = 0;
  let stalePending = 0;
  let safeRepairs = 0;
  let completedWithoutPayout = 0;
  let paidButNotCompleted = 0;
  let totalStripeAmountCents = 0;
  let totalLedgerAmountCents = 0;

  try {
    const windowStart = new Date(Date.now() - RECONCILE_WINDOW_HOURS * HOUR_MS);
    const windowStartEpoch = Math.floor(windowStart.getTime() / 1000);

    // -----------------------------------------------------------------
    // Gather: every Connect account we know about, and every ledger
    // withdrawal in the window. Reconciliation is per-account because
    // payouts live on the connected account, not the platform.
    // -----------------------------------------------------------------
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, stripe_connect_account_id')
      .not('stripe_connect_account_id', 'is', null);

    const accounts = (profiles ?? []) as Array<{ id: string; stripe_connect_account_id: string }>;

    const { data: ledgerRows } = await supabase
      .from('wallet_transactions')
      .select('id, user_id, amount, status, stripe_payout_id, stripe_transfer_id, payout_method, metadata, created_at')
      .eq('type', 'withdrawal')
      .gte('created_at', windowStart.toISOString());

    const ledger = (ledgerRows ?? []) as Array<Record<string, unknown>>;
    const ledgerByPayoutId = new Map<string, Record<string, unknown>>();
    for (const row of ledger) {
      if (typeof row.stripe_payout_id === 'string') {
        ledgerByPayoutId.set(row.stripe_payout_id, row);
      }
    }

    const seenPayoutIds = new Set<string>();

    // -----------------------------------------------------------------
    // Stripe payouts, per connected account.
    // -----------------------------------------------------------------
    for (const acct of accounts) {
      let payouts: Stripe.ApiList<Stripe.Payout>;
      try {
        payouts = await stripe.payouts.list(
          { limit: 100, created: { gte: windowStartEpoch } },
          { stripeAccount: acct.stripe_connect_account_id }
        );
      } catch (listError) {
        // An account we cannot read is a gap in coverage, not a clean pass.
        findings.push({
          findingType: 'stripe_account_unreadable',
          severity: 'WARNING',
          userId: acct.id,
          details: {
            accountId: acct.stripe_connect_account_id,
            error: (listError as { message?: string })?.message ?? 'unknown',
          },
        });
        continue;
      }

      for (const payout of payouts.data) {
        seenPayoutIds.add(payout.id);
        totalStripeAmountCents += payout.amount;

        const local = ledgerByPayoutId.get(payout.id);
        const ageH = hoursSince(payout.created);

        // --- Orphan Stripe payout: real money moved, we have no record ---
        if (!local) {
          orphanStripe++;
          unreconciled.push({
            kind: 'orphan_stripe_payout',
            payoutId: payout.id,
            userId: acct.id,
            stripeStatus: payout.status,
            amountCents: payout.amount,
            ageHours: Math.round(ageH),
          });
          findings.push({
            findingType: 'orphan_stripe_payout',
            severity: 'CRITICAL',
            userId: acct.id,
            details: {
              payoutId: payout.id,
              accountId: acct.stripe_connect_account_id,
              amountCents: payout.amount,
              status: payout.status,
              ageHours: Math.round(ageH),
              note: 'Stripe paid out money with no corresponding ledger row. Do not create one automatically — investigate why it is missing.',
            },
          });
          alert('CRITICAL', 'orphan_stripe_payout', {
            payoutId: payout.id,
            userId: acct.id,
            amountCents: payout.amount,
          });
          continue;
        }

        const ledgerStatus = local.status as string;
        const expected = normalizeStripeStatus(payout.status);
        totalLedgerAmountCents += Math.abs(Number(local.amount ?? 0)) * 100;

        // --- Amount mismatch: never repairable, always critical ---
        const ledgerCents = Math.round(Math.abs(Number(local.amount ?? 0)) * 100);
        if (ledgerCents !== payout.amount) {
          mismatched++;
          unreconciled.push({
            kind: 'amount_mismatch',
            payoutId: payout.id,
            transactionId: local.id as string,
            userId: acct.id,
            stripeStatus: payout.status,
            ledgerStatus,
            amountCents: payout.amount,
          });
          findings.push({
            findingType: 'amount_mismatch',
            severity: 'CRITICAL',
            userId: acct.id,
            details: {
              payoutId: payout.id,
              transactionId: local.id,
              stripeAmountCents: payout.amount,
              ledgerAmountCents: ledgerCents,
              note: 'Amounts disagree. Never auto-corrected — one of the two records is wrong about real money.',
            },
          });
          alert('CRITICAL', 'amount_mismatch', {
            payoutId: payout.id,
            stripeAmountCents: payout.amount,
            ledgerAmountCents: ledgerCents,
          });
          continue;
        }

        // --- Status agreement ---
        if (ledgerStatus === expected) {
          reconciled++;

          // Agreement is not the end of it: a payout both sides agree is
          // pending can still be pending for far too long.
          if (expected === 'pending' && ageH > PAYOUT_PENDING_WARN_HOURS) {
            const severity: Severity =
              ageH > PAYOUT_PENDING_CRITICAL_HOURS ? 'CRITICAL' : 'WARNING';
            findings.push({
              findingType: 'payout_pending_too_long',
              severity,
              userId: acct.id,
              details: {
                payoutId: payout.id,
                transactionId: local.id,
                ageHours: Math.round(ageH),
                stripeStatus: payout.status,
              },
            });
            alert(severity, 'payout_pending_too_long', {
              payoutId: payout.id,
              ageHours: Math.round(ageH),
            });
            unreconciled.push({
              kind: 'payout_pending_too_long',
              payoutId: payout.id,
              transactionId: local.id as string,
              userId: acct.id,
              stripeStatus: payout.status,
              ledgerStatus,
              ageHours: Math.round(ageH),
            });
          }
          continue;
        }

        // --- Statuses disagree ---
        if (isSafeStatusRepair(payout.status, ledgerStatus, (local.metadata as Record<string, unknown> | null | undefined) ?? null)) {
          // Provably safe: Stripe reached a terminal state, our row is still
          // pending. Move the ledger to match what Stripe already did. This
          // moves no money and invents nothing.
          const { error: repairError } = await supabase
            .from('wallet_transactions')
            .update({
              status: expected,
              updated_at: new Date().toISOString(),
              ...(expected === 'completed' ? { completed_at: new Date().toISOString() } : {}),
            })
            .eq('id', local.id as string)
            .eq('status', 'pending'); // CAS: only if still pending

          if (repairError) {
            findings.push({
              findingType: 'safe_repair_failed',
              severity: 'WARNING',
              userId: acct.id,
              details: { payoutId: payout.id, transactionId: local.id, error: repairError.message },
            });
          } else {
            safeRepairs++;
            // A repair is still a finding: it records that we were out of
            // sync, which is information worth keeping even once fixed.
            findings.push({
              findingType: 'ledger_status_repaired',
              severity: 'INFO',
              userId: acct.id,
              details: {
                payoutId: payout.id,
                transactionId: local.id,
                from: ledgerStatus,
                to: expected,
                stripeStatus: payout.status,
              },
            });
            alert('INFO', 'ledger_status_repaired', {
              payoutId: payout.id,
              from: ledgerStatus,
              to: expected,
            });
          }
          continue;
        }

        // Not safely repairable — the ledger claims something Stripe does not
        // corroborate. Surface it and leave it alone.
        mismatched++;
        unreconciled.push({
          kind: 'status_mismatch',
          payoutId: payout.id,
          transactionId: local.id as string,
          userId: acct.id,
          stripeStatus: payout.status,
          ledgerStatus,
          amountCents: payout.amount,
        });
        findings.push({
          findingType: 'status_mismatch',
          severity: 'CRITICAL',
          userId: acct.id,
          details: {
            payoutId: payout.id,
            transactionId: local.id,
            stripeStatus: payout.status,
            ledgerStatus,
            note: 'Ledger claims a state Stripe does not corroborate. Not auto-repaired — requires investigation.',
          },
        });
        alert('CRITICAL', 'status_mismatch', {
          payoutId: payout.id,
          stripeStatus: payout.status,
          ledgerStatus,
        });
      }

      // ---------------------------------------------------------------
      // Transfers into this account. Transfers are effectively immediate,
      // so one sitting unsettled is a much earlier warning sign than a
      // slow payout.
      // ---------------------------------------------------------------
      try {
        const transfers = await stripe.transfers.list({
          destination: acct.stripe_connect_account_id,
          limit: 100,
          created: { gte: windowStartEpoch },
        });
        for (const tr of transfers.data) {
          const ageH = hoursSince(tr.created);
          // A reversed transfer that the ledger still treats as money in
          // hand is a real correctness problem.
          if (tr.reversed && tr.amount_reversed >= tr.amount) {
            findings.push({
              findingType: 'transfer_fully_reversed',
              severity: 'CRITICAL',
              userId: acct.id,
              details: { transferId: tr.id, amountCents: tr.amount, ageHours: Math.round(ageH) },
            });
            alert('CRITICAL', 'transfer_fully_reversed', { transferId: tr.id, userId: acct.id });
            unreconciled.push({
              kind: 'transfer_fully_reversed',
              userId: acct.id,
              amountCents: tr.amount,
              ageHours: Math.round(ageH),
            });
          }
        }
      } catch (transferError) {
        findings.push({
          findingType: 'stripe_transfers_unreadable',
          severity: 'WARNING',
          userId: acct.id,
          details: { error: (transferError as { message?: string })?.message ?? 'unknown' },
        });
      }
    }

    // -----------------------------------------------------------------
    // Ledger-side sweep: rows Stripe never accounted for.
    // -----------------------------------------------------------------
    for (const row of ledger) {
      const payoutId = row.stripe_payout_id;
      const status = row.status as string;
      const ageH = hoursSince(row.created_at as string);

      if (typeof payoutId === 'string') {
        if (!seenPayoutIds.has(payoutId)) {
          // We recorded a payout id Stripe did not return in the window.
          orphanLedger++;
          unreconciled.push({
            kind: 'orphan_ledger_withdrawal',
            payoutId,
            transactionId: row.id as string,
            userId: (row.user_id as string) ?? null,
            ledgerStatus: status,
            ageHours: Math.round(ageH),
          });
          findings.push({
            findingType: 'orphan_ledger_withdrawal',
            severity: 'CRITICAL',
            userId: (row.user_id as string) ?? null,
            details: {
              payoutId,
              transactionId: row.id,
              ledgerStatus: status,
              ageHours: Math.round(ageH),
              note: 'Ledger references a Stripe payout Stripe did not return. Never fabricate the payout — verify in the Stripe dashboard.',
            },
          });
          alert('CRITICAL', 'orphan_ledger_withdrawal', { payoutId, transactionId: row.id });
        }
        continue;
      }

      // No payout id at all.
      //
      // THE 2026-08-13 BLIND SPOT. This branch used to be guarded by
      // `status === 'pending'` alone, so a withdrawal marked 'completed' with
      // a null payout id — the exact shape the instant-payout fallback
      // produced 13 times — fell off the end of this loop untouched. 25 such
      // rows ($526.65) passed through this job every night for a month
      // without raising anything. A completed withdrawal with no payout is
      // the most serious state this system can be in: it asserts a hunter was
      // paid while holding no evidence that anyone was.
      if (status === 'completed') {
        completedWithoutPayout++;
        unreconciled.push({
          kind: 'completed_withdrawal_without_payout',
          transactionId: row.id as string,
          userId: (row.user_id as string) ?? null,
          ledgerStatus: status,
          ageHours: Math.round(ageH),
        });
        findings.push({
          findingType: 'completed_withdrawal_without_payout',
          severity: 'CRITICAL',
          userId: (row.user_id as string) ?? null,
          details: {
            transactionId: row.id,
            amount: row.amount,
            ageHours: Math.round(ageH),
            note: 'Withdrawal is completed but references no Stripe payout. Completion is unverifiable — a Transfer alone is not payment. Do not resolve by inventing a payout id; confirm delivery in Stripe first.',
          },
        });
        alert('CRITICAL', 'completed_withdrawal_without_payout', {
          transactionId: row.id,
          userId: row.user_id,
          amount: row.amount,
        });
        continue;
      }

      // manually_paid is an explicit human decision recorded via
      // mark_externally_settled and is expected to have no Stripe payout.
      if (status === 'manually_paid') continue;

      // Pending with no payout id: either the payout was never created (the
      // /connect routes log CRITICAL when payouts.create throws) or the id was
      // never recorded. Fine briefly, a problem if it persists.
      if (status === 'pending' && ageH > STALE_PENDING_WARN_HOURS) {
        stalePending++;
        unreconciled.push({
          kind: 'stale_pending_withdrawal',
          transactionId: row.id as string,
          userId: (row.user_id as string) ?? null,
          ledgerStatus: status,
          ageHours: Math.round(ageH),
        });
        findings.push({
          findingType: 'stale_pending_withdrawal',
          severity: ageH > PAYOUT_PENDING_CRITICAL_HOURS ? 'CRITICAL' : 'WARNING',
          userId: (row.user_id as string) ?? null,
          details: {
            transactionId: row.id,
            ageHours: Math.round(ageH),
            note: 'Withdrawal pending with no Stripe payout id. Either the payout was never created or the id was never recorded.',
          },
        });
        alert(
          ageH > PAYOUT_PENDING_CRITICAL_HOURS ? 'CRITICAL' : 'WARNING',
          'stale_pending_withdrawal',
          { transactionId: row.id, ageHours: Math.round(ageH) }
        );
      }
    }

    // -----------------------------------------------------------------
    // Invariant sweep — deliberately NOT limited to the reconcile window.
    //
    // "No completed withdrawal may exist without a settled Stripe payout id"
    // is the invariant the 2026-08-13 incident violated 13 times, and the DB
    // CHECK constraint now enforces it going forward. This sweep is the
    // detection half: it reports every existing violation regardless of age,
    // so the historical rows the constraint grandfathers stay visible instead
    // of quietly aging out of a 72-hour window.
    //
    // It reports. It does not repair. Resolving one of these requires
    // confirming in Stripe whether money actually reached the hunter, which
    // is a human decision and never a job's.
    // -----------------------------------------------------------------
    const { data: invariantRows, error: invariantError } = await supabase
      .from('wallet_transactions')
      .select('id, user_id, amount, status, created_at, stripe_transfer_id')
      .eq('type', 'withdrawal')
      .eq('status', 'completed')
      .is('stripe_payout_id', null)
      .order('created_at', { ascending: false })
      .limit(500);

    if (invariantError) {
      findings.push({
        findingType: 'invariant_sweep_failed',
        severity: 'WARNING',
        userId: null,
        details: { error: invariantError.message },
      });
    } else {
      const violations = (invariantRows ?? []) as Array<Record<string, unknown>>;
      if (violations.length > 0) {
        const totalCents = violations.reduce(
          (sum, r) => sum + Math.round(Math.abs(Number(r.amount ?? 0)) * 100),
          0
        );
        findings.push({
          findingType: 'completed_withdrawal_without_payout_total',
          severity: 'CRITICAL',
          userId: null,
          details: {
            count: violations.length,
            totalCents,
            oldest: violations[violations.length - 1]?.created_at ?? null,
            newest: violations[0]?.created_at ?? null,
            transactionIds: violations.slice(0, 50).map(r => r.id),
            note: 'Withdrawals marked completed with no Stripe payout id. Rows predating 2026-08-15 are the known historical set from the instant-payout fallback incident (25 rows, $526.65) and are grandfathered by the DB constraint; anything newer means the invariant is being bypassed.',
          },
        });
        alert('CRITICAL', 'completed_withdrawal_without_payout_total', {
          count: violations.length,
          totalCents,
        });
      }
    }

    // Reverse direction: a payout Stripe has settled while the ledger still
    // says pending. The safe-repair path above fixes these when the payout is
    // inside the window; this catches the ones that have aged past it, where a
    // hunter has been paid but their history still shows a withdrawal in
    // progress.
    const { data: stuckRows, error: stuckError } = await supabase
      .from('wallet_transactions')
      .select('id, user_id, amount, status, created_at, stripe_payout_id')
      .eq('type', 'withdrawal')
      .eq('status', 'pending')
      .not('stripe_payout_id', 'is', null)
      .lt('created_at', new Date(Date.now() - PAYOUT_PENDING_CRITICAL_HOURS * HOUR_MS).toISOString())
      .limit(200);

    if (!stuckError && (stuckRows ?? []).length > 0) {
      for (const row of (stuckRows ?? []) as Array<Record<string, unknown>>) {
        paidButNotCompleted++;
        findings.push({
          findingType: 'pending_withdrawal_past_payout_deadline',
          severity: 'WARNING',
          userId: (row.user_id as string) ?? null,
          details: {
            transactionId: row.id,
            payoutId: row.stripe_payout_id,
            amount: row.amount,
            ageHours: Math.round(hoursSince(row.created_at as string)),
            note: 'Withdrawal still pending well past normal payout settlement. Check the payout in Stripe: if it is paid, payout.paid was missed and the row needs promoting; if it failed, the balance was never refunded.',
          },
        });
      }
      alert('WARNING', 'pending_withdrawal_past_payout_deadline', {
        count: (stuckRows ?? []).length,
      });
    }

    // -----------------------------------------------------------------
    // Repeated webhook failures.
    // -----------------------------------------------------------------
    try {
      const { count: failedWebhooks } = await supabase
        .from('stripe_events')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('created_at', new Date(Date.now() - 24 * HOUR_MS).toISOString());

      if ((failedWebhooks ?? 0) > 0) {
        const severity: Severity = (failedWebhooks ?? 0) >= 5 ? 'CRITICAL' : 'WARNING';
        findings.push({
          findingType: 'repeated_webhook_failures',
          severity,
          userId: null,
          details: { failedCount: failedWebhooks, windowHours: 24 },
        });
        alert(severity, 'repeated_webhook_failures', { failedCount: failedWebhooks });
      }
    } catch {
      // stripe_events may not carry a status column in every environment;
      // absence of this check must not fail the whole run.
    }

    const deltaCents = totalStripeAmountCents - totalLedgerAmountCents;
    const criticalFindings = findings.filter(f => f.severity === 'CRITICAL').length;
    const health = computeHealth({
      mismatched,
      orphanStripe,
      orphanLedger,
      stalePending,
      deltaCents,
      criticalFindings,
    });

    // Persist findings (skip INFO-level repairs already captured above? no —
    // keep everything; the audit value is in the complete picture).
    //
    // severity is lowercased on the way in: reconciliation_findings carries
    // CHECK (severity IN ('info','warning','critical')) while this file's
    // Severity type is uppercase. Every findings insert from this function had
    // been failing that constraint since it shipped — and because the error is
    // logged and swallowed below, the job reported healthy counts while
    // writing nothing. The findings visible in the table all came from the
    // separate run_withdrawal_reconciliation() DB function, which masked it.
    // Found 2026-08-16 while verifying that the new invariant sweep actually
    // recorded anything.
    if (findings.length > 0) {
      const { error: findingsError } = await supabase.from('reconciliation_findings').insert(
        findings.map(f => ({
          finding_type: f.findingType,
          severity: f.severity.toLowerCase(),
          user_id: f.userId,
          details: f.details,
          auto_repaired: f.findingType === 'ledger_status_repaired',
        }))
      );
      if (findingsError) {
        // Loud: a reconciliation run whose findings vanish is worse than one
        // that did not run, because it looks like a clean pass.
        console.error(
          '[reconciliation-alert][CRITICAL] findings_persist_failed',
          JSON.stringify({ error: findingsError.message, findingCount: findings.length })
        );
      }
    }

    const report: DriftReport = {
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      reconciled,
      mismatched,
      orphanStripe,
      orphanLedger,
      stalePending,
      totalStripeAmountCents,
      totalLedgerAmountCents,
      deltaCents,
      safeRepairs,
      completedWithoutPayout,
      paidButNotCompleted,
      health,
      unreconciled,
    };

    await supabase.from('reconciliation_reports').insert({
      duration_ms: report.durationMs,
      reconciled,
      mismatched,
      orphan_stripe: orphanStripe,
      orphan_ledger: orphanLedger,
      stale_pending: stalePending,
      total_stripe_amount_cents: totalStripeAmountCents,
      total_ledger_amount_cents: totalLedgerAmountCents,
      delta_cents: deltaCents,
      health,
      safe_repairs: safeRepairs,
      unreconciled,
    });

    console.log('[reconciliation] run complete', {
      health,
      reconciled,
      mismatched,
      orphanStripe,
      orphanLedger,
      stalePending,
      safeRepairs,
      completedWithoutPayout,
      paidButNotCompleted,
      deltaCents,
      durationMs: report.durationMs,
    });

    return jsonResponse(report);
  } catch (runError) {
    const message = (runError as { message?: string })?.message ?? 'unknown error';
    console.error('[reconciliation] run failed', message);

    // Write a report even on failure. A crashed job that leaves no row is
    // indistinguishable from a job that never ran, and both look like silence.
    await supabase.from('reconciliation_reports').insert({
      duration_ms: Date.now() - startedAt,
      health: 'RED',
      error: message,
      unreconciled: [],
    });
    alert('CRITICAL', 'reconciliation_run_failed', { error: message });

    return jsonResponse({ error: 'Reconciliation run failed', detail: message, health: 'RED' }, 500);
  }
});
