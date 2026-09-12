// Supabase Edge Function: webhooks
// Handles POST /webhooks/stripe — Stripe webhook event processing.
// This is the most critical function to migrate as it processes payments
// and must verify Stripe's webhook signature.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { analytics as heycatch } from 'npm:@heycatch/sdk@0.7.0/server';
import Stripe from 'npm:stripe@14';
import {
    transitionBountyPaymentForTransfer,
    type BountyPaymentSettlementStatus,
    type StripeTransferEvent,
} from '../_shared/bounty-payment-settlement-state.ts';
import {
  decidePayoutEventAction,
} from '../_shared/payout-state.ts';
import type { WalletTransaction } from '../_shared/types.ts';
import {
    collectWebhookSecrets,
    verifyStripeSignature,
    WEBHOOK_SECRET_ENV_VARS,
} from '../_shared/webhook-signature.ts';

// Module scope, once per server bundle — see the HeyCatch RN/server install
// guide. Business events fired below (payment_completed, payout_success,
// payout_failed) are additive analytics only; they never affect webhook
// control flow or the balance/transfer logic around them.
heycatch.init({ projectKey: 'hck_pk_L0Qj5d0kLrDm_dwGl8j4tSnUlMFnR5vc' });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_TRANSFER_RETRIES = 3;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Structured logging for CRITICAL/manual-reconciliation-required cases — see
// the identical copy in supabase/functions/connect/index.ts for rationale
// (duplicated because local imports aren't supported by the deploy bundler).
function logCritical(event: string, context: Record<string, unknown>) {
  console.error(
    `CRITICAL [webhooks] ${event}`,
    JSON.stringify({ event, ts: new Date().toISOString(), ...context })
  );
}

/**
 * Notification redesign (2026-07-25): this webhook handler historically wrote
 * Payments notifications straight into `public.notifications` (see the
 * insert-then-update-on-conflict blocks below, kept as-is — they're the
 * idempotency source of truth, keyed on stripe_payout_id/transferId/dispute
 * id), which meant Payments notifications never went through
 * notifications_outbox and so never got push, email, preference, or
 * quiet-hours treatment. This helper enqueues a companion outbox row with
 * `data.skipInApp: true` so process-notification (picked up within ~1 minute
 * by the `drain-notifications-outbox` pg_cron job) handles push/email fan-out
 * for the *same* notification without inserting a second, duplicate bell row.
 * Best-effort: a failure here must never fail Stripe webhook processing.
 */
async function enqueuePushEmailFanout(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  params: {
    userId: string;
    type: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { error } = await supabase.from('notifications_outbox').insert({
      recipients: [params.userId],
      title: params.title,
      body: params.body,
      data: { ...params.data, type: params.type, skipInApp: true },
      status: 'pending',
    });
    if (error) {
      console.error('[webhooks] enqueuePushEmailFanout: outbox insert failed (non-fatal)', {
        userId: params.userId,
        type: params.type,
        error,
      });
    }
  } catch (e) {
    console.error('[webhooks] enqueuePushEmailFanout: unexpected error (non-fatal)', e);
  }
}

async function reconcilePhase2Transfer(
  supabase: any,
  transfer: Stripe.Transfer,
  event: StripeTransferEvent
): Promise<void> {
  const bountyId = transfer.metadata?.bounty_id;
  if (!bountyId) return;

  const { data: payment, error: paymentError } = await supabase
    .from('bounty_payments')
    .select('id, status, stripe_transfer_id')
    .eq('bounty_id', bountyId)
    .maybeSingle();
  if (paymentError) throw paymentError;
  if (!payment) {
    console.error('[webhooks] Phase 2 transfer has no bounty_payments row; Stripe will retry', {
      event,
      bountyId,
      transferId: transfer.id,
    });
    throw new Error('Missing bounty payment for Phase 2 transfer');
  }

  if (payment.stripe_transfer_id && payment.stripe_transfer_id !== transfer.id) {
    console.warn('[webhooks] Ignoring stale Phase 2 transfer event for a different transfer', {
      event,
      bountyId,
      transferId: transfer.id,
      recordedTransferId: payment.stripe_transfer_id,
    });
    return;
  }

  const next = transitionBountyPaymentForTransfer(
    payment.status as BountyPaymentSettlementStatus,
    event
  );
  if (!next) return;

  const { error: updateError } = await supabase
    .from('bounty_payments')
    .update({
      stripe_transfer_id: transfer.id,
      status: next,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payment.id)
    .eq('status', payment.status)
    .or(`stripe_transfer_id.is.null,stripe_transfer_id.eq.${transfer.id}`);
  if (updateError) throw updateError;
}

/**
 * Syncs a Stripe Connect `Account` snapshot into `profiles`. Writes the
 * current capability booleans and requirements payload on every call, but
 * preserves `stripe_connect_onboarded_at`: it is set exactly once on the
 * first transition to `charges_enabled && payouts_enabled` and never cleared,
 * matching the semantics used by the `/connect/verify-onboarding` route.
 */
async function syncConnectAccountToProfile(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  account: Stripe.Account
): Promise<void> {
  const userId = account.metadata?.user_id;
  if (!userId) return;
  const fullyOnboarded = !!(account.charges_enabled && account.payouts_enabled);

  const { data: existing, error: readError } = await supabase
    .from('profiles')
    .select('stripe_connect_onboarded_at')
    .eq('id', userId)
    .maybeSingle();

  if (readError) {
    console.error('[webhooks] Failed to read profile for Connect sync', {
      userId,
      error: readError,
    });
    // Fall through — we still want to attempt the update.
  }

  const update: Record<string, unknown> = {
    stripe_connect_charges_enabled: !!account.charges_enabled,
    stripe_connect_payouts_enabled: !!account.payouts_enabled,
    stripe_connect_requirements: (account.requirements ?? null) as unknown as Record<
      string,
      unknown
    > | null,
    stripe_connect_onboarding_complete: fullyOnboarded,
  };

  // Only set the onboarded timestamp on the first transition; never clear it.
  // Guard on !readError: if the read failed, existing is null and we cannot
  // distinguish "never set" from "already set but unreadable". Skipping the
  // timestamp in that case preserves the once-only invariant.
  if (fullyOnboarded && !readError && !existing?.stripe_connect_onboarded_at) {
    update.stripe_connect_onboarded_at = new Date().toISOString();
  }

  const { error: updateError } = await supabase.from('profiles').update(update).eq('id', userId);

  if (updateError) {
    console.error('[webhooks] Failed to sync Connect account to profile', {
      userId,
      accountId: account.id,
      error: updateError,
    });
  }

  // v3 re-check: a hunter who finished onboarding may have approved bounties
  // parked in awaiting_hunter_onboarding. Move them back to 'authorized' so
  // the poster can release, and tell both sides.
  //
  // Deliberately does NOT auto-capture. Capturing here would charge the
  // poster's card from a webhook with nobody present; that is a product
  // decision, not an implementation detail. The authorization is still live,
  // so nothing is lost by waiting for the poster.
  if (account.payouts_enabled) {
    try {
      const { data: waiting } = await supabase
        .from('bounty_v3_funding')
        .select('bounty_id')
        .eq('hunter_id', userId)
        .eq('state', 'awaiting_hunter_onboarding');

      if (waiting && waiting.length > 0) {
        const nowIso = new Date().toISOString();
        const { error: unblockErr } = await supabase
          .from('bounty_v3_funding')
          .update({
            state: 'authorized',
            last_error_code: null,
            last_error_message: null,
            updated_at: nowIso,
          })
          .eq('hunter_id', userId)
          .eq('state', 'awaiting_hunter_onboarding');

        if (unblockErr) {
          console.error('[webhooks] v3 onboarding re-check failed to unblock', {
            userId,
            error: unblockErr,
          });
        } else {
          console.log(
            `[webhooks] v3 onboarding re-check unblocked ${waiting.length} bounty(ies) for hunter ${userId}`
          );
          await enqueuePushEmailFanout(supabase, {
            userId,
            type: 'payout_setup_complete',
            title: 'Payout setup complete',
            body: `Your payout setup is done. ${
              waiting.length === 1 ? 'A payment is' : `${waiting.length} payments are`
            } ready to be released to you.`,
            data: { bountyIds: waiting.map((w: { bounty_id: string }) => w.bounty_id) },
          });
        }
      }
    } catch (recheckErr) {
      // Never fail Connect sync because of the v3 re-check.
      console.error('[webhooks] v3 onboarding re-check threw (non-fatal)', recheckErr);
    }
  }
}

/**
 * Locates the wallet_transactions row a Payout event refers to, by
 * `stripe_payout_id` and nothing else.
 *
 * This used to fall back to "most recent completed withdrawal for this user
 * with this exact amount" when the id did not match. That heuristic is
 * unsound, and it demonstrably misfired: dashboard-initiated payout
 * po_1Txc3k… ($20, 2026-07-27) was attached to a withdrawal row from
 * 2026-07-16, eleven days earlier. Because Stripe's automatic payouts sweep
 * the connected account's *entire* balance and hunters can create their own
 * payouts from the Express Dashboard, a payout frequently has no 1:1
 * withdrawal at all — and matching one anyway meant handleUndeliveredPayout
 * could credit real balance against a withdrawal that had already been
 * delivered.
 *
 * Identifier matching is the only matching *this* function does. Rows that do
 * not yet carry a Stripe payout id are deliberately left for reconciliation
 * and human review rather than guessed at: Stripe automatic sweeps and
 * Dashboard-created payouts are account-level payouts that may share user,
 * amount, and destination with an app withdrawal without being caused by it.
 * Legacy rows written before 2026-08-16 likewise have no payout id and remain
 * manual-review cases rather than being retro-fitted heuristically.
 *
 * Status is deliberately NOT filtered here: callers apply their own
 * compare-and-set on the status they require, which is what makes replayed
 * and out-of-order deliveries safe.
 */
async function findCandidateWithdrawalTx(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  payout: Stripe.Payout
): Promise<{
  id: string;
  amount: number;
  status: string;
  metadata: Record<string, unknown> | null;
  payout_method?: string;
  stripe_payout_status?: string | null;
} | null> {
  const { data: byPayoutId, error: byPayoutIdError } = await supabase
    .from('wallet_transactions')
    .select('id, amount, status, metadata, payout_method, stripe_payout_status')
    .eq('stripe_payout_id', payout.id)
    .eq('type', 'withdrawal')
    .maybeSingle();

  if (byPayoutIdError) {
    console.error('[webhooks] Failed to look up transaction by stripe_payout_id', {
      payoutId: payout.id,
      userId,
      error: byPayoutIdError,
    });
    // Throw rather than silently returning null: a lookup failure is not
    // evidence that no row exists, and treating it as such is how a payout
    // event gets dropped.
    throw byPayoutIdError;
  }

  return byPayoutId ?? null;
}

/**
 * Reconciles the actual Stripe-charged instant-payout fee against the
 * pre-submission UI estimate stored at creation time (see
 * estimateInstantFeeCents() in connect/index.ts). Deliberately best-effort
 * and non-throwing (called from inside a try/catch at every call site) —
 * the exact shape of a Payout's balance_transaction fee breakdown for
 * Instant Payouts has not been exercised against a live/test-mode Stripe
 * account as part of this change (Stripe API access was unavailable in this
 * session). Verify this against Stripe test mode before INSTANT_CASHOUT_ENABLED
 * is ever turned on in production — see docs/withdrawals/13-instant-cash-out.md.
 */
async function reconcileInstantPayoutFee(
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  payout: Stripe.Payout,
  accountId: string,
  transactionId: string
): Promise<void> {
  const balanceTransactionId =
    typeof payout.balance_transaction === 'string'
      ? payout.balance_transaction
      : (payout.balance_transaction as Stripe.BalanceTransaction | null)?.id;
  if (!balanceTransactionId) return;

  const balanceTransaction = await stripe.balanceTransactions.retrieve(balanceTransactionId, {
    stripeAccount: accountId,
  });
  const actualFee = balanceTransaction.fee / 100;

  const { data: txRow } = await supabase
    .from('wallet_transactions')
    .select('instant_fee_amount')
    .eq('id', transactionId)
    .maybeSingle();
  const estimatedFee =
    (txRow as { instant_fee_amount?: number } | null)?.instant_fee_amount ?? null;

  if (estimatedFee != null && Math.abs(actualFee - estimatedFee) > 0.5) {
    logCritical('instant payout fee diverged materially from the pre-submission estimate', {
      payoutId: payout.id,
      transactionId,
      estimatedFee,
      actualFee,
    });
  }

  await supabase
    .from('wallet_transactions')
    .update({ instant_fee_amount: actualFee })
    .eq('id', transactionId);
}

/**
 * Shared handler for `payout.failed` and `payout.canceled`. Both events mean
 * the same thing from the wallet's perspective: the platform-to-connected-
 * account Transfer already succeeded (the withdrawal row is 'pending'), but
 * the connected-account-to-bank Payout never delivered the money, so the
 * balance must be credited back to the hunter — otherwise their app balance
 * is permanently short by the withdrawal amount with no automated recovery.
 *
 * They are NOT semantically identical, so this is intentionally not a blind
 * copy-paste: a `canceled` payout never reached the bank at all (Stripe
 * pulled it back, or something canceled it, while it was still `pending` —
 * per Stripe's Payout lifecycle a payout can only be canceled before it
 * leaves `pending`), so it typically carries no `failure_code`/
 * `failure_message` describing a bank-level rejection the way a genuine
 * `failed` payout does. The customer-facing copy and `payout_status` marker
 * below are adjusted per outcome accordingly; the refund/idempotency
 * mechanics are identical because the financial consequence (money did not
 * arrive) is identical.
 *
 * Matching is by `stripe_payout_id` only. Stripe's automatic Connect payouts
 * sweep the connected account's *entire* available balance on a schedule, so a
 * payout is frequently not 1:1 with any single withdrawal — and hunters can
 * create their own payouts from the Express Dashboard, which are not ours at
 * all. The previous (user, exact amount) fallback could therefore credit real
 * balance against an unrelated, already-delivered withdrawal. An unmatched
 * payout is now reported, never guessed at; see findCandidateWithdrawalTx.
 */
async function handleUndeliveredPayout(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  payout: Stripe.Payout,
  accountId: string,
  outcome: 'failed' | 'canceled'
): Promise<void> {
  console.log(`[webhooks] Payout ${outcome}: ${payout.id}, reason: ${payout.failure_code}`);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_connect_account_id', accountId)
    .maybeSingle();

  if (profileError) {
    console.error(`[webhooks] Supabase error looking up profile for payout.${outcome}`, {
      accountId,
      error: profileError,
    });
    throw profileError;
  }

  if (!profile) {
    console.warn(`[webhooks] No profile found for Connect account ${accountId}`);
    return;
  }

  const candidateTx = await findCandidateWithdrawalTx(supabase, profile.id, payout);

  if (!candidateTx) {
    // No withdrawal carries this payout id. That means the payout is foreign
    // to Bounty — an automatic balance sweep, or one the hunter created in the
    // Stripe Express Dashboard — or it is an orphan. Either way there is
    // nothing of ours to roll back, and guessing at a row by amount (the
    // pre-2026-08-16 behaviour) risked crediting balance against a withdrawal
    // that had already been delivered.
    console.warn(
      `[webhooks] payout.${outcome} ${payout.id} (user ${profile.id}, $${payout.amount / 100}) ` +
        'matches no withdrawal by payout id — no ledger action taken. ' +
        'If this payout was Bounty-originated, reconciliation will report it as an orphan.'
    );
  } else {
    const candidateTxRow = candidateTx as unknown as WalletTransaction;
    const candidateMetadata = (candidateTxRow.metadata as Record<string, unknown> | null) ?? {};
    // Duplicate deliveries, replays and out-of-order events are all resolved
    // by decidePayoutEventAction — see its docstring for the rules.
    const action = decidePayoutEventAction({
      outcome,
      row: {
        id: candidateTxRow.id,
        status: candidateTx.status,
        amount: candidateTxRow.amount,
        metadata: candidateMetadata,
        stripePayoutStatus: candidateTx.stripe_payout_status ?? null,
      },
    });

    if (action.kind === 'noop') {
      console.log(`[webhooks] payout.${outcome} ${payout.id}: no ledger action (${action.reason})`);
    } else {
      const refundAmount = Math.abs(candidateTxRow.amount);
      const { data: failedTx, error: failedTxError } = await supabase
        .rpc('fail_legacy_withdrawal', {
          p_transaction_id: candidateTxRow.id,
          p_user_id: profile.id,
          p_stripe_payout_id: payout.id,
          p_metadata_patch: {
            ...candidateMetadata,
            payout_status: outcome,
            payout_failure_code:
              payout.failure_code ?? (outcome === 'canceled' ? 'canceled' : null),
            payout_failure_message: payout.failure_message ?? null,
            payout_id: payout.id,
          },
        })
        .single();

      if (failedTxError) {
        console.error(`[webhooks] Failed to apply atomic refund for payout.${outcome}`, {
          transactionId: candidateTxRow.id,
          payoutId: payout.id,
          error: failedTxError,
        });
        throw failedTxError;
      }

      const refundResult = failedTx as {
        refunded?: boolean | null;
        refund_amount?: number | null;
      } | null;
      if (!refundResult?.refunded) {
        console.log(
          `[webhooks] Skipping duplicate refund for payout ${payout.id} — a concurrent delivery already resolved this transaction`
        );
      } else {
        console.log(
          `[webhooks] Refunded $${refundAmount} to user ${profile.id} for ${outcome} payout ${payout.id}`
        );
        try {
          await heycatch.trackEvent(
            'payout_failed',
            {
              amount: refundAmount,
              outcome,
              failure_code: payout.failure_code ?? null,
            },
            { userId: profile.id }
          );
        } catch (analyticsErr) {
          console.warn('[webhooks] HeyCatch trackEvent failed (non-fatal)', analyticsErr);
        }
      }
    }
  }

  const notifTitle = outcome === 'canceled' ? 'Withdrawal Canceled' : 'Payout Failed';
  const notifBody =
    outcome === 'canceled'
      ? `Your withdrawal of $${(payout.amount / 100).toFixed(2)} was canceled before it reached your bank. ${payout.failure_message || 'Your funds have been returned to your Bounty balance.'}`
      : `Your payout of $${(payout.amount / 100).toFixed(2)} could not be processed. ${payout.failure_message || payout.failure_code || 'Please update your bank account details.'}`;

  // Insert notification, falling back to an update when the insert
  // conflicts. Avoid `.upsert()` because the DB uses a partial unique
  // index on (user_id,type,stripe_payout_id) WHERE stripe_payout_id IS NOT NULL.
  const notifRow = {
    user_id: profile.id,
    type: 'payment',
    title: notifTitle,
    body: notifBody,
    data: {
      payoutId: payout.id,
      failureCode: payout.failure_code,
      failureMessage: payout.failure_message,
      outcome,
    },
    stripe_payout_id: payout.id,
  };

  const { error: insertErr } = await supabase.from('notifications').insert(notifRow);

  if (insertErr) {
    const { data: updatedNotif, error: updateFallbackErr } = await supabase
      .from('notifications')
      .update(notifRow)
      .eq('user_id', profile.id)
      .eq('type', 'payment')
      .eq('stripe_payout_id', payout.id)
      .select()
      .maybeSingle();

    if (updateFallbackErr) {
      console.error(`[webhooks] Failed to insert payout.${outcome} notification`, {
        profileId: profile.id,
        insert_error: insertErr,
        update_error: updateFallbackErr,
      });
      throw updateFallbackErr;
    }

    if (!updatedNotif) {
      console.error(
        `[webhooks] Failed to insert or update payout.${outcome} notification (no rows affected)`,
        { profileId: profile.id, insert_error: insertErr }
      );
      throw new Error(`Failed to insert or update payout.${outcome} notification`);
    }

    console.log(`[webhooks] Notified hunter ${profile.id} of payout.${outcome} (update fallback)`);
  } else {
    console.log(`[webhooks] Notified hunter ${profile.id} of payout.${outcome}`);
  }

  await enqueuePushEmailFanout(supabase, {
    userId: profile.id,
    type: outcome === 'canceled' ? 'payout_canceled' : 'payout_failed',
    title: notifTitle,
    body: notifBody,
    data: notifRow.data,
  });

  // Flag the profile so support can follow up (reuses the existing
  // payout_failed_at / PayoutFailedBanner mechanism for both outcomes —
  // both mean "the hunter's payout did not arrive and may need attention").
  const { error: payoutFlagError } = await supabase
    .from('profiles')
    .update({
      payout_failed_at: new Date().toISOString(),
      payout_failure_code: payout.failure_code ?? (outcome === 'canceled' ? 'canceled' : null),
    })
    .eq('id', profile.id);
  if (payoutFlagError) {
    console.error('[webhooks] Failed to flag profile payout_failed_at', {
      profileId: profile.id,
      error: payoutFlagError,
    });
    throw payoutFlagError;
  }
}

/**
 * Shared handler for `transfer.failed` and `transfer.reversed`. Both mean the
 * platform-to-connected-account Transfer that funded a withdrawal did not (or
 * no longer does) hold, so the debited balance must be refunded.
 *
 * `failed` is expected to happen occasionally (Stripe-side transient issues)
 * and follows the existing 3-strike retry ladder (MAX_TRANSFER_RETRIES).
 * `reversed` means a Transfer that had ALREADY succeeded was pulled back —
 * nothing in this app's own code calls stripe.transfers.createReversal(), so
 * this should only happen via a manual Stripe Dashboard action or a
 * Stripe-side fraud/compliance action. It is therefore always treated as
 * permanently failed (retry_count is force-set to MAX_TRANSFER_RETRIES so the
 * existing /connect/retry-transfer 3-attempt gate blocks self-service retry)
 * and always logged as CRITICAL regardless of prior retry count, since it
 * should never occur under normal operation and needs a human to look at it.
 */
async function handleTransferSetback(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  transfer: Stripe.Transfer,
  outcome: 'failed' | 'reversed'
): Promise<void> {
  console.log(`[webhooks] Transfer ${outcome}: ${transfer.id}`);

  const { data: existingTx, error: existingTxError } = await supabase
    .from('wallet_transactions')
    .select('id, status, metadata')
    .eq('stripe_transfer_id', transfer.id)
    .maybeSingle();

  if (existingTxError) {
    console.error(`[webhooks] Failed to look up transaction for transfer.${outcome}`, {
      transferId: transfer.id,
      error: existingTxError,
    });
    throw existingTxError;
  }

  if (!existingTx) {
    console.warn(
      `[webhooks] No wallet_transaction found for transfer ${transfer.id} (${outcome}) — possibly superseded by a retry. Skipping.`
    );
    return;
  }

  if (existingTx.status === 'manually_paid') {
    // A human already resolved this withdrawal outside the normal Stripe
    // flow (e.g. paid the hunter by another means after verifying no Stripe
    // payout had landed, then reversed the Transfer to prevent Stripe's own
    // automatic payout from also paying them). That reversal itself
    // triggers this exact webhook — without this guard, this handler would
    // unconditionally overwrite status back to 'failed' and refund the
    // balance, silently undoing the manual settlement and reopening the
    // double-payment risk it was meant to close. Never touch a
    // manually_paid row here.
    console.log(
      `[webhooks] Transfer ${outcome} received for already manually_paid transaction ${existingTx.id} — skipping (see admin_action_log for the settlement record).`,
      { transferId: transfer.id, transactionId: existingTx.id }
    );
    return;
  }

  const existingMetadata = (existingTx?.metadata as Record<string, unknown> | null) ?? {};
  const currentRetries = (existingMetadata.retry_count as number | undefined) ?? 0;
  const permanentlyFailed = outcome === 'reversed' ? true : currentRetries >= MAX_TRANSFER_RETRIES;

  const { data: tx, error: txUpdateError } = await supabase
    .from('wallet_transactions')
    .update({
      status: 'failed',
      metadata: {
        ...existingMetadata,
        transfer_status: permanentlyFailed ? 'permanently_failed' : 'failed',
        ...(outcome === 'reversed' ? { retry_count: MAX_TRANSFER_RETRIES, reversed: true } : {}),
        failure_reason:
          outcome === 'reversed'
            ? 'transfer_reversed'
            : (transfer as Stripe.Transfer & { failure_code?: string }).failure_code,
      },
    })
    .eq('id', existingTx.id)
    .eq('stripe_transfer_id', transfer.id) // optimistic-lock guard
    .select()
    .maybeSingle();

  if (txUpdateError) {
    console.error(`[webhooks] Failed to update transaction for transfer.${outcome}`, {
      transactionId: existingTx.id,
      transferId: transfer.id,
      error: txUpdateError,
    });
    throw txUpdateError;
  }

  if (!tx) {
    // The optimistic-lock guard fired: /connect/retry-transfer replaced
    // stripe_transfer_id with a new transfer ID between our SELECT and
    // UPDATE. Surface for immediate manual investigation to avoid silent
    // fund loss, same as the transfer.failed race case this mirrors.
    logCritical(
      `transfer.${outcome} race condition detected — stripe_transfer_id for transaction ${existingTx.id} was replaced by a retry between SELECT and UPDATE, ${outcome} not recorded and refund not issued`,
      {
        transferId: transfer.id,
        transactionId: existingTx.id,
      }
    );
    return;
  }

  const txRow = tx as WalletTransaction;
  const refundAmount = Math.abs(txRow.amount);
  const txUserId = txRow.user_id;

  // Idempotency guard: if transfer_status was already 'failed' or
  // 'permanently_failed' before this execution's UPDATE, a prior invocation
  // already issued the refund (covers redelivery of either event type
  // against the same row).
  const refundAlreadyIssued =
    existingMetadata.transfer_status === 'failed' ||
    existingMetadata.transfer_status === 'permanently_failed';

  if (refundAlreadyIssued) {
    console.log(
      `[webhooks] Skipping duplicate refund for transfer ${transfer.id} (${outcome}) — balance already restored in a prior invocation`
    );
  } else {
    const { error: rpcError } = await supabase.rpc('update_balance', {
      p_user_id: txUserId,
      p_amount: refundAmount,
    });
    if (rpcError) {
      const { error: retryError } = await supabase.rpc('update_balance', {
        p_user_id: txUserId,
        p_amount: refundAmount,
      });
      if (retryError) {
        console.error(
          `[webhooks] Atomic balance update for transfer ${outcome} refund failed — letting Stripe retry`
        );
        throw retryError;
      }
    }
    console.log(
      `[webhooks] Refunded $${refundAmount} to user ${txUserId} for ${outcome} transfer (retries: ${currentRetries}/${MAX_TRANSFER_RETRIES})`
    );
  }

  if (outcome === 'reversed') {
    logCritical(
      'transfer was reversed after appearing to succeed — no code path in this app does this and needs investigation (manual Stripe Dashboard reversal, or a Stripe-side fraud/compliance action)',
      {
        transferId: transfer.id,
        userId: txUserId,
        amount: refundAmount,
      }
    );
  }

  if (permanentlyFailed) {
    console.warn(
      `[webhooks] Transfer ${transfer.id} permanently failed (${outcome}) after ${currentRetries} retries for user ${txUserId}. Manual review required.`
    );

    const notifTitle = outcome === 'reversed' ? 'Withdrawal Reversed' : 'Withdrawal Failed';
    const notifBody =
      outcome === 'reversed'
        ? `A withdrawal of $${refundAmount.toFixed(2)} that had already been initiated was reversed. Your balance has been restored. Our support team has been notified and will follow up if needed.`
        : 'Your withdrawal could not be completed after multiple attempts. Please contact support.';

    // Check for an existing notification to keep this handler idempotent
    // (Stripe may re-deliver the same webhook event on transient errors).
    const { data: existingNotification, error: existingNotificationError } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', txUserId)
      .eq('type', 'payment')
      .eq('title', notifTitle)
      .contains('data', { transferId: transfer.id })
      .maybeSingle();

    if (existingNotificationError) {
      console.error(`[webhooks] Failed to check for existing ${outcome} notification`, {
        userId: txUserId,
        transferId: transfer.id,
        error: existingNotificationError,
      });
      throw existingNotificationError;
    }

    if (!existingNotification) {
      const notifData = { transferId: transfer.id, retry_count: currentRetries, outcome };
      const { error: notifError } = await supabase.from('notifications').insert({
        user_id: txUserId,
        type: 'payment',
        title: notifTitle,
        body: notifBody,
        data: notifData,
      });
      if (notifError) {
        console.error(`[webhooks] Failed to insert ${outcome} notification`, {
          userId: txUserId,
          transferId: transfer.id,
          error: notifError,
        });
        throw notifError;
      }
      await enqueuePushEmailFanout(supabase, {
        userId: txUserId,
        type: 'withdrawal_reversed',
        title: notifTitle,
        body: notifBody,
        data: notifData,
      });
    } else {
      console.log(
        `[webhooks] Skipping duplicate ${outcome} notification for transfer ${transfer.id} and user ${txUserId}`
      );
    }
  }
}

/**
 * Handles `payout.updated` — status-tracking only, no balance action.
 * payout.paid/failed/canceled remain the sole source of truth for
 * balance-affecting outcomes; this just lets support see which lifecycle
 * stage (e.g. `in_transit`) a payout is in without checking the Stripe
 * Dashboard directly. Deliberately best-effort/non-throwing: a lookup issue
 * here shouldn't cause Stripe to keep retrying a purely informational event.
 */
async function handlePayoutStatusUpdate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  payout: Stripe.Payout,
  accountId: string
): Promise<void> {
  // Terminal, balance-affecting statuses are handled by payout.paid/failed/
  // canceled instead — avoid racing this handler onto the same row.
  if (payout.status === 'paid' || payout.status === 'failed' || payout.status === 'canceled') {
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_connect_account_id', accountId)
    .maybeSingle();

  if (profileError) {
    console.error('[webhooks] Supabase error looking up profile for payout.updated', {
      accountId,
      error: profileError,
    });
    return;
  }
  if (!profile) {
    console.warn(`[webhooks] No profile found for Connect account ${accountId} (payout.updated)`);
    return;
  }

  let candidateTx: Awaited<ReturnType<typeof findCandidateWithdrawalTx>>;
  try {
    candidateTx = await findCandidateWithdrawalTx(supabase, profile.id, payout);
  } catch (candidateTxError) {
    console.error('[webhooks] Failed to look up candidate transaction for payout.updated', {
      payoutId: payout.id,
      userId: profile.id,
      error: candidateTxError,
    });
    return;
  }
  if (!candidateTx) return;

  const candidateMetadata = (candidateTx.metadata as Record<string, unknown> | null) ?? {};
  const { error: updateErr } = await supabase
    .from('wallet_transactions')
    .update({
      stripe_payout_id: payout.id,
      // Stripe's own status, copied verbatim to a first-class column. This is
      // the only input permitted to promote settlement_state to
      // 'stripe_settled' (ADR 0001 §2.3). The metadata copy below is kept for
      // the refund-once guard in decidePayoutEventAction, which reads it.
      stripe_payout_status: payout.status,
      metadata: {
        ...candidateMetadata,
        payout_status: payout.status,
        payout_id: payout.id,
      },
    })
    .eq('id', candidateTx.id)
    .eq('status', 'pending'); // never touch a row a terminal event already resolved

  if (updateErr) {
    console.error('[webhooks] Failed to record payout.updated status', {
      transactionId: candidateTx.id,
      payoutId: payout.id,
      error: updateErr,
    });
  } else {
    console.log(
      `[webhooks] Payout ${payout.id} status updated to ${payout.status} for user ${profile.id}`
    );
  }
}

/**
 * Handles `account.application.deauthorized` — the hunter (or someone with
 * Stripe Dashboard access to their account) disconnected this Connect
 * account from Bounty's platform application entirely. Updates the local
 * capability flags immediately rather than waiting for the next live
 * stripe.accounts.retrieve() check on a withdrawal attempt — that live check
 * (§ every /connect/transfer call) remains as defense-in-depth, but this
 * makes the gap visible to support right away via the profile instead of
 * only surfacing as an opaque `account_verification_failed` error on the
 * hunter's next attempt.
 */
async function handleAccountDeauthorized(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  accountId: string
): Promise<void> {
  console.log(`[webhooks] Connect account deauthorized: ${accountId}`);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, stripe_connect_requirements')
    .eq('stripe_connect_account_id', accountId)
    .maybeSingle();

  if (profileError) {
    console.error(
      '[webhooks] Supabase error looking up profile for account.application.deauthorized',
      { accountId, error: profileError }
    );
    throw profileError;
  }
  if (!profile) {
    console.warn(`[webhooks] No profile found for Connect account ${accountId} (deauthorized)`);
    return;
  }

  const existingRequirements =
    (profile.stripe_connect_requirements as Record<string, unknown> | null) ?? {};

  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      stripe_connect_charges_enabled: false,
      stripe_connect_payouts_enabled: false,
      stripe_connect_onboarding_complete: false,
      stripe_connect_requirements: {
        ...existingRequirements,
        deauthorized: true,
        deauthorized_at: new Date().toISOString(),
      },
    })
    .eq('id', profile.id);

  if (updateError) {
    console.error('[webhooks] Failed to update profile for account.application.deauthorized', {
      userId: profile.id,
      accountId,
      error: updateError,
    });
    throw updateError;
  }

  const deauthTitle = 'Bank Connection Disconnected';
  const deauthBody =
    'Your Stripe payout connection was disconnected. Please reconnect your account to withdraw funds.';
  const { error: notifError } = await supabase.from('notifications').insert({
    user_id: profile.id,
    type: 'payment',
    title: deauthTitle,
    body: deauthBody,
    data: { accountId },
  });
  if (notifError) {
    console.error('[webhooks] Failed to insert deauthorized notification', {
      userId: profile.id,
      accountId,
      error: notifError,
    });
    // Non-fatal — the capability flags are already updated, which is the
    // load-bearing part; a missed notification isn't worth retrying the
    // whole webhook delivery for.
  } else {
    await enqueuePushEmailFanout(supabase, {
      userId: profile.id,
      type: 'bank_disconnected',
      title: deauthTitle,
      body: deauthBody,
      data: { accountId },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Stripe <-> wallet balance reconciliation
//
// The rest of this file reacts to specific money-movement events. These
// helpers instead answer a different question: "does Stripe's own balance
// agree with what the ledger believes right now?" — catching drift from
// manual Stripe Dashboard actions, silently-missed webhook deliveries, or any
// other divergence the event-specific handlers above didn't anticipate.
//
// Deliberately read/insert-only: on drift, these write a
// stripe_balance_snapshots row (always) and a reconciliation_findings row
// (only when drift exceeds DRIFT_THRESHOLD_CENTS) and stop — they never
// mutate profiles.balance directly. Narrow, evidence-based repair (replaying
// a specific missed webhook's own idempotent effect) is intentionally
// confined to the periodic sweep in admin-withdrawals's
// `run_stripe_balance_sync` action, not the real-time path here — a single
// `balance.available` event carries an aggregate number, not enough
// transaction-level evidence to safely decide what to replay. See
// docs/withdrawals/15-stripe-balance-sync.md.
// (Duplicated into admin-withdrawals/index.ts — local imports aren't
// supported by the deploy bundler, same constraint as logCritical/
// mapStripeTransferError elsewhere in this codebase.)
// ═══════════════════════════════════════════════════════════════════════════

const DRIFT_THRESHOLD_CENTS = 100; // $1 — below this, treat as float/timing noise, not a finding

function sumStripeBalanceCents(entries: Array<{ amount: number; currency: string }>): number {
  return entries.filter(e => e.currency === 'usd').reduce((sum, e) => sum + e.amount, 0);
}

/**
 * Structured log for a newly-opened reconciliation finding (drift crossed
 * DRIFT_THRESHOLD_CENTS and there was no already-open finding of the same
 * type). This used to also fire a PostHog event (`stripe_balance_drift_detected`)
 * — 930 of those landed in the analytics project over 26 days, effectively
 * page-worthy alerting mixed into product telemetry with no dashboard or
 * alert actually reading it there. `reconciliation_findings` (inserted by the
 * caller just above) is the durable record; this is the log-based paging
 * signal — `critical` severity already went through logCritical() before
 * this function existed, so it's routed there instead of duplicated here.
 */
function logReconciliationFinding(
  severity: 'critical' | 'warning' | 'info',
  event: string,
  context: Record<string, unknown>
): void {
  const payload = JSON.stringify({ event, severity, ts: new Date().toISOString(), ...context });
  if (severity === 'warning') {
    console.warn(`[webhooks] ${event}`, payload);
  } else {
    console.log(`[webhooks] ${event}`, payload);
  }
}

/** Maps a Stripe Connect account id back to the Bounty user_id it belongs to. */
async function findUserIdByConnectAccountId(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  accountId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_connect_account_id', accountId)
    .maybeSingle();
  if (error) {
    console.error('[webhooks] findUserIdByConnectAccountId lookup failed', { accountId, error });
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Platform-level check: the platform Stripe account's available+pending
 * balance should always be >= the sum of every profiles.balance (everything
 * the DB has promised users that hasn't left the platform yet). Less-than
 * means the platform cannot currently honor every withdrawal on the books —
 * critical. More-than is a lower-urgency surplus (fees, topups, uncredited
 * deposits) worth investigating but not immediately dangerous.
 */
async function comparePlatformBalance(
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  supabase: any
): Promise<void> {
  const [balance, ledgerResult] = await Promise.all([
    stripe.balance.retrieve(),
    supabase.rpc('get_platform_ledger_balance_cents'),
  ]);

  if (ledgerResult.error) {
    console.error('[webhooks] comparePlatformBalance: failed to read ledger total', {
      error: ledgerResult.error,
    });
    return;
  }

  const stripeAvailableCents = sumStripeBalanceCents(balance.available);
  const stripePendingCents = sumStripeBalanceCents(balance.pending);
  const ledgerCents = Number(ledgerResult.data ?? 0);
  const driftCents = stripeAvailableCents + stripePendingCents - ledgerCents;

  let findingId: string | null = null;
  if (Math.abs(driftCents) > DRIFT_THRESHOLD_CENTS) {
    const severity = driftCents < 0 ? 'critical' : 'warning';

    // Dedup against an already-open finding of the same type — without this,
    // an unresolved drift re-inserts an identical row every single hour
    // forever (confirmed live: 30 of 31 unacknowledged findings at audit
    // time were hourly repeats of ~5 underlying conditions). Trend history
    // is preserved regardless via the stripe_balance_snapshots insert below,
    // which always runs.
    const { data: openFinding, error: openFindingError } = await supabase
      .from('reconciliation_findings')
      .select('id')
      .eq('finding_type', 'platform_balance_drift')
      .is('acknowledged_at', null)
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openFindingError) {
      console.error('[webhooks] comparePlatformBalance: failed to check for an open finding', {
        error: openFindingError,
      });
    }

    if (openFinding) {
      findingId = (openFinding as { id: string }).id;
    } else {
      const { data: finding, error: findingError } = await supabase
        .from('reconciliation_findings')
        .insert({
          finding_type: 'platform_balance_drift',
          severity,
          user_id: null,
          details: {
            stripe_available_cents: stripeAvailableCents,
            stripe_pending_cents: stripePendingCents,
            ledger_cents: ledgerCents,
            drift_cents: driftCents,
          },
        })
        .select('id')
        .maybeSingle();
      if (findingError) {
        console.error('[webhooks] comparePlatformBalance: failed to insert finding', {
          error: findingError,
        });
      } else {
        findingId = (finding as { id: string } | null)?.id ?? null;
        if (severity === 'critical') {
          logCritical(
            'platform Stripe balance is below the ledger total — cannot currently honor every withdrawal on the books',
            {
              stripeAvailableCents,
              stripePendingCents,
              ledgerCents,
              driftCents,
            }
          );
        } else {
          logReconciliationFinding(severity, 'stripe_balance_drift_detected', {
            scope: 'platform',
            stripeAvailableCents,
            stripePendingCents,
            ledgerCents,
            driftCents,
          });
        }
      }
    }
  }

  const { error: snapshotError } = await supabase.from('stripe_balance_snapshots').insert({
    scope: 'platform',
    user_id: null,
    stripe_account_id: null,
    stripe_available_cents: stripeAvailableCents,
    stripe_pending_cents: stripePendingCents,
    ledger_reference_cents: ledgerCents,
    drift_cents: driftCents,
    reconciliation_finding_id: findingId,
  });
  if (snapshotError) {
    console.error('[webhooks] comparePlatformBalance: failed to insert snapshot', {
      error: snapshotError,
    });
  }
}

/**
 * Per-connected-account check: a connected account's Stripe balance
 * represents Transfers already sent to that user but not yet paid out to
 * their bank. There is no exact DB-derived expectation for this number
 * (Stripe controls the payout schedule, not this app), so the "ledger
 * reference" here is an approximation — the sum of that user's own
 * unresolved withdrawal rows (still pending, or completed within the last 7
 * days without a confirmed terminal payout) — used only to decide whether a
 * nonzero Stripe balance has a plausible in-app explanation, not to assert an
 * exact expected value.
 */
async function compareConnectAccountBalance(
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  accountId: string
): Promise<void> {
  let balance: Stripe.Balance;
  try {
    balance = await stripe.balance.retrieve({ stripeAccount: accountId });
  } catch (err) {
    console.warn(
      '[webhooks] compareConnectAccountBalance: Stripe balance retrieve failed (non-fatal)',
      {
        userId,
        accountId,
        error: (err as { message?: string })?.message,
      }
    );
    return;
  }

  const stripeAvailableCents = sumStripeBalanceCents(balance.available);
  const stripePendingCents = sumStripeBalanceCents(balance.pending);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: unresolvedRows, error: unresolvedError } = await supabase
    .from('wallet_transactions')
    .select('amount, status, stripe_payout_id, created_at')
    .eq('user_id', userId)
    .eq('type', 'withdrawal')
    .or(
      `status.eq.pending,and(status.eq.completed,created_at.gte.${sevenDaysAgo},stripe_payout_id.is.null)`
    );

  if (unresolvedError) {
    console.error(
      '[webhooks] compareConnectAccountBalance: failed to read unresolved withdrawals',
      {
        userId,
        error: unresolvedError,
      }
    );
    return;
  }

  const ledgerCents = Math.round(
    ((unresolvedRows as Array<{ amount: number }> | null) ?? []).reduce(
      (sum, row) => sum + Math.abs(row.amount),
      0
    ) * 100
  );
  const driftCents = stripeAvailableCents + stripePendingCents - ledgerCents;

  let findingId: string | null = null;
  if (Math.abs(driftCents) > DRIFT_THRESHOLD_CENTS) {
    // Unexplained surplus (drift > 0) is the actionable case — money sitting
    // on the connected account with no matching in-app withdrawal activity
    // to explain it (manual Dashboard transfer, disabled payouts, etc.).
    // A shortfall (drift < 0) usually just means a payout already arrived at
    // the bank before this app's records caught up — informational only.
    const severity = driftCents > 0 ? 'warning' : 'info';

    // Dedup against an already-open finding for this same user — see the
    // matching comment in comparePlatformBalance(). Without this, the same
    // per-user condition re-inserts every hour forever.
    const { data: openFinding, error: openFindingError } = await supabase
      .from('reconciliation_findings')
      .select('id')
      .eq('finding_type', 'connect_account_balance_drift')
      .eq('user_id', userId)
      .is('acknowledged_at', null)
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openFindingError) {
      console.error(
        '[webhooks] compareConnectAccountBalance: failed to check for an open finding',
        { userId, error: openFindingError }
      );
    }

    if (openFinding) {
      findingId = (openFinding as { id: string }).id;
    } else {
      const { data: finding, error: findingError } = await supabase
        .from('reconciliation_findings')
        .insert({
          finding_type: 'connect_account_balance_drift',
          severity,
          user_id: userId,
          details: {
            stripe_account_id: accountId,
            stripe_available_cents: stripeAvailableCents,
            stripe_pending_cents: stripePendingCents,
            ledger_cents: ledgerCents,
            drift_cents: driftCents,
          },
        })
        .select('id')
        .maybeSingle();
      if (findingError) {
        console.error('[webhooks] compareConnectAccountBalance: failed to insert finding', {
          error: findingError,
        });
      } else {
        findingId = (finding as { id: string } | null)?.id ?? null;
        logReconciliationFinding(severity, 'stripe_balance_drift_detected', {
          scope: 'connect_account',
          userId,
          accountId,
          stripeAvailableCents,
          stripePendingCents,
          ledgerCents,
          driftCents,
        });
      }
    }
  }

  const { error: snapshotError } = await supabase.from('stripe_balance_snapshots').insert({
    scope: 'connect_account',
    user_id: userId,
    stripe_account_id: accountId,
    stripe_available_cents: stripeAvailableCents,
    stripe_pending_cents: stripePendingCents,
    ledger_reference_cents: ledgerCents,
    drift_cents: driftCents,
    reconciliation_finding_id: findingId,
  });
  if (snapshotError) {
    console.error('[webhooks] compareConnectAccountBalance: failed to insert snapshot', {
      error: snapshotError,
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // Accept both /webhooks (Stripe-registered URL) and /webhooks/stripe
  const { pathname } = new URL(req.url);
  if (!pathname.endsWith('/webhooks') && !pathname.endsWith('/webhooks/stripe')) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  // Two Stripe endpoints (platform + Connect) post to this same URL, each with
  // its own signing secret — see _shared/webhook-signature.ts for the incident
  // this fixes. Reading only STRIPE_WEBHOOK_SECRET meant one of the two could
  // never verify.
  const webhookSecrets = collectWebhookSecrets(name => Deno.env.get(name));
  if (!stripeKey || webhookSecrets.length === 0) {
    console.error(
      '[webhooks] Missing STRIPE_SECRET_KEY or every webhook signing secret ' +
        `(checked ${WEBHOOK_SECRET_ENV_VARS.join(', ')})`
    );
    return jsonResponse({ error: 'Webhook not configured' }, 500);
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Read raw body for signature verification
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');

  let event: Stripe.Event;

  try {
    const verification = await verifyStripeSignature(rawBody, sig, webhookSecrets);
    if (!verification.verified) {
      // `reason` distinguishes a genuinely forged/corrupt payload from the two
      // operational causes that look identical in a log without it: a secret
      // this deployment does not hold (`no_match` — the 2026-09-02 Connect
      // outage), and a replayed capture (`timestamp_skew`).
      console.error('[webhooks] Signature verification failed', {
        timestamp: new Date().toISOString(),
        reason: verification.reason,
        rawBodyLength: typeof rawBody === 'string' ? rawBody.length : undefined,
        configuredSecretCount: webhookSecrets.length,
      });
      return jsonResponse({ error: `Webhook signature verification failed` }, 400);
    }
    if (verification.secretIndex > 0) {
      // Signed by a non-primary secret (the Connect endpoint, or a rotation
      // key). Worth seeing so a stale secret can be retired deliberately
      // rather than discovered by an outage. Index only — never the secret.
      console.log('[webhooks] Verified with non-primary signing secret', {
        secretIndex: verification.secretIndex,
      });
    }

    // signature verified — parse event
    event = JSON.parse(rawBody) as Stripe.Event;
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[webhooks] Error parsing/verification:', e?.message ?? err);
    return jsonResponse({ error: 'Webhook verification/parsing failed' }, 400);
  }

  try {
    // Claim the event before doing any work.
    //
    // This used to be an unconditional
    //   upsert({ ..., processed: false }, { onConflict: 'stripe_event_id' })
    // followed by running the handler regardless. `stripe_events` looked like a
    // dedupe table but never deduped anything: a Stripe redelivery of an event
    // that had already been processed reset `processed` back to false and then
    // re-ran the full handler, re-crediting balances and re-writing ledger rows
    // for every handler that did not happen to carry its own idempotency key.
    //
    // claim_stripe_event() does the insert-or-take atomically and only hands the
    // event over when it is not already processed, so a redelivery is a no-op.
    const { data: claimed, error: claimError } = await supabase.rpc('claim_stripe_event', {
      p_stripe_event_id: event.id,
      p_event_type: event.type,
      p_event_data: event.data.object,
    });

    if (claimError) {
      // Could not establish whether this is a duplicate. Fail loudly so Stripe
      // retries rather than silently processing an event twice.
      //
      // PGRST202 means the RPC itself is absent from the database — i.e. this
      // function was deployed ahead of its migration. That is a total webhook
      // outage, not a transient error, and Stripe's retries will never clear
      // it, so it is logged as CRITICAL with the remedy attached. This is
      // exactly what happened on 2026-08-31: webhooks v76 shipped while
      // `claim_stripe_event` had never been applied to production.
      const claimCode = (claimError as { code?: string }).code;
      if (claimCode === 'PGRST202') {
        logCritical('claim_stripe_event RPC is missing — ALL webhook processing is down', {
          eventId: event.id,
          eventType: event.type,
          remedy:
            'apply supabase/migrations/*_stripe_event_claim_lease.sql, then reload the PostgREST schema cache',
        });
      } else {
        console.error('[webhooks] Failed to claim event — asking Stripe to retry', {
          eventId: event.id,
          error: claimError,
        });
      }
      return jsonResponse({ error: 'Could not claim webhook event' }, 500);
    }

    if (claimed === false) {
      console.log('[webhooks] Duplicate delivery ignored', { eventId: event.id, type: event.type });
      return jsonResponse({ received: true, duplicate: true });
    }

    // Record the signature-verified delivery in the canonical event ledger.
    // This is the ONLY provenance the Command Center treats as Stripe
    // confirmation (`source='webhook'`); our own wallet rows are `source='app'`.
    // Best-effort by design: observability must never fail a webhook.
    try {
      await supabase.rpc('record_stripe_webhook_event', {
        p_stripe_event_id: event.id,
        p_event_type: event.type,
        p_object: event.data.object,
      });
    } catch (ledgerErr) {
      console.error('[webhooks] Failed to record ledger event (non-fatal)', { ledgerErr });
    }

    // stripe@14's Event.type union doesn't include every event name this
    // endpoint legitimately receives (e.g. legacy transfer.paid/failed and
    // external_account.* names still sent under this endpoint's configured
    // Stripe API version, and refund.failed which postdates this SDK's
    // types). Switching on a plain-string copy avoids narrowing `event`
    // itself to `never` in those case blocks, without changing which
    // strings any case actually matches.
    const eventType: string = event.type;
    switch (eventType) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const userId = paymentIntent.metadata?.user_id;

        if (!userId) {
          console.error('[webhooks] Missing user_id in payment intent metadata');
          break;
        }

        // Phase 2 (payment_architecture_version=2) bounty escrow. With
        // capture_method:'automatic' the PI goes straight to `succeeded` with
        // funds captured to the platform balance, so this single event is the
        // capture signal (no amount_capturable_updated needed). Advance the
        // matching bounty_payments row to 'captured' and record the charge id.
        // Idempotent + non-regressing: only from pending_payment/authorized, so
        // a replay or an already-released row is left untouched.
        if (paymentIntent.metadata?.purpose === 'bounty_escrow') {
          const chargeId = (paymentIntent.latest_charge as string) ?? null;
          const { data: updatedBp, error: bpUpdErr } = await supabase
            .from('bounty_payments')
            .update({
              status: 'captured',
              stripe_charge_id: chargeId,
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_payment_intent_id', paymentIntent.id)
            .in('status', ['pending_payment', 'authorized'])
            .select('id')
            .maybeSingle();

          if (bpUpdErr) {
            console.error(
              '[webhooks] Failed to mark bounty_payment captured — letting Stripe retry',
              {
                paymentIntentId: paymentIntent.id,
                error: bpUpdErr,
              }
            );
            throw bpUpdErr;
          }
          if (updatedBp) {
            console.log(
              `[webhooks] bounty_payment ${(updatedBp as any).id} captured (charge=${chargeId}) for intent ${paymentIntent.id}`
            );
          } else {
            console.log(
              `[webhooks] bounty_escrow PI ${paymentIntent.id} succeeded — no pending row to advance (already captured/released or not recorded)`
            );
          }
          break;
        }

        // Only process wallet deposits — skip all other payment intents
        if (paymentIntent.metadata?.purpose !== 'wallet_deposit') {
          console.log(
            `[webhooks] PaymentIntent ${paymentIntent.id} purpose="${paymentIntent.metadata?.purpose}" — not a wallet_deposit, skipping`
          );
          break;
        }

        const amountDollars = paymentIntent.amount / 100;

        // Use the atomic apply_deposit RPC which:
        //  1. Inserts the wallet_transaction (idempotent via stripe_payment_intent_id UNIQUE)
        //  2. Updates profiles.balance in the same DB transaction
        // This prevents the race condition where a partial failure would leave
        // the transaction inserted but profiles.balance unchanged on retries.
        const { data: applyRes, error: applyErr } = await supabase.rpc('apply_deposit', {
          p_user_id: userId,
          p_amount: amountDollars,
          p_payment_intent_id: paymentIntent.id,
          p_metadata: paymentIntent.metadata ?? {},
        });

        if (applyErr) {
          console.error('[webhooks] apply_deposit RPC failed — letting Stripe retry', {
            user_id: userId,
            amount: amountDollars,
            error: applyErr,
          });
          throw applyErr;
        }

        const appliedRow =
          applyRes != null ? (Array.isArray(applyRes) ? applyRes[0] : applyRes) : null;
        if (appliedRow?.applied) {
          console.log(
            `[webhooks] Deposit applied via apply_deposit, tx_id=${appliedRow.tx_id} for user ${userId}`
          );
          try {
            await heycatch.trackEvent(
              'payment_completed',
              { amount: amountDollars, currency: paymentIntent.currency, source: 'wallet_deposit' },
              { userId }
            );
          } catch (analyticsErr) {
            console.warn('[webhooks] HeyCatch trackEvent failed (non-fatal)', analyticsErr);
          }
        } else {
          console.log(
            `[webhooks] apply_deposit no-op (already processed) for intent ${paymentIntent.id}`
          );
        }

        // Enqueue a push notification regardless of whether apply_deposit was a
        // no-op — Stripe may retry after a partial failure (e.g. the function
        // crashed after the DB write but before the outbox insert). The upsert on
        // stripe_payment_intent_id ensures exactly one outbox row per intent.
        try {
          const { data: profileRow, error: balanceErr } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .maybeSingle();

          if (balanceErr) {
            console.error('[webhooks] Failed to fetch balance for notification', balanceErr);
          }

          const rawBalance = profileRow?.balance;
          const parsedBalance = rawBalance == null ? null : Number(rawBalance);
          const newBalance: number | null =
            parsedBalance !== null && Number.isFinite(parsedBalance) ? parsedBalance : null;
          const amountFormatted = amountDollars.toFixed(2);

          // Perform a safe insert for the outbox row. The DB enforces
          // uniqueness via a partial unique index on
          // stripe_payment_intent_id (WHERE stripe_payment_intent_id IS NOT NULL).
          // PostgREST/Supabase `upsert` cannot express the index predicate, so
          // use select/insert with a fallback select on unique violation to
          // avoid silent failures on webhook retries.
          const { data: existingOutbox, error: selectErr } = await supabase
            .from('notifications_outbox')
            .select('id')
            .eq('stripe_payment_intent_id', paymentIntent.id)
            .maybeSingle();

          if (selectErr) {
            console.error(
              '[webhooks] Failed to query notifications_outbox for existing intent',
              selectErr
            );
          }

          if (existingOutbox && (existingOutbox as any).id) {
            console.log(
              `[webhooks] Push notification outbox row already exists for intent ${paymentIntent.id}, outbox_id=${(existingOutbox as any).id}`
            );
          } else {
            const { data: inserted, error: insertErr } = await supabase
              .from('notifications_outbox')
              .insert({
                stripe_payment_intent_id: paymentIntent.id,
                recipients: [userId],
                title: 'Deposit Successful',
                body: `Your deposit of $${amountFormatted} has been credited to your wallet.`,
                data: { type: 'balance_update', newBalance },
              })
              .select('id')
              .maybeSingle();

            if (insertErr) {
              console.warn(
                '[webhooks] notifications_outbox insert failed, attempting select fallback',
                insertErr
              );

              // Race condition: another worker may have inserted the row.
              const { data: recheck, error: recheckErr } = await supabase
                .from('notifications_outbox')
                .select('id')
                .eq('stripe_payment_intent_id', paymentIntent.id)
                .maybeSingle();

              if (recheckErr) {
                console.error(
                  '[webhooks] Failed to re-query notifications_outbox after insert failure',
                  recheckErr
                );
              } else if (recheck && (recheck as any).id) {
                console.log(
                  `[webhooks] Push notification outbox row exists after concurrent insert for intent ${paymentIntent.id}, outbox_id=${(recheck as any).id}`
                );
              } else {
                console.error(
                  '[webhooks] notifications_outbox insert failed and no existing row found',
                  insertErr
                );
              }
            } else if (inserted && (inserted as any).id) {
              console.log(
                `[webhooks] Push notification enqueued for user ${userId}, outbox_id=${(inserted as any).id}`
              );
            } else {
              console.log(
                `[webhooks] notifications_outbox insert returned no row for intent ${paymentIntent.id}`
              );
            }
          }
        } catch (notifErr) {
          // Notification failure must not affect the webhook response
          console.error('[webhooks] Unexpected error enqueuing deposit notification', notifErr);
        }
        break;
      }

      case 'payment_intent.canceled': {
        // Phase 2 bounty escrow only. A bounty escrow PI is canceled by the
        // /bounty-payments/cancel endpoint (pre-capture) or if it expires
        // uncaptured. Mirror that into bounty_payments idempotently. Legacy
        // wallet-deposit PIs never reach a canceled state in this system, so a
        // non-bounty_escrow purpose is a no-op here.
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        if (paymentIntent.metadata?.purpose === 'bounty_escrow') {
          const { data: canceledBp, error: cancelErr } = await supabase
            .from('bounty_payments')
            .update({ status: 'canceled', updated_at: new Date().toISOString() })
            .eq('stripe_payment_intent_id', paymentIntent.id)
            // Never regress a row that already captured/released/refunded.
            .in('status', ['pending_payment', 'authorized'])
            .select('id')
            .maybeSingle();
          if (cancelErr) {
            console.error(
              '[webhooks] Failed to mark bounty_payment canceled — letting Stripe retry',
              {
                paymentIntentId: paymentIntent.id,
                error: cancelErr,
              }
            );
            throw cancelErr;
          }
          console.log(
            canceledBp
              ? `[webhooks] bounty_payment ${(canceledBp as any).id} canceled for intent ${paymentIntent.id}`
              : `[webhooks] bounty_escrow PI ${paymentIntent.id} canceled — no pending row to update (idempotent no-op)`
          );
        }

        // v3: a manual-capture authorization that was released. Stripe sets
        // cancellation_reason 'automatic' when it auto-cancels an uncaptured
        // authorization at the end of the ~7-day window; anything else is a
        // deliberate cancel. Expiry is an expected state for a long-open
        // bounty, not an error, so it is recorded as 'expired' and flagged for
        // re-authorization rather than being treated as a payment failure.
        if (paymentIntent.metadata?.purpose === 'bounty_escrow_v3') {
          const expired = paymentIntent.cancellation_reason === 'automatic';
          const v3State = expired ? 'expired' : 'canceled';

          const { error: v3CancelErr } = await supabase
            .from('bounty_v3_funding')
            .update({
              state: v3State,
              needs_reauthorization: expired,
              last_error_code: expired ? 'authorization_expired' : 'canceled',
              last_error_message: expired
                ? 'The card authorization expired before the bounty was completed.'
                : `PaymentIntent canceled (${paymentIntent.cancellation_reason ?? 'unspecified'}).`,
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_payment_intent_id', paymentIntent.id)
            .in('state', ['authorizing', 'authorized']);
          if (v3CancelErr) {
            console.error('[webhooks] v3 funding cancel update failed — letting Stripe retry', {
              paymentIntentId: paymentIntent.id,
              error: v3CancelErr,
            });
            throw v3CancelErr;
          }

          const { error: v3LedgerErr } = await supabase
            .from('ledger_entries')
            .update({
              app_state: 'failed',
              stripe_state: 'failed',
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_payment_intent_id', paymentIntent.id)
            .eq('leg', 'payment');
          if (v3LedgerErr) {
            console.error('[webhooks] v3 ledger cancel update failed — letting Stripe retry', {
              paymentIntentId: paymentIntent.id,
              error: v3LedgerErr,
            });
            throw v3LedgerErr;
          }

          console.log(
            `[webhooks] v3 bounty authorization ${v3State} for intent ${paymentIntent.id}`
          );
        }
        break;
      }

      // v3 only. Stripe has no 'payment_intent.requires_capture' event —
      // requires_capture is a PaymentIntent *status*. The event that fires
      // when a manual-capture intent becomes capturable is this one.
      case 'payment_intent.amount_capturable_updated': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        if (paymentIntent.metadata?.purpose !== 'bounty_escrow_v3') break;
        if ((paymentIntent.amount_capturable ?? 0) <= 0) break;

        const authorizedAt = new Date();
        // Informational only — Stripe's payment_intent.canceled is the
        // authority on when a hold actually lapses.
        const expiresAt = new Date(authorizedAt.getTime() + 7 * 24 * 60 * 60 * 1000);

        const { error: v3AuthErr } = await supabase
          .from('bounty_v3_funding')
          .update({
            state: 'authorized',
            authorized_at: authorizedAt.toISOString(),
            authorization_expires_at: expiresAt.toISOString(),
            needs_reauthorization: false,
            last_error_code: null,
            last_error_message: null,
            updated_at: authorizedAt.toISOString(),
          })
          .eq('stripe_payment_intent_id', paymentIntent.id)
          .eq('state', 'authorizing');
        if (v3AuthErr) {
          console.error('[webhooks] v3 funding authorize update failed — letting Stripe retry', {
            paymentIntentId: paymentIntent.id,
            error: v3AuthErr,
          });
          throw v3AuthErr;
        }

        // app_state 'succeeded' = we asked Stripe to authorize and it did.
        // stripe_state stays 'pending' because the money has not moved: the
        // charge is authorized, not captured. Only capture (Phase 3) confirms.
        const { error: v3AuthLedgerErr } = await supabase
          .from('ledger_entries')
          .update({
            app_state: 'succeeded',
            stripe_state: 'pending',
            updated_at: authorizedAt.toISOString(),
          })
          .eq('stripe_payment_intent_id', paymentIntent.id)
          .eq('leg', 'payment');
        if (v3AuthLedgerErr) {
          console.error('[webhooks] v3 ledger authorize update failed — letting Stripe retry', {
            paymentIntentId: paymentIntent.id,
            error: v3AuthLedgerErr,
          });
          throw v3AuthLedgerErr;
        }

        console.log(
          `[webhooks] v3 bounty authorized: ${paymentIntent.id} (${paymentIntent.amount_capturable} capturable)`
        );
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const userId = paymentIntent.metadata?.user_id;
        const error = paymentIntent.last_payment_error;

        console.log(`[webhooks] PaymentIntent failed: ${paymentIntent.id} for user ${userId}`);
        console.log(`[webhooks] Failure reason: ${error?.code} - ${error?.message}`);

        // v3: the authorization itself failed (declined card, 3DS abandoned).
        // The bounty is left in place but explicitly unfunded, so it can never
        // sit in a paid-but-unusable state and the poster can re-authorize.
        if (paymentIntent.metadata?.purpose === 'bounty_escrow_v3') {
          const { error: v3FailErr } = await supabase
            .from('bounty_v3_funding')
            .update({
              state: 'failed',
              needs_reauthorization: true,
              last_error_code: error?.code ?? 'authorization_failed',
              last_error_message:
                error?.message ?? 'The card could not be authorized for this bounty.',
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_payment_intent_id', paymentIntent.id)
            .in('state', ['authorizing', 'authorized']);
          if (v3FailErr) {
            console.error('[webhooks] v3 funding failure update failed — letting Stripe retry', {
              paymentIntentId: paymentIntent.id,
              error: v3FailErr,
            });
            throw v3FailErr;
          }

          const { error: v3FailLedgerErr } = await supabase
            .from('ledger_entries')
            .update({
              app_state: 'failed',
              stripe_state: 'failed',
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_payment_intent_id', paymentIntent.id)
            .eq('leg', 'payment');
          if (v3FailLedgerErr) {
            console.error('[webhooks] v3 ledger failure update failed — letting Stripe retry', {
              paymentIntentId: paymentIntent.id,
              error: v3FailLedgerErr,
            });
            throw v3FailLedgerErr;
          }

          console.log(`[webhooks] v3 bounty authorization failed for intent ${paymentIntent.id}`);
        }

        await supabase
          .from('stripe_events')
          .update({
            processed: true,
            processed_at: new Date().toISOString(),
            event_data: {
              ...(event.data.object as object),
              _processed_notes: `Payment failed: ${error?.code}`,
            },
          })
          .eq('stripe_event_id', event.id);
        break;
      }

      case 'payment_intent.requires_action': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log(`[webhooks] PaymentIntent requires action (3DS): ${paymentIntent.id}`);
        break;
      }

      case 'setup_intent.succeeded': {
        const setupIntent = event.data.object as Stripe.SetupIntent;
        const setupUserId = setupIntent.metadata?.user_id;
        const setupPaymentMethodId =
          typeof setupIntent.payment_method === 'string'
            ? setupIntent.payment_method
            : (setupIntent.payment_method as Stripe.PaymentMethod | null)?.id;

        console.log(`[webhooks] SetupIntent succeeded: ${setupIntent.id} for user ${setupUserId}`);

        // Ensure the stripe_customer_id is saved on the profile.
        // This is critical because the GET /payments/methods endpoint relies on
        // stripe_customer_id to fetch payment methods from Stripe.
        const setupCustomerId =
          typeof setupIntent.customer === 'string'
            ? setupIntent.customer
            : (setupIntent.customer as Stripe.Customer | null)?.id;
        if (setupUserId && setupCustomerId) {
          const { error: profileUpdateError } = await supabase
            .from('profiles')
            .update({ stripe_customer_id: setupCustomerId })
            .eq('id', setupUserId)
            .is('stripe_customer_id', null);
          if (profileUpdateError) {
            console.error(
              '[webhooks] Failed to update stripe_customer_id on profile (conditional)',
              {
                userId: setupUserId,
                customerId: setupCustomerId,
                error: profileUpdateError,
              }
            );
            // Fallback: unconditional update (may overwrite existing value, acceptable for recovery)
            try {
              const { error: fallbackError } = await supabase
                .from('profiles')
                .update({ stripe_customer_id: setupCustomerId })
                .eq('id', setupUserId);
              if (fallbackError) {
                console.error('[webhooks] Fallback stripe_customer_id update also failed', {
                  userId: setupUserId,
                  error: fallbackError,
                });
              }
            } catch (fallbackErr) {
              console.error('[webhooks] Fallback stripe_customer_id update threw', {
                userId: setupUserId,
                error: fallbackErr,
              });
            }
          }
        }

        if (setupUserId && setupPaymentMethodId) {
          try {
            // Retrieve full payment method details from Stripe
            const pm = await stripe.paymentMethods.retrieve(setupPaymentMethodId);

            // Upsert into payment_methods table so the method is available for future charges
            const { error: upsertError } = await supabase.from('payment_methods').upsert(
              {
                user_id: setupUserId,
                stripe_payment_method_id: pm.id,
                type: pm.type,
                card_brand: pm.card?.brand ?? null,
                card_last4: pm.card?.last4 ?? null,
                card_exp_month: pm.card?.exp_month ?? null,
                card_exp_year: pm.card?.exp_year ?? null,
              },
              { onConflict: 'stripe_payment_method_id' }
            );

            if (upsertError) {
              console.error(
                '[webhooks] Failed to upsert payment method after setup_intent.succeeded',
                {
                  userId: setupUserId,
                  paymentMethodId: setupPaymentMethodId,
                  error: upsertError,
                }
              );
            } else {
              console.log(
                `[webhooks] Payment method ${setupPaymentMethodId} saved for user ${setupUserId}`
              );
            }
          } catch (pmErr: any) {
            console.error(
              '[webhooks] Error retrieving/saving payment method after setup_intent.succeeded',
              {
                userId: setupUserId,
                paymentMethodId: setupPaymentMethodId,
                error: pmErr?.message,
              }
            );
          }
        } else {
          console.warn(
            '[webhooks] setup_intent.succeeded missing user_id or payment_method — skipping DB upsert',
            {
              setupIntentId: setupIntent.id,
              userId: setupUserId,
              paymentMethodId: setupPaymentMethodId,
            }
          );
        }
        break;
      }

      case 'setup_intent.setup_failed': {
        const failedSetupIntent = event.data.object as Stripe.SetupIntent;
        const failedSetupError = failedSetupIntent.last_setup_error;
        console.log(
          `[webhooks] SetupIntent failed: ${failedSetupIntent.id}, reason: ${failedSetupError?.code} - ${failedSetupError?.message}`
        );

        await supabase
          .from('stripe_events')
          .update({
            processed: true,
            processed_at: new Date().toISOString(),
            event_data: {
              ...(event.data.object as object),
              _processed_notes: `Setup failed: ${failedSetupError?.code}`,
            },
          })
          .eq('stripe_event_id', event.id);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = charge.payment_intent as string;

        const { data: originalTx } = await supabase
          .from('wallet_transactions')
          .select('user_id, amount')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .single();

        if (originalTx) {
          const origTx = originalTx as Pick<WalletTransaction, 'user_id' | 'amount'>;
          const refunds = charge.refunds?.data ?? [];

          if (refunds.length === 0) {
            console.warn(
              `[webhooks] charge.refunded received but charge ${charge.id} has no refunds — skipping`
            );
          }

          // Process each refund individually so that:
          //   - Partial/multi-refund charges are correctly recorded (one row per refund)
          //   - Stripe retries are idempotent via the stripe_refund_id unique partial index
          for (const refund of refunds) {
            const refundAmountDollars = refund.amount / 100;

            // Use the atomic apply_refund RPC which:
            //  1. Inserts the wallet_transaction (idempotent via stripe_refund_id unique
            //     partial index — ON CONFLICT DO NOTHING)
            //  2. Updates profiles.balance in the same DB transaction
            // This prevents the race condition where a partial failure (insert succeeds
            // but balance update fails) would leave the refund recorded without the
            // corresponding balance decrement on a subsequent Stripe retry, because
            // the ON CONFLICT no-op on retry would have previously skipped the balance
            // update entirely.
            const { data: applyRes, error: applyErr } = await supabase.rpc('apply_refund', {
              p_user_id: origTx.user_id,
              p_amount: -refundAmountDollars,
              p_stripe_refund_id: refund.id,
              p_stripe_charge_id: charge.id,
              p_metadata: {
                refund_reason: refund.reason ?? null,
                refund_id: refund.id,
              },
            });

            if (applyErr) {
              // Detect insufficient-funds errors from the RPC so we can record
              // a failed refund transaction and avoid letting Stripe retry
              // indefinitely. This mirrors the dispute.closed handling which
              // records a failed dispute_loss when the atomic RPC cannot apply
              // the deduction due to insufficient funds.
              const errMsg = (applyErr && (applyErr.message || '')).toString();
              const errCode = (applyErr && (applyErr.code || '')).toString();
              const insufficientFunds =
                errCode === '23514' || errMsg.toLowerCase().includes('insufficient funds');

              if (insufficientFunds) {
                console.warn(
                  '[webhooks] apply_refund RPC failed due to insufficient funds — recording failed refund transaction',
                  {
                    refundId: refund.id,
                    chargeId: charge.id,
                    user_id: origTx.user_id,
                    amount: refundAmountDollars,
                    error: applyErr,
                  }
                );

                try {
                  const { error: insertErr } = await supabase.from('wallet_transactions').insert({
                    user_id: origTx.user_id,
                    type: 'refund',
                    amount: -refundAmountDollars,
                    description: `Stripe refund ${refund.id} failed due to insufficient funds`,
                    status: 'failed',
                    stripe_refund_id: refund.id,
                    stripe_charge_id: charge.id,
                    metadata: {
                      refund_reason: refund.reason ?? null,
                      refund_id: refund.id,
                    },
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  });

                  if (insertErr) {
                    // If the insert conflicts (concurrent recording) or fails for
                    // another reason, log it but do not rethrow — we want to
                    // return success to Stripe to stop retries.
                    console.error('[webhooks] Failed to insert failed refund wallet_transaction', {
                      refundId: refund.id,
                      chargeId: charge.id,
                      error: insertErr,
                    });
                  } else {
                    console.log(
                      `[webhooks] Recorded failed refund wallet_transaction for refund ${refund.id} user ${origTx.user_id}`
                    );
                  }
                } catch (insErr) {
                  // Defensive: log and continue — do not throw so webhook returns 200
                  console.error(
                    '[webhooks] Exception while recording failed refund wallet_transaction',
                    {
                      refundId: refund.id,
                      chargeId: charge.id,
                      error: insErr,
                    }
                  );
                }

                // Do not rethrow; we've recorded the failure so Stripe can stop retrying.
                // Skip further processing for this refund — avoid falling through
                // to the duplicate-refund logging below which would be misleading.
                continue;
              } else {
                console.error('[webhooks] apply_refund RPC failed — letting Stripe retry', {
                  refundId: refund.id,
                  chargeId: charge.id,
                  error: applyErr,
                });
                throw applyErr;
              }
            }

            const appliedRow =
              applyRes != null ? (Array.isArray(applyRes) ? applyRes[0] : applyRes) : null;
            if (appliedRow?.applied) {
              console.log(
                `[webhooks] Refund ${refund.id} processed for user ${origTx.user_id} ($${refundAmountDollars}) tx_id=${appliedRow.tx_id}`
              );
            } else {
              console.log(
                `[webhooks] Duplicate refund ${refund.id} detected for charge ${charge.id} — skipping (already processed)`
              );
            }
          }
        } else {
          // Phase 2: no legacy wallet_transactions row for this payment intent,
          // so this may be a bounty-escrow refund — issued by
          // /bounty-payments/cancel (post-capture) or out-of-band from the
          // Stripe Dashboard. Reflect it into bounty_payments. Idempotent and
          // non-regressing via the status guard (only captured/refund_pending
          // advance; released/refunded/canceled rows are left untouched).
          const refunds = charge.refunds?.data ?? [];
          const latestRefund = refunds.length > 0 ? refunds[refunds.length - 1] : null;
          const refundStatus = latestRefund?.status === 'succeeded' ? 'refunded' : 'refund_pending';
          const { data: refundedBp, error: bpRefundErr } = await supabase
            .from('bounty_payments')
            .update({
              status: refundStatus,
              stripe_refund_id: latestRefund?.id ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_payment_intent_id', paymentIntentId)
            .in('status', ['captured', 'refund_pending'])
            .select('id')
            .maybeSingle();
          if (bpRefundErr) {
            console.error(
              '[webhooks] Failed to reflect refund into bounty_payments — letting Stripe retry',
              {
                paymentIntentId,
                chargeId: charge.id,
                error: bpRefundErr,
              }
            );
            throw bpRefundErr;
          }
          if (refundedBp) {
            console.log(
              `[webhooks] bounty_payment ${(refundedBp as any).id} → ${refundStatus} (refund=${latestRefund?.id ?? 'n/a'}) for intent ${paymentIntentId}`
            );
          }
        }
        break;
      }

      case 'transfer.created': {
        // Replay-safe: this handler performs an UPDATE (not INSERT), so a second
        // delivery of the same event is a no-op — the row already has
        // stripe_transfer_id set and the `.is('stripe_transfer_id', null)` filter
        // will match zero rows, leaving the database unchanged.
        //
        // NOTE: PostgREST does not support `order`/`limit` as a way to restrict
        // *which* rows an UPDATE affects (only `select()` honors them; mutations
        // only support the separate `maxAffected()` cap). Chaining `.order().limit(1)`
        // directly onto `.update()` does not scope the write to a single row — if more
        // than one matching candidate ever existed, ALL of them would be updated. We
        // therefore SELECT the single best candidate first (order/limit are valid
        // there), then UPDATE that specific row by id with an optimistic-lock guard.
        const transfer = event.data.object as Stripe.Transfer;
        console.log(`[webhooks] Transfer created: ${transfer.id}`);

        // v3 MUST be checked before the Phase 2 branch below: v3 transfers
        // also carry metadata.bounty_id, so they would otherwise be routed
        // into reconcilePhase2Transfer, which expects a bounty_payments row
        // that no v3 bounty has.
        //
        // This is the only place a v3 release becomes confirmed. reversed=false
        // is required: a transfer that arrives already reversed has not paid
        // anyone, and an API 200 alone never counts as confirmation.
        if (transfer.metadata?.purpose === 'bounty_release_v3') {
          const v3BountyId = transfer.metadata?.bounty_id;
          if (transfer.reversed === true) {
            console.warn(
              `[webhooks] v3 transfer ${transfer.id} arrived already reversed — not confirming`
            );
            break;
          }

          const nowIso = new Date().toISOString();
          const { error: v3RelErr } = await supabase
            .from('bounty_v3_funding')
            .update({ state: 'released', released_at: nowIso, updated_at: nowIso })
            .eq('stripe_transfer_id', transfer.id)
            .eq('state', 'capturing');
          if (v3RelErr) {
            console.error('[webhooks] v3 funding release update failed — letting Stripe retry', {
              transferId: transfer.id,
              error: v3RelErr,
            });
            throw v3RelErr;
          }

          const { error: v3LedgerConfirmErr } = await supabase
            .from('ledger_entries')
            .update({ stripe_state: 'confirmed', updated_at: nowIso })
            .eq('stripe_transfer_id', transfer.id)
            .eq('leg', 'capture_release');
          if (v3LedgerConfirmErr) {
            console.error('[webhooks] v3 ledger confirm failed — letting Stripe retry', {
              transferId: transfer.id,
              error: v3LedgerConfirmErr,
            });
            throw v3LedgerConfirmErr;
          }

          console.log(
            `[webhooks] v3 release confirmed for bounty ${v3BountyId} via transfer ${transfer.id}`
          );
          break;
        }

        // Phase 2 transfers carry bounty_id in metadata and are recorded
        // synchronously by /bounty-payments/release (stripe_transfer_id +
        // status='released' set at creation time). Skip the legacy
        // amount/user-id heuristic backfill entirely so it can never
        // mis-match a Phase 2 transfer onto a legacy withdrawal row.
        if (transfer.metadata?.bounty_id) {
          await reconcilePhase2Transfer(supabase, transfer, 'created');
          break;
        }
        const transferUserId = transfer.metadata?.user_id;
        const transferAmountDollars = transfer.amount / 100;
        if (transferUserId) {
          const { data: candidateTx, error: candidateErr } = await supabase
            .from('wallet_transactions')
            .select('id')
            .eq('user_id', transferUserId)
            .eq('type', 'withdrawal')
            .eq('amount', -transferAmountDollars)
            .is('stripe_transfer_id', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (candidateErr) {
            console.error(
              '[webhooks] Failed to look up candidate transaction for transfer.created',
              {
                transferId: transfer.id,
                userId: transferUserId,
                error: candidateErr,
              }
            );
          } else if (candidateTx) {
            const { error: backfillErr } = await supabase
              .from('wallet_transactions')
              .update({
                stripe_transfer_id: transfer.id,
                metadata: { transfer_status: 'created' },
              })
              .eq('id', (candidateTx as { id: string }).id)
              .is('stripe_transfer_id', null); // optimistic-lock guard against a concurrent backfill
            if (backfillErr) {
              console.error(
                '[webhooks] Failed to backfill stripe_transfer_id for transfer.created',
                {
                  transferId: transfer.id,
                  transactionId: (candidateTx as { id: string }).id,
                  error: backfillErr,
                }
              );
            }
          }
        }
        break;
      }

      case 'transfer.paid': {
        const transfer = event.data.object as Stripe.Transfer;
        console.log(`[webhooks] Transfer paid: ${transfer.id}`);
        // Stripe does not emit transfer.paid for the public Connect Transfer
        // lifecycle; Phase 2 settlement is finalized by transfer.created.
        // Preserve this legacy branch as a no-op if an older integration sends
        // it, so it cannot regress or falsely promote a payment row.
        if (transfer.metadata?.bounty_id) {
          break;
        }
        await supabase
          .from('wallet_transactions')
          .update({
            status: 'completed',
            metadata: { transfer_status: 'paid', paid_at: new Date().toISOString() },
          })
          .eq('stripe_transfer_id', transfer.id);
        break;
      }

      case 'transfer.failed': {
        const transfer = event.data.object as Stripe.Transfer;
        if (transfer.metadata?.bounty_id) {
          await reconcilePhase2Transfer(supabase, transfer, 'failed');
          break;
        }
        await handleTransferSetback(supabase, transfer, 'failed');
        break;
      }

      case 'transfer.reversed': {
        // A Transfer that had already succeeded (platform → connected
        // account) was pulled back. See handleTransferSetback's docstring
        // for why this always requires manual review.
        const transfer = event.data.object as Stripe.Transfer;

        // v3 first, for the same reason as transfer.created: v3 transfers
        // carry metadata.bounty_id and would otherwise be misrouted into the
        // Phase 2 handler. A reversal un-confirms the release — the hunter was
        // not paid — so the ledger must never be left claiming otherwise.
        if (transfer.metadata?.purpose === 'bounty_release_v3') {
          const nowIso = new Date().toISOString();
          const { error: v3RevErr } = await supabase
            .from('bounty_v3_funding')
            .update({
              state: 'capture_failed',
              released_at: null,
              last_error_code: 'transfer_reversed',
              last_error_message:
                'The transfer to the hunter was reversed by Stripe. This needs manual review.',
              updated_at: nowIso,
            })
            .eq('stripe_transfer_id', transfer.id);
          if (v3RevErr) {
            console.error('[webhooks] v3 funding reversal update failed — letting Stripe retry', {
              transferId: transfer.id,
              error: v3RevErr,
            });
            throw v3RevErr;
          }

          const { error: v3RevLedgerErr } = await supabase
            .from('ledger_entries')
            .update({ app_state: 'failed', stripe_state: 'failed', updated_at: nowIso })
            .eq('stripe_transfer_id', transfer.id)
            .eq('leg', 'capture_release');
          if (v3RevLedgerErr) {
            console.error('[webhooks] v3 ledger reversal update failed — letting Stripe retry', {
              transferId: transfer.id,
              error: v3RevLedgerErr,
            });
            throw v3RevLedgerErr;
          }

          console.error(
            `[webhooks] v3 transfer REVERSED for bounty ${transfer.metadata?.bounty_id} (${transfer.id}) — manual review required`
          );
          // v3 is tracked through bounty_v3_funding + ledger_entries, not the
          // wallet_transactions path used by legacy/Phase 2 transfers. Do not
          // invoke handleTransferSetback here or it would incorrectly mutate
          // wallet rows for a v3 release.
          break;
        }

        if (transfer.metadata?.bounty_id) {
          await reconcilePhase2Transfer(supabase, transfer, 'reversed');
          break;
        }
        await handleTransferSetback(supabase, transfer, 'reversed');
        break;
      }

      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        console.log(`[webhooks] Connect account updated: ${account.id}`);
        if (account.metadata?.user_id) {
          await syncConnectAccountToProfile(supabase, account);
        }
        break;
      }

      case 'capability.updated': {
        const capability = event.data.object as Stripe.Capability;
        const capAccountId = (capability as unknown as { account?: string }).account;
        console.log(
          `[webhooks] Connect capability updated: ${capability.id} status=${capability.status} account=${capAccountId}`
        );
        if (capAccountId) {
          try {
            const account = await stripe.accounts.retrieve(capAccountId);
            if (account.metadata?.user_id) {
              await syncConnectAccountToProfile(supabase, account);
            }
          } catch (err) {
            console.error('[webhooks] Failed to sync account after capability.updated', {
              capAccountId,
              error: err,
            });
          }
        }
        break;
      }

      case 'account.application.deauthorized': {
        // The hunter (or someone with dashboard access) disconnected this
        // Connect account from Bounty's platform application entirely. See
        // handleAccountDeauthorized's docstring for why this is handled
        // proactively rather than only surfacing on the next withdrawal
        // attempt's live stripe.accounts.retrieve() check.
        const deauthAccountId = (event as any).account as string | undefined;
        if (deauthAccountId) {
          await handleAccountDeauthorized(supabase, deauthAccountId);
        }
        break;
      }

      case 'payout.created': {
        // Informational only — Stripe fires this the moment it creates the
        // Payout, well before it's actually paid/failed/canceled (those
        // remain the sole source of truth for balance actions and user
        // notifications). Best-effort backfill of stripe_payout_id onto the
        // matching wallet_transactions row shrinks the window where a
        // completed withdrawal has no payout id yet (useful for
        // admin-withdrawals' compare_stripe and the reconciliation cron).
        // NOTE: requires 'payout.created' to be enabled on this webhook
        // endpoint's subscribed events in the Stripe Dashboard.
        const payout = event.data.object as Stripe.Payout;
        const createdAccountId = (event as any).account as string | undefined;
        console.log(
          `[webhooks] Payout created: ${payout.id} for $${payout.amount / 100} (method: ${payout.method})`
        );

        if (createdAccountId) {
          try {
            const { data: createdProfile, error: createdProfileError } = await supabase
              .from('profiles')
              .select('id')
              .eq('stripe_connect_account_id', createdAccountId)
              .maybeSingle();

            if (createdProfileError) {
              console.warn(
                '[webhooks] Supabase error looking up profile for payout.created (non-fatal)',
                {
                  accountId: createdAccountId,
                  error: createdProfileError,
                }
              );
            } else if (createdProfile) {
              const candidateTx = await findCandidateWithdrawalTx(
                supabase,
                createdProfile.id,
                payout
              );
              if (candidateTx) {
                await supabase
                  .from('wallet_transactions')
                  .update({ stripe_payout_id: payout.id })
                  .eq('id', candidateTx.id)
                  .is('stripe_payout_id', null);
              }
            }
          } catch (backfillError) {
            // Deliberately non-throwing: payout.paid/failed/canceled will
            // still do their own (also best-effort) backfill, so losing this
            // early one is never fatal — never turn it into a retried
            // webhook delivery.
            console.warn('[webhooks] payout.created backfill step failed (non-fatal)', {
              payoutId: payout.id,
              error: (backfillError as { message?: string })?.message,
            });
          }
        }
        break;
      }

      case 'payout.paid': {
        const payout = event.data.object as Stripe.Payout;
        const paidAccountId = (event as any).account as string | undefined;
        console.log(`[webhooks] Payout paid: ${payout.id} for $${payout.amount / 100}`);

        if (paidAccountId) {
          const { data: paidProfile, error: paidProfileError } = await supabase
            .from('profiles')
            .select('id')
            .eq('stripe_connect_account_id', paidAccountId)
            .maybeSingle();

          if (paidProfileError) {
            console.error('[webhooks] Supabase error looking up profile for payout.paid', {
              accountId: paidAccountId,
              error: paidProfileError,
            });
            throw paidProfileError;
          }

          if (paidProfile) {
            // Insert notification, falling back to an update when the insert
            // conflicts. We avoid Supabase/PostgREST `.upsert()` here because
            // the DB uses a partial unique index on (user_id,type,stripe_payout_id)
            // WHERE stripe_payout_id IS NOT NULL; PostgREST cannot express that
            // partial constraint in its generated ON CONFLICT clause which would
            // cause a runtime error. Instead: try insert, then update by the
            // stripe_payout_id on failure (race-safe).
            const notifRow = {
              user_id: paidProfile.id,
              type: 'payment',
              title: 'Payout Successful',
              body: `Your payout of $${(payout.amount / 100).toFixed(2)} has been processed and sent to your bank account.`,
              data: { payoutId: payout.id },
              stripe_payout_id: payout.id,
            };

            const { error: insertErr } = await supabase.from('notifications').insert(notifRow);

            if (insertErr) {
              // Insert may fail due to a concurrent insert by a retry; try update fallback.
              // Use `.select().maybeSingle()` so we can detect whether any row was
              // actually updated. If no row was affected, treat this as an error
              // so the webhook delivery is retried instead of silently dropping
              // the notification.
              const { data: updatedNotif, error: updateFallbackErr } = await supabase
                .from('notifications')
                .update(notifRow)
                .eq('user_id', paidProfile.id)
                .eq('type', 'payment')
                .eq('stripe_payout_id', payout.id)
                .select()
                .maybeSingle();

              if (updateFallbackErr) {
                console.error('[webhooks] Failed to insert payout.paid notification', {
                  profileId: paidProfile.id,
                  insert_error: insertErr,
                  update_error: updateFallbackErr,
                });
                throw updateFallbackErr;
              }

              if (!updatedNotif) {
                console.error(
                  '[webhooks] Failed to insert or update payout.paid notification (no rows affected)',
                  { profileId: paidProfile.id, insert_error: insertErr }
                );
                // Throw to let Stripe retry — we don't want to silently lose the notification
                throw new Error('Failed to insert or update payout.paid notification');
              }

              console.log(
                `[webhooks] Notified hunter ${paidProfile.id} of payout.paid (update fallback)`
              );
            } else {
              console.log(`[webhooks] Notified hunter ${paidProfile.id} of payout.paid`);
            }

            await enqueuePushEmailFanout(supabase, {
              userId: paidProfile.id,
              type: 'payout_paid',
              title: notifRow.title,
              body: notifRow.body,
              data: notifRow.data,
            });

            try {
              await heycatch.trackEvent(
                'payout_success',
                { amount: payout.amount / 100, payout_method: payout.method ?? null },
                { userId: paidProfile.id }
              );
            } catch (analyticsErr) {
              console.warn('[webhooks] HeyCatch trackEvent failed (non-fatal)', analyticsErr);
            }

            // THE completion event. payout.paid is the only authoritative
            // signal that money reached the hunter's bank, and this is the
            // only place in the codebase that may promote a withdrawal to
            // 'completed'.
            //
            // Before 2026-08-16 this handler did not touch status at all — it
            // only back-filled the payout id — while /connect wrote
            // 'completed' up front on the strength of a Transfer. Both halves
            // were wrong, and together they produced a ledger where
            // 'completed' meant "we tried" rather than "they were paid".
            //
            // Idempotency is structural, not bolted on: the update is a
            // compare-and-set on status='pending'. A replayed or out-of-order
            // delivery matches zero rows and changes nothing. It moves no
            // money — the payout already happened — so there is no balance
            // action to double-apply.
            try {
              const candidateTx = await findCandidateWithdrawalTx(
                supabase,
                paidProfile.id,
                payout
              );
              const action = decidePayoutEventAction({
                outcome: 'paid',
                row: candidateTx
                  ? {
                      id: candidateTx.id,
                      status: candidateTx.status,
                      amount: candidateTx.amount,
                      metadata: candidateTx.metadata,
                      stripePayoutStatus: candidateTx.stripe_payout_status ?? null,
                    }
                  : null,
              });
              const shouldReconcileInstantFee =
                !!candidateTx &&
                (payout.method === 'instant' || candidateTx.payout_method === 'instant');

              if (action.kind === 'noop') {
                console.log(
                  `[webhooks] payout.paid ${payout.id}: no ledger action (${action.reason})`
                );
                if (action.reason === 'no_matching_withdrawal') {
                  // Foreign payouts (automatic sweeps, Express Dashboard) land
                  // here legitimately; reconciliation reports genuine orphans.
                  console.warn(
                    `[webhooks] payout.paid ${payout.id} ($${payout.amount / 100}) matched no withdrawal for user ${paidProfile.id} — foreign or orphan payout`
                  );
                }
              } else if (candidateTx) {
                const candidateMeta =
                  (candidateTx.metadata as Record<string, unknown> | null) ?? {};
                const { data: promoted, error: promoteError } = await supabase
                  .from('wallet_transactions')
                  .update({
                    status: 'completed',
                    stripe_payout_id: payout.id,
                    // The single write in the entire codebase that may promote
                    // a withdrawal to settlement_state='stripe_settled'. The
                    // derive trigger reads this column and nothing else.
                    stripe_payout_status: 'paid',
                    completed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    metadata: {
                      ...candidateMeta,
                      payout_id: payout.id,
                      payout_status: 'paid',
                      payout_paid_at: new Date().toISOString(),
                    },
                  })
                  .eq('id', candidateTx.id)
                  .eq('status', 'pending') // CAS: replay-safe, terminal states absorb
                  .select()
                  .maybeSingle();

                if (promoteError) {
                  // Throw so Stripe retries: a withdrawal stuck 'pending'
                  // after its payout settled is a real ledger divergence, and
                  // reconciliation's 72h window is a slower backstop than a
                  // webhook retry.
                  console.error('[webhooks] failed to promote withdrawal on payout.paid', {
                    payoutId: payout.id,
                    transactionId: candidateTx.id,
                    error: promoteError,
                  });
                  throw promoteError;
                }

                if (promoted) {
                  console.log(
                    `[webhooks] Withdrawal ${candidateTx.id} completed by payout ${payout.id}`
                  );
                } else {
                  // The CAS above matched nothing. That is either a duplicate
                  // delivery (harmless) or — the case this branch exists for —
                  // another writer promoted the row to 'completed' before this
                  // webhook arrived, WITHOUT stamping stripe_payout_status.
                  //
                  // That second case is not harmless. `settlement_state` is
                  // derived from stripe_payout_status and nothing else, so the
                  // row stays 'stripe_pending' permanently even though Stripe
                  // has told us it paid. Five production withdrawals sat in
                  // exactly that state, one of them promoted by reconciliation
                  // 26 minutes before its payout.paid landed. The invariant
                  // that is supposed to prove a hunter was paid then reads
                  // "unconfirmed" forever, which also means it can no longer
                  // distinguish a payout that genuinely never arrived.
                  //
                  // Stamp settlement only. Deliberately narrow: it does not
                  // touch status, completed_at or balances — the row is
                  // already terminal and the money already moved — so it is
                  // safe to replay and preserves the original completion time.
                  const { data: stamped, error: stampError } = await supabase
                    .from('wallet_transactions')
                    .update({
                      stripe_payout_id: payout.id,
                      stripe_payout_status: 'paid',
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', candidateTx.id)
                    .eq('status', 'completed')
                    .is('stripe_payout_status', null) // CAS: a second delivery matches nothing
                    .select()
                    .maybeSingle();

                  if (stampError) {
                    console.error('[webhooks] failed to stamp settlement on payout.paid', {
                      payoutId: payout.id,
                      transactionId: candidateTx.id,
                      error: stampError,
                    });
                    throw stampError;
                  }

                  if (stamped) {
                    console.log(
                      `[webhooks] Withdrawal ${candidateTx.id} was already completed; stamped settlement from payout ${payout.id}`
                    );
                  } else {
                    // Genuinely a duplicate delivery of a fully-resolved row.
                    console.log(
                      `[webhooks] payout.paid ${payout.id} matched an already-resolved withdrawal, no change`
                    );
                  }
                }
              }

              if (shouldReconcileInstantFee && candidateTx) {
                await reconcileInstantPayoutFee(
                  stripe,
                  supabase,
                  payout,
                  paidAccountId,
                  candidateTx.id
                );
              }
            } catch (reconcileError) {
              console.error('[webhooks] payout.paid completion step failed', {
                payoutId: payout.id,
                error: (reconcileError as { message?: string })?.message,
              });
              throw reconcileError;
            }
          } else {
            console.warn(`[webhooks] No profile found for Connect account ${paidAccountId}`);
          }
        }
        break;
      }

      case 'payout.updated': {
        // Status-tracking only — see handlePayoutStatusUpdate's docstring.
        const payout = event.data.object as Stripe.Payout;
        const updatedAccountId = (event as any).account as string | undefined;
        if (updatedAccountId) {
          await handlePayoutStatusUpdate(supabase, payout, updatedAccountId);
        }
        break;
      }

      case 'payout.failed': {
        const payout = event.data.object as Stripe.Payout;
        const failedAccountId = (event as any).account as string | undefined;
        if (failedAccountId) {
          await handleUndeliveredPayout(supabase, payout, failedAccountId, 'failed');
        }
        break;
      }

      case 'payout.canceled': {
        // A payout can only be canceled by Stripe while it is still
        // `pending` (i.e. before it has left for the bank) — see
        // handleUndeliveredPayout()'s docstring for why this is handled with
        // shared refund logic but distinct customer-facing copy from
        // payout.failed. Previously this event had no handler at all: a
        // canceled payout was silently dropped (no status update, no wallet
        // correction, no notification), leaving the withdrawal permanently
        // stuck with a 'completed' status the hunter could never resolve.
        const payout = event.data.object as Stripe.Payout;
        const canceledAccountId = (event as any).account as string | undefined;
        if (canceledAccountId) {
          await handleUndeliveredPayout(supabase, payout, canceledAccountId, 'canceled');
        }
        break;
      }

      case 'payout.closed': {
        // Stripe uses payout.closed for terminal closures that are not always
        // accompanied by payout.failed. Treat it as a failed delivery so the
        // withdrawal is reconciled and funds are restored, never completed.
        const payout = event.data.object as Stripe.Payout;
        const closedAccountId = (event as any).account as string | undefined;
        if (!closedAccountId) {
          console.warn('[webhooks] payout.closed is missing the connected account', {
            eventId: event.id,
            payoutId: payout.id,
          });
          break;
        }
        await handleUndeliveredPayout(supabase, payout, closedAccountId, 'failed');
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        const disputePaymentIntentId =
          typeof dispute.payment_intent === 'string'
            ? dispute.payment_intent
            : ((dispute.payment_intent as Stripe.PaymentIntent | null)?.id ?? null);
        const disputeAmountDollars = dispute.amount / 100;

        console.log(
          `[webhooks] charge.dispute.created: dispute=${dispute.id} pi=${disputePaymentIntentId} amount=$${disputeAmountDollars}`
        );

        // Look up the original wallet transaction to find the poster
        let disputeUserId: string | null = null;
        if (disputePaymentIntentId) {
          const { data: origTx, error: origTxError } = await supabase
            .from('wallet_transactions')
            .select('user_id')
            .eq('stripe_payment_intent_id', disputePaymentIntentId)
            .maybeSingle();

          if (origTxError) {
            console.error(
              '[webhooks] charge.dispute.created: failed to look up originating wallet_transaction',
              {
                dispute_id: dispute.id,
                stripe_payment_intent_id: disputePaymentIntentId,
                error: origTxError,
              }
            );
            throw origTxError;
          }

          disputeUserId = (origTx as { user_id: string } | null)?.user_id ?? null;
        }

        if (!disputeUserId) {
          console.warn(
            `[webhooks] charge.dispute.created: no wallet_transaction found for pi=${disputePaymentIntentId} — logging only`
          );
          break;
        }

        // Insert or update bounty_disputes for this Stripe dispute.
        // Avoid using Supabase/PostgREST `upsert` with `onConflict` because the
        // underlying index is a partial unique index (WHERE stripe_dispute_id IS NOT NULL)
        // which PostgREST cannot express in its generated ON CONFLICT clause.
        const disputeRow = {
          initiator_id: disputeUserId,
          reason: `Stripe chargeback dispute opened (${dispute.id})`,
          status: 'stripe_dispute',
          stripe_dispute_id: dispute.id,
          stripe_payment_intent_id: disputePaymentIntentId,
          // 'cancellation' is the closest available dispute_stage value for a Stripe
          // chargeback, which arrives outside the normal in-app dispute flow.
          dispute_stage: 'cancellation',
        } as any;

        // First try to find an existing row by stripe_dispute_id
        const { data: existingDispute, error: selectDisputeError } = await supabase
          .from('bounty_disputes')
          .select('id')
          .eq('stripe_dispute_id', dispute.id)
          .maybeSingle();

        if (selectDisputeError) {
          console.error('[webhooks] charge.dispute.created: failed to query bounty_disputes', {
            dispute_id: dispute.id,
            error: selectDisputeError,
          });
          throw selectDisputeError;
        }

        if (existingDispute && (existingDispute as any).id) {
          const { error: updateErr } = await supabase
            .from('bounty_disputes')
            .update(disputeRow)
            .eq('id', (existingDispute as any).id);

          if (updateErr) {
            console.error('[webhooks] charge.dispute.created: failed to update bounty_disputes', {
              dispute_id: dispute.id,
              error: updateErr,
            });
            throw updateErr;
          }
        } else {
          // No existing row; try to insert. If an insert race causes a unique violation,
          // fall back to updating by stripe_dispute_id.
          const { error: insertErr } = await supabase.from('bounty_disputes').insert(disputeRow);

          if (insertErr) {
            console.warn(
              '[webhooks] charge.dispute.created: insert failed, attempting update fallback',
              {
                dispute_id: dispute.id,
                error: insertErr,
              }
            );

            const { error: updateFallbackErr } = await supabase
              .from('bounty_disputes')
              .update(disputeRow)
              .eq('stripe_dispute_id', dispute.id);

            if (updateFallbackErr) {
              console.error(
                '[webhooks] charge.dispute.created: failed to insert or update bounty_disputes',
                {
                  dispute_id: dispute.id,
                  insert_error: insertErr,
                  update_error: updateFallbackErr,
                }
              );
              throw updateFallbackErr;
            }
          }
        }

        // Freeze the poster's wallet so they cannot withdraw disputed funds
        const { error: freezeError } = await supabase
          .from('profiles')
          .update({ balance_frozen: true })
          .eq('id', disputeUserId);

        if (freezeError) {
          console.error('[webhooks] charge.dispute.created: failed to freeze wallet', {
            user_id: disputeUserId,
            error: freezeError,
          });
          throw freezeError;
        }

        // Notify the poster. type: 'dispute_created' (security category) —
        // this is a Stripe chargeback, distinct from the bounty-completion
        // "workflow" disputes elsewhere in the app, but shares the same
        // account-integrity urgency semantics (always bypasses quiet hours).
        const disputeOpenedTitle = 'Payment Dispute Opened';
        const disputeOpenedBody =
          'A payment dispute has been opened on your account. Your wallet has been temporarily frozen.';
        const { error: notifError } = await supabase.from('notifications').insert({
          user_id: disputeUserId,
          type: 'dispute_created',
          title: disputeOpenedTitle,
          body: disputeOpenedBody,
          data: { stripeDisputeId: dispute.id },
        });
        if (notifError) {
          console.error('[webhooks] charge.dispute.created: failed to insert notification', {
            user_id: disputeUserId,
            error: notifError,
          });
          // Non-fatal — do not rethrow; dispute row and freeze are the critical ops
        } else {
          await enqueuePushEmailFanout(supabase, {
            userId: disputeUserId,
            type: 'dispute_created',
            title: disputeOpenedTitle,
            body: disputeOpenedBody,
            data: { stripeDisputeId: dispute.id },
          });
        }

        console.log(
          `[webhooks] charge.dispute.created: dispute ${dispute.id} recorded, wallet frozen for user ${disputeUserId}`
        );
        break;
      }

      case 'charge.dispute.closed': {
        const closedDispute = event.data.object as Stripe.Dispute;
        const closedPaymentIntentId =
          typeof closedDispute.payment_intent === 'string'
            ? closedDispute.payment_intent
            : ((closedDispute.payment_intent as Stripe.PaymentIntent | null)?.id ?? null);
        const closedAmountDollars = closedDispute.amount / 100;
        const disputeWon = closedDispute.status === 'won';
        // Track whether the dispute loss was successfully applied to the user's balance.
        // If we cannot apply the deduction due to insufficient funds, we'll
        // record a failed transaction so Stripe does not keep retrying the webhook.
        let disputeLossApplied = true;

        console.log(
          `[webhooks] charge.dispute.closed: dispute=${closedDispute.id} status=${closedDispute.status} amount=$${closedAmountDollars}`
        );

        // Resolve the bounty_disputes row
        const closedStatus = disputeWon ? 'resolved_won' : 'resolved_lost';
        const { data: resolvedDispute, error: resolveError } = await supabase
          .from('bounty_disputes')
          .update({
            status: closedStatus,
            resolved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_dispute_id', closedDispute.id)
          .select('initiator_id')
          .maybeSingle();

        if (resolveError) {
          console.error('[webhooks] charge.dispute.closed: failed to update bounty_disputes', {
            dispute_id: closedDispute.id,
            error: resolveError,
          });
          throw resolveError;
        }

        let closedUserId =
          (resolvedDispute as { initiator_id: string } | null)?.initiator_id ?? null;

        if (!closedUserId) {
          // Fallback: look up the user via wallet_transactions when no bounty_disputes row
          // exists (e.g. charge.dispute.created was never processed, or row was deleted).
          // Prefer lookup by PaymentIntent ID; if that's not available (legacy charge),
          // fall back to the Stripe charge ID.
          let closedWalletTx: { user_id?: string } | null = null;
          let closedWalletTxError: any = null;

          if (closedPaymentIntentId) {
            ({ data: closedWalletTx, error: closedWalletTxError } = await supabase
              .from('wallet_transactions')
              .select('user_id')
              .eq('stripe_payment_intent_id', closedPaymentIntentId)
              .maybeSingle());
          } else if ((closedDispute.charge as string | undefined) != null) {
            ({ data: closedWalletTx, error: closedWalletTxError } = await supabase
              .from('wallet_transactions')
              .select('user_id')
              .eq('stripe_charge_id', closedDispute.charge as string)
              .maybeSingle());
          }

          if (closedWalletTxError) {
            console.error(
              '[webhooks] charge.dispute.closed: failed wallet_transactions fallback lookup',
              {
                dispute_id: closedDispute.id,
                stripe_payment_intent_id: closedPaymentIntentId ?? null,
                stripe_charge_id: closedDispute.charge ?? null,
                error: closedWalletTxError,
              }
            );
            throw closedWalletTxError;
          }

          closedUserId =
            (closedWalletTx as Pick<WalletTransaction, 'user_id'> | null)?.user_id ?? null;

          if (!closedUserId) {
            console.warn(
              `[webhooks] charge.dispute.closed: no bounty_disputes or wallet_transactions row for dispute ${closedDispute.id} — skipping balance/wallet ops`
            );
            break;
          }

          console.warn(
            `[webhooks] charge.dispute.closed: recovered user ${closedUserId} from wallet_transactions for dispute ${closedDispute.id}`
          );
        }

        // Track whether the wallet was actually unfrozen so the user-facing
        // notification can reflect the true account state when there are
        // multiple concurrent Stripe disputes.
        let walletActuallyUnfrozen = false;
        let remainingOpenCountNumber: number | null = null;

        if (disputeWon) {
          // Platform won — only unfreeze the wallet when there are no other open Stripe disputes
          const { count: remainingOpenCount, error: remainingOpenError } = await supabase
            .from('bounty_disputes')
            .select('id', { count: 'exact', head: true })
            .eq('initiator_id', closedUserId)
            .eq('status', 'stripe_dispute');

          if (remainingOpenError) {
            console.error(
              '[webhooks] charge.dispute.closed (won): failed to check remaining open disputes',
              {
                user_id: closedUserId,
                error: remainingOpenError,
              }
            );
            throw remainingOpenError;
          }

          remainingOpenCountNumber = Number(remainingOpenCount ?? 0);

          if (remainingOpenCountNumber === 0) {
            // Atomically unfreeze the profile only when there are no remaining
            // open Stripe disputes. Perform this in the DB via an RPC so the
            // check+update is executed server-side (avoids a race between the
            // count check and the update when concurrent dispute.created
            // events arrive).
            const { data: unfreezeRes, error: unfreezeError } = await supabase.rpc(
              'unfreeze_profile_if_no_open_disputes',
              { p_user_id: closedUserId }
            );

            if (unfreezeError) {
              console.error('[webhooks] charge.dispute.closed (won): failed to unfreeze wallet', {
                user_id: closedUserId,
                error: unfreezeError,
              });
              throw unfreezeError;
            }

            // Normalize RPC result to boolean. Depending on the RPC signature
            // Supabase may return an array or a scalar — be defensive.
            walletActuallyUnfrozen = Boolean(
              unfreezeRes &&
              (Array.isArray(unfreezeRes)
                ? unfreezeRes[0] === true || Object.values(unfreezeRes[0] as any).includes(true)
                : unfreezeRes === true)
            );

            if (walletActuallyUnfrozen) {
              console.log(
                `[webhooks] charge.dispute.closed (won): wallet unfrozen for user ${closedUserId}`
              );
            } else {
              console.log(
                `[webhooks] charge.dispute.closed (won): wallet remains frozen for user ${closedUserId} (RPC reported no change)`
              );
            }
          } else {
            console.log(
              `[webhooks] charge.dispute.closed (won): wallet remains frozen for user ${closedUserId} due to ${remainingOpenCountNumber} remaining open Stripe dispute(s)`
            );
          }
        } else {
          // Platform lost — deduct the disputed amount.
          // balance_frozen remains true (set during charge.dispute.created) intentionally:
          // the account should stay restricted until a manual admin review clears it.

          // Guard this path for webhook retries/timeouts by checking whether we've
          // already recorded the dispute-loss transaction for this Stripe dispute.
          const { data: existingDisputeLossTx, error: existingDisputeLossTxError } = await supabase
            .from('wallet_transactions')
            .select('id')
            .eq('user_id', closedUserId)
            .eq('type', 'dispute_loss')
            .eq('status', 'completed')
            .eq('metadata->>stripe_dispute_id', closedDispute.id)
            .maybeSingle();

          if (existingDisputeLossTxError) {
            console.error(
              '[webhooks] charge.dispute.closed (lost): failed to check existing dispute_loss transaction',
              {
                user_id: closedUserId,
                stripe_dispute_id: closedDispute.id,
                error: existingDisputeLossTxError,
              }
            );
            throw existingDisputeLossTxError;
          }

          if (existingDisputeLossTx) {
            console.log(
              `[webhooks] charge.dispute.closed (lost): dispute_loss already recorded for dispute ${closedDispute.id}; skipping duplicate deduction for user ${closedUserId}`
            );
          } else {
            // Atomically apply the dispute loss: update the user's balance and
            // record the wallet transaction inside a single DB transaction so
            // we cannot end up with a completed transaction without the
            // corresponding balance change (prevents the retry/idempotency bug).
            const { data: _appliedTx, error: applyError } = await supabase.rpc(
              'apply_dispute_loss_transaction',
              {
                p_user_id: closedUserId,
                p_amount: -closedAmountDollars,
                p_description: `Chargeback dispute lost (${closedDispute.id})`,
                p_stripe_dispute_id: closedDispute.id,
                p_stripe_payment_intent_id: closedPaymentIntentId ?? null,
              }
            );

            if (applyError) {
              // Detect insufficient-funds error from the balance update RPC.
              const errMsg = (applyError && (applyError.message || '')) as string;
              const errCode = (applyError && (applyError.code || '')) as string;
              const insufficientFunds =
                errCode === '23514' || errMsg.toLowerCase().includes('insufficient funds');

              if (insufficientFunds) {
                disputeLossApplied = false;
                console.warn(
                  '[webhooks] charge.dispute.closed (lost): insufficient funds — recording failed dispute_loss transaction for manual review',
                  {
                    user_id: closedUserId,
                    stripe_dispute_id: closedDispute.id,
                    amount: closedAmountDollars,
                    error: applyError,
                  }
                );

                // Create a record so we don't keep retrying indefinitely.
                // Use status 'failed' to indicate the deduction couldn't be applied.
                try {
                  const { error: insertErr } = await supabase.from('wallet_transactions').insert({
                    user_id: closedUserId,
                    type: 'dispute_loss',
                    amount: -closedAmountDollars,
                    description: `Chargeback dispute lost (${closedDispute.id}) - failed due to insufficient funds`,
                    status: 'failed',
                    metadata: {
                      stripe_dispute_id: closedDispute.id,
                      stripe_payment_intent_id: closedPaymentIntentId ?? null,
                    },
                  });

                  if (insertErr) {
                    // Unique index or other DB error — log but don't rethrow so
                    // the webhook returns 200 to Stripe and stops retrying.
                    console.error(
                      '[webhooks] charge.dispute.closed (lost): failed to insert failed dispute_loss transaction',
                      {
                        user_id: closedUserId,
                        stripe_dispute_id: closedDispute.id,
                        error: insertErr,
                      }
                    );
                  } else {
                    console.log(
                      `[webhooks] charge.dispute.closed (lost): recorded failed dispute_loss transaction for user ${closedUserId}`
                    );
                  }
                } catch (insErr) {
                  // Defensive: log and continue — do not throw to avoid webhook retries.
                  console.error(
                    '[webhooks] charge.dispute.closed (lost): exception while recording failed dispute_loss transaction',
                    { user_id: closedUserId, stripe_dispute_id: closedDispute.id, error: insErr }
                  );
                }
              } else {
                console.error(
                  '[webhooks] charge.dispute.closed (lost): failed to apply dispute_loss transaction atomically',
                  {
                    user_id: closedUserId,
                    stripe_dispute_id: closedDispute.id,
                    error: applyError,
                  }
                );
                throw applyError;
              }
            } else {
              console.log(
                `[webhooks] charge.dispute.closed (lost): deducted $${closedAmountDollars} from user ${closedUserId}`
              );
            }
          }
        }

        // Notify the poster of the outcome. Use the actual unfreeze result
        // when the platform won so we don't incorrectly claim the wallet
        // was unfrozen while other disputes remain open.
        let outcomeMsg: string;
        if (disputeWon) {
          if (walletActuallyUnfrozen) {
            outcomeMsg =
              'The payment dispute on your account has been resolved in your favor. Your wallet has been unfrozen.';
          } else if (remainingOpenCountNumber !== null && remainingOpenCountNumber > 0) {
            outcomeMsg = `The payment dispute on your account has been resolved in your favor, but your wallet remains frozen due to ${remainingOpenCountNumber} other open dispute(s).`;
          } else {
            outcomeMsg =
              'The payment dispute on your account has been resolved in your favor. Your wallet may still be frozen pending other disputes or review.';
          }
        } else {
          if (typeof disputeLossApplied !== 'undefined' && disputeLossApplied === false) {
            outcomeMsg = `The payment dispute on your account has been resolved against you. We attempted to deduct $${closedAmountDollars.toFixed(
              2
            )} from your wallet but the deduction failed due to insufficient funds. The amount remains outstanding; please add funds or contact support.`;
          } else {
            outcomeMsg = `The payment dispute on your account has been resolved against you. $${closedAmountDollars.toFixed(2)} has been deducted from your wallet.`;
          }
        }

        const closedNotifTitle = disputeWon ? 'Dispute Resolved — Won' : 'Dispute Resolved — Lost';
        const { error: closedNotifError } = await supabase.from('notifications').insert({
          user_id: closedUserId,
          type: 'dispute_resolved',
          title: closedNotifTitle,
          body: outcomeMsg,
          data: { stripeDisputeId: closedDispute.id },
        });
        if (closedNotifError) {
          console.error('[webhooks] charge.dispute.closed: failed to insert notification', {
            user_id: closedUserId,
            error: closedNotifError,
          });
          // Non-fatal
        } else {
          await enqueuePushEmailFanout(supabase, {
            userId: closedUserId,
            type: 'dispute_resolved',
            title: closedNotifTitle,
            body: outcomeMsg,
            data: { stripeDisputeId: closedDispute.id },
          });
        }

        console.log(
          `[webhooks] charge.dispute.closed: dispute ${closedDispute.id} resolved (${closedStatus}) for user ${closedUserId}`
        );
        break;
      }

      case 'balance.available': {
        // Fires per-account. Connect-scoped deliveries carry a top-level
        // `event.account`; the platform's own balance.available does not —
        // that's the only signal distinguishing which Stripe balance changed.
        const accountId = (event as any).account as string | undefined;
        if (accountId) {
          // Invalidate the v3 balance cache for this connected account before
          // anything else. Deleting the row (rather than rewriting it) means
          // the next GET /wallet/balance refetches from Stripe, so a hunter
          // never sees a stale number after their balance actually moved.
          // Best-effort: a cache-eviction failure must not fail the webhook.
          try {
            const { error: cacheEvictErr } = await supabase
              .from('connect_balance_cache')
              .delete()
              .eq('stripe_connect_account_id', accountId);
            if (cacheEvictErr) {
              console.error('[webhooks] connect_balance_cache eviction failed (non-fatal)', {
                accountId,
                error: cacheEvictErr,
              });
            }
          } catch (evictErr) {
            console.error('[webhooks] connect_balance_cache eviction threw (non-fatal)', evictErr);
          }

          const ownerUserId = await findUserIdByConnectAccountId(supabase, accountId);
          if (ownerUserId) {
            await compareConnectAccountBalance(stripe, supabase, ownerUserId, accountId);
          } else {
            console.warn(
              `[webhooks] balance.available: no profile found for Connect account ${accountId}`
            );
          }
        } else {
          await comparePlatformBalance(stripe, supabase);
        }
        break;
      }

      case 'charge.dispute.updated': {
        // Status/evidence-deadline sync only — no balance effect. The actual
        // hold (created) and settlement (closed) are handled by their own
        // events above; this just keeps bounty_disputes current in between.
        const updatedDispute = event.data.object as Stripe.Dispute;
        const { error: updateDisputeErr } = await supabase
          .from('bounty_disputes')
          .update({
            reason: `Stripe chargeback dispute (${updatedDispute.status}): ${updatedDispute.id}`,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_dispute_id', updatedDispute.id);
        if (updateDisputeErr) {
          console.error('[webhooks] charge.dispute.updated: failed to update bounty_disputes', {
            dispute_id: updatedDispute.id,
            error: updateDisputeErr,
          });
          throw updateDisputeErr;
        }
        console.log(
          `[webhooks] charge.dispute.updated: dispute ${updatedDispute.id} → ${updatedDispute.status}`
        );
        break;
      }

      case 'charge.dispute.funds_withdrawn':
      case 'charge.dispute.funds_reinstated': {
        // These mark the ACTUAL platform-balance movement for a dispute —
        // distinct from dispute.created (in-app hold, no real balance change
        // yet) and dispute.closed (this app's own win/loss ledger
        // settlement). No ledger mutation here (dispute.closed already owns
        // that); this exists so the platform-balance reconciliation
        // (comparePlatformBalance) has a recorded, expected explanation for
        // the resulting Stripe balance change instead of flagging it as
        // unexplained drift.
        const fundsDispute = event.data.object as Stripe.Dispute;
        const fundsEventKind =
          event.type === 'charge.dispute.funds_withdrawn' ? 'withdrawn' : 'reinstated';
        console.log(
          `[webhooks] charge.dispute.${fundsEventKind}: dispute=${fundsDispute.id} amount=$${fundsDispute.amount / 100}`
        );
        const { error: fundsFindingErr } = await supabase.from('reconciliation_findings').insert({
          finding_type: 'dispute_funds_movement',
          severity: 'info',
          user_id: null,
          details: {
            stripe_dispute_id: fundsDispute.id,
            direction: fundsEventKind,
            amount_cents: fundsDispute.amount,
          },
        });
        if (fundsFindingErr) {
          console.error(`[webhooks] charge.dispute.${fundsEventKind}: failed to record finding`, {
            dispute_id: fundsDispute.id,
            error: fundsFindingErr,
          });
        }
        break;
      }

      case 'refund.created':
      case 'refund.updated': {
        // The Refund-object events, distinct from the already-handled
        // `charge.refunded` (which owns the actual apply_refund ledger
        // mutation, keyed idempotently on stripe_refund_id). These fire for
        // the same underlying refund and are handled here as observability-
        // only — logging confirms Stripe's Refund object reached this state,
        // with no duplicate ledger write.
        const refundObj = event.data.object as Stripe.Refund;
        console.log(
          `[webhooks] ${event.type}: refund=${refundObj.id} status=${refundObj.status} amount=$${refundObj.amount / 100}`
        );
        break;
      }

      case 'refund.failed': {
        // The refund attempt did NOT return money to the customer — if a
        // bounty_payments row was optimistically moved to 'refund_pending' in
        // anticipation (see the charge.refunded handler's fallback path),
        // revert it back to 'captured' since the funds never actually left.
        const failedRefund = event.data.object as Stripe.Refund;
        const failedRefundPI =
          typeof failedRefund.payment_intent === 'string'
            ? failedRefund.payment_intent
            : ((failedRefund.payment_intent as Stripe.PaymentIntent | null)?.id ?? null);

        logCritical('Stripe refund failed — funds did not return to the customer', {
          refundId: failedRefund.id,
          paymentIntentId: failedRefundPI,
          amountCents: failedRefund.amount,
          failureReason:
            (failedRefund as unknown as { failure_reason?: string }).failure_reason ?? null,
        });

        if (failedRefundPI) {
          const { data: revertedBp, error: revertErr } = await supabase
            .from('bounty_payments')
            .update({ status: 'captured', updated_at: new Date().toISOString() })
            .eq('stripe_payment_intent_id', failedRefundPI)
            .eq('status', 'refund_pending')
            .select('id')
            .maybeSingle();
          if (revertErr) {
            console.error('[webhooks] refund.failed: failed to revert bounty_payments status', {
              paymentIntentId: failedRefundPI,
              error: revertErr,
            });
            throw revertErr;
          }
          if (revertedBp) {
            console.log(
              `[webhooks] refund.failed: reverted bounty_payment ${(revertedBp as any).id} to 'captured'`
            );
          }
        }
        break;
      }

      case 'topup.created':
      case 'topup.succeeded':
      case 'topup.failed': {
        // Platform-level treasury events — manually adding funds to the
        // platform Stripe balance from an external bank account, not tied to
        // any single user. No ledger mutation; recorded so
        // comparePlatformBalance has an explanation for the resulting
        // balance change instead of flagging it as unexplained drift.
        const topup = event.data.object as Stripe.Topup;
        console.log(
          `[webhooks] ${event.type}: topup=${topup.id} amount=$${topup.amount / 100} status=${topup.status}`
        );
        const { error: topupFindingErr } = await supabase.from('reconciliation_findings').insert({
          finding_type: 'stripe_topup',
          severity: 'info',
          user_id: null,
          details: {
            stripe_topup_id: topup.id,
            amount_cents: topup.amount,
            status: topup.status,
            event_type: event.type,
          },
        });
        if (topupFindingErr) {
          console.error('[webhooks] topup event: failed to record finding', {
            topup_id: topup.id,
            error: topupFindingErr,
          });
        }
        break;
      }

      case 'external_account.created':
      case 'external_account.updated':
      case 'external_account.deleted':
      case 'account.external_account.created':
      case 'account.external_account.updated':
      case 'account.external_account.deleted': {
        // A connected account's linked bank account/debit card changed —
        // either via /connect's own bank-accounts/debit-cards routes (in
        // which case this is a confirming echo) or directly in the Stripe
        // Dashboard (in which case this is the ONLY signal the app gets).
        // Whichever Connect API-version event family this project's webhook
        // endpoint is actually configured for, both share the same
        // Account/ExternalAccount payload shape, so one handler covers both.
        const externalAccountEventAccountId = (event as any).account as string | undefined;
        // Deliberately untyped as a specific Stripe object union — this
        // payload is either a BankAccount or a Card depending on the payout
        // method, and only `id`/`object` are actually used below.
        const externalAccount = event.data.object as unknown as { id: string; object: string };
        const changeKind = event.type.endsWith('.created')
          ? 'added'
          : event.type.endsWith('.deleted')
            ? 'removed'
            : 'updated';

        if (!externalAccountEventAccountId) {
          console.warn(`[webhooks] ${event.type}: no event.account present — skipping`);
          break;
        }
        const eaOwnerUserId = await findUserIdByConnectAccountId(
          supabase,
          externalAccountEventAccountId
        );
        if (!eaOwnerUserId) {
          console.warn(
            `[webhooks] ${event.type}: no profile found for Connect account ${externalAccountEventAccountId}`
          );
          break;
        }

        const { error: eaFindingErr } = await supabase.from('reconciliation_findings').insert({
          finding_type: 'external_account_change',
          severity: 'info',
          user_id: eaOwnerUserId,
          details: {
            stripe_account_id: externalAccountEventAccountId,
            external_account_id: externalAccount.id,
            object: externalAccount.object,
            change: changeKind,
          },
        });
        if (eaFindingErr) {
          console.error(`[webhooks] ${event.type}: failed to record finding`, {
            error: eaFindingErr,
          });
        }

        // A removed debit card invalidates any cached Instant Payout
        // eligibility for that method — /connect's own GET /debit-cards
        // route re-derives eligibility live from Stripe on every call, so
        // there is no cache to explicitly bust here; this notification is
        // the only user-facing action needed.
        const eaNotifBody =
          changeKind === 'removed'
            ? "A bank account or card was removed from your payout method outside the app. If this wasn't you, please review your payout settings."
            : `Your payout method was ${changeKind} outside the app.`;
        const eaNotifData = { stripeAccountId: externalAccountEventAccountId, change: changeKind };
        const { error: eaNotifErr } = await supabase.from('notifications').insert({
          user_id: eaOwnerUserId,
          type: 'payout_method_changed',
          title: 'Payout Method Changed',
          body: eaNotifBody,
          data: eaNotifData,
        });
        if (eaNotifErr) {
          console.error(`[webhooks] ${event.type}: failed to insert notification`, {
            error: eaNotifErr,
          });
          // Non-fatal — the audit finding above is the load-bearing write.
        } else {
          await enqueuePushEmailFanout(supabase, {
            userId: eaOwnerUserId,
            type: 'payout_method_changed',
            title: 'Payout Method Changed',
            body: eaNotifBody,
            data: eaNotifData,
          });
        }
        break;
      }

      case 'person.updated': {
        // A Connect account's KYC "Person" record changed (e.g. a
        // requirement was satisfied or newly imposed). The Person payload
        // itself doesn't carry the account's charges_enabled/payouts_enabled/
        // requirements — re-fetch the Account and reuse the same sync path as
        // the existing capability.updated handler.
        const personAccountId = (event as any).account as string | undefined;
        if (!personAccountId) {
          console.warn('[webhooks] person.updated: no event.account present — skipping');
          break;
        }
        try {
          const refreshedAccount = await stripe.accounts.retrieve(personAccountId);
          await syncConnectAccountToProfile(supabase, refreshedAccount);
          console.log(`[webhooks] person.updated: re-synced account ${personAccountId}`);
        } catch (personErr) {
          console.error('[webhooks] person.updated: failed to refresh/sync account', {
            accountId: personAccountId,
            error: (personErr as { message?: string })?.message,
          });
          throw personErr;
        }
        break;
      }

      // The public "Post a Bounty" web intake (see the bounty-checkout
      // function). bounty-checkout validates the submission, stores it in
      // pending_bounties as 'pending_payment' and sends the customer to
      // Stripe Checkout; THIS is the only place that paid submission becomes
      // a real account + bounty + captured escrow row.
      //
      // Stripe has always delivered this event to this endpoint, but there
      // was no case for it, so it fell through to `default` and was dropped
      // with a log line. That is why every pending_bounties row was still
      // sitting at 'pending_payment' with resulting_bounty_id NULL.
      //
      // async_payment_succeeded shares the body: delayed methods (ACH,
      // Klarna) complete the session while still unpaid and settle later.
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;

        if (session.metadata?.flow_type !== 'bounty_creation') {
          console.log(
            `[webhooks] checkout.session ${session.id} flow_type="${session.metadata?.flow_type ?? 'none'}" — not a bounty submission, skipping`
          );
          break;
        }

        // Never create a funded bounty before the money is actually captured.
        // The unpaid case comes back later as async_payment_succeeded.
        if (session.payment_status !== 'paid') {
          console.log(
            `[webhooks] checkout.session ${session.id} payment_status="${session.payment_status}" — awaiting settlement`
          );
          break;
        }

        const pendingBountyId =
          session.metadata?.pending_bounty_id ?? session.client_reference_id ?? null;
        const checkoutEmail = (
          session.metadata?.customer_email ??
          session.customer_details?.email ??
          ''
        )
          .trim()
          .toLowerCase();
        const paymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);

        // Terminal failures only — the customer has been charged and nothing
        // was created, so a human has to pick it up. Transient problems throw
        // instead, so Stripe retries rather than logging a row here.
        const recordCheckoutFailure = async (reason: string) => {
          const { data: already } = await supabase
            .from('checkout_processing_failures')
            .select('id')
            .eq('stripe_checkout_session_id', session.id)
            .eq('resolved', false)
            .maybeSingle();
          if (already) return;

          const { error: failErr } = await supabase.from('checkout_processing_failures').insert({
            stripe_event_id: event.id,
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id: paymentIntentId,
            pending_bounty_id: pendingBountyId,
            customer_email: checkoutEmail || null,
            amount: session.amount_total != null ? session.amount_total / 100 : null,
            reason,
            session_metadata: session.metadata ?? {},
          });
          if (failErr) {
            console.error(
              '[webhooks] Could not record checkout failure — rethrowing so Stripe retries',
              { sessionId: session.id, error: failErr }
            );
            throw failErr;
          }
        };

        if (!pendingBountyId) {
          console.error(
            `[webhooks] checkout.session ${session.id} is flow_type=bounty_creation but carries no pending_bounty_id`
          );
          await recordCheckoutFailure('missing_pending_bounty_id');
          break;
        }

        // Resolve the poster. fn_create_bounty_from_pending requires a real
        // owner, so an anonymous web payer has to be attached to an account:
        // the id bounty-checkout captured for a signed-in caller, else an
        // existing user with this address, else a new account. The lookup
        // goes through auth.users (not profiles.email, which is populated for
        // only a third of rows) so an existing customer is never handed a
        // duplicate account for a bounty they just paid for.
        let posterId: string | null = session.metadata?.supabase_user_id ?? null;

        if (!posterId && checkoutEmail) {
          const { data: existingId, error: findErr } = await supabase.rpc(
            'fn_find_user_id_by_email',
            { p_email: checkoutEmail }
          );
          if (findErr) {
            console.error('[webhooks] Poster lookup failed — letting Stripe retry', {
              sessionId: session.id,
              error: findErr,
            });
            throw findErr;
          }
          posterId = (existingId as string | null) ?? null;
        }

        if (!posterId) {
          if (!checkoutEmail) {
            console.error(
              `[webhooks] checkout.session ${session.id} has no email — cannot attach a poster`
            );
            await recordCheckoutFailure('no_email_to_resolve_poster');
            break;
          }

          const { data: createdUser, error: createErr } = await supabase.auth.admin.createUser({
            email: checkoutEmail,
            email_confirm: true,
            user_metadata: { source: 'bounty_checkout_web', pending_bounty_id: pendingBountyId },
          });

          if (createErr) {
            // "User already registered / already exists" signals a concurrent
            // delivery won the race and the account is now there; re-resolve.
            // Everything else (rate limits, network errors, 5xx) is transient:
            // throw so Stripe retries rather than permanently failing a paid
            // checkout.
            const isEmailConflict =
              (createErr as { status?: number }).status === 422 ||
              /already (registered|exists)/i.test(createErr.message ?? '');

            if (!isEmailConflict) {
              console.error(
                '[webhooks] Transient error creating poster account — letting Stripe retry',
                { sessionId: session.id, error: createErr }
              );
              throw createErr;
            }

            // Either a concurrent delivery won the race or the address was
            // registered between the lookup and here. Re-resolve rather than
            // failing a payment that already succeeded.
            const { data: racedId, error: raceErr } = await supabase.rpc(
              'fn_find_user_id_by_email',
              { p_email: checkoutEmail }
            );
            if (raceErr) {
              console.error(
                '[webhooks] Transient error re-resolving poster after creation race — letting Stripe retry',
                { sessionId: session.id, error: raceErr }
              );
              throw raceErr;
            }
            posterId = (racedId as string | null) ?? null;
            if (!posterId) {
              console.error(
                '[webhooks] Could not create or resolve a poster account — createUser returned 422 but re-resolve also found no user',
                {
                  sessionId: session.id,
                  createErr,
                }
              );
              await recordCheckoutFailure(
                'account_creation_failed: re-resolve returned no user after 422 conflict'
              );
              break;
            }
          } else {
            posterId = createdUser?.user?.id ?? null;
            if (!posterId) {
              console.error('[webhooks] createUser returned no id', { sessionId: session.id });
              await recordCheckoutFailure('account_creation_returned_no_id');
              break;
            }
            // on_auth_user_created builds the profile row but does not copy
            // the address across; set it so this account is resolvable by
            // email next time and receipts have somewhere to go.
            const { error: emailErr } = await supabase
              .from('profiles')
              .update({ email: checkoutEmail })
              .eq('id', posterId);
            if (emailErr) {
              console.error('[webhooks] Could not backfill profile email (non-fatal)', {
                posterId,
                error: emailErr,
              });
            }

            // This account belongs to someone who paid on the web and has no
            // password, and ONLY the poster can release funds to a hunter
            // (bounty-payments/release enforces bp.poster_id === userId, with
            // no admin override). Without a way in they would fund a bounty,
            // let a hunter complete it, and have no way to pay them — so the
            // way in has to go out now, not as a later follow-up.
            //
            // Deliberately uses Supabase Auth's own delivery rather than the
            // send-notification-email function: that one still has no provider
            // key and only logs to console, so it would deliver nothing. This
            // is the same mechanism and template as the app's existing
            // forgot-password flow (lib/services/auth-service.ts), and the
            // redirect matches its convention — a universal link that opens
            // the app on mobile and a web reset form on desktop.
            const authRedirectUrl =
              Deno.env.get('BOUNTY_AUTH_REDIRECT_URL') ?? 'https://bountyfinder.app/auth/callback';
            const { error: signInEmailErr } = await supabase.auth.resetPasswordForEmail(
              checkoutEmail,
              { redirectTo: authRedirectUrl }
            );
            if (signInEmailErr) {
              // Non-fatal on purpose: the payment succeeded and the bounty must
              // still be created. But log loudly — until this person gets into
              // the account, the hunter on their bounty cannot be paid. The
              // fallback is that "forgot password" in the app on this same
              // address also works, since the account is already confirmed.
              console.error(
                '[webhooks] CRITICAL: created a web poster account but could not send its sign-in email — poster cannot release funds until they recover access',
                { posterId, sessionId: session.id, error: signInEmailErr }
              );
            } else {
              console.log('[webhooks] Sent account-access email to new web poster', { posterId });
            }
          }
        }

        // Record the charge now: nothing else will backfill it. The existing
        // payment_intent.succeeded branch only touches purpose==='bounty_escrow'
        // rows and bails when metadata.user_id is absent, and a checkout PI
        // carries neither.
        let chargeId: string | null = null;
        if (paymentIntentId) {
          try {
            const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
            chargeId = (pi.latest_charge as string) ?? null;
          } catch (piErr) {
            console.error('[webhooks] Could not read charge id off the intent (non-fatal)', {
              paymentIntentId,
              piErr,
            });
          }
        }

        // Adaptive Pricing is enabled on this account, so an international
        // customer can settle in their own currency — amount_total/currency
        // then come back as EUR/GBP/etc. Both the escrow ledger and the payout
        // transfer in bounty-payments are USD (transfers.create hardcodes
        // currency:'usd' and derives the hunter's cut from bounty_payments.amount),
        // so writing a foreign-currency total here would pay the hunter that
        // number of DOLLARS. Only trust amount_total when Stripe actually
        // charged USD; otherwise pass null and let the RPC fall back to the
        // authoritative USD amount already validated onto the pending row.
        const settledUsd =
          session.currency === 'usd' && session.amount_total != null
            ? session.amount_total / 100
            : null;

        // One atomic, replay-safe step: inserts the bounty and its captured
        // bounty_payments escrow row and flips the pending row to 'created'.
        // Returns created=false when it recognises a replay.
        const { data: rpcRows, error: rpcErr } = await supabase.rpc(
          'fn_create_bounty_from_pending',
          {
            p_pending_id: pendingBountyId,
            p_poster_id: posterId,
            p_session_id: session.id,
            p_payment_intent_id: paymentIntentId,
            p_charge_id: chargeId,
            p_customer_id: typeof session.customer === 'string' ? session.customer : null,
            p_amount_paid: settledUsd,
            // The ledger is denominated in USD regardless of what the customer
            // settled in; the actual settlement currency is kept in metadata.
            p_currency: 'usd',
            p_metadata: {
              stripe_event_id: event.id,
              source: eventType,
              settlement_currency: session.currency ?? null,
              settlement_amount_total: session.amount_total ?? null,
            },
          }
        );

        if (rpcErr) {
          console.error('[webhooks] fn_create_bounty_from_pending failed — letting Stripe retry', {
            sessionId: session.id,
            pendingBountyId,
            error: rpcErr,
          });
          // Do not record a checkout_processing_failure here: this path throws
          // so Stripe will retry, and if the retry succeeds the failure row would
          // never be resolved. Reserve checkout_processing_failures for terminal
          // paths that return 200; let stripe_events retry tracking cover this.
          throw rpcErr;
        }

        const created = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
        console.log('[webhooks] bounty_creation checkout processed', {
          sessionId: session.id,
          pendingBountyId,
          posterId,
          bountyId: created?.bounty_id,
          bountyPaymentId: created?.bounty_payment_id,
          newlyCreated: created?.created,
        });
        break;
      }

      default:
        console.log(`[webhooks] Unhandled event type: ${event.type}`);
    }

    // Mark event as processed. This releases the claim lease taken above, so a
    // failure here is not cosmetic: the row stays `processing`, monitoring
    // reads it as an unprocessed event, and — worse — the handler's work is
    // done but nothing records it, so a Stripe redelivery after the lease
    // expires would re-enter the handler. The result was previously discarded
    // entirely; check it and escalate.
    const { error: markError } = await supabase
      .from('stripe_events')
      .update({ processed: true, processed_at: new Date().toISOString(), status: 'processed' })
      .eq('stripe_event_id', event.id);

    if (markError) {
      logCritical('event handled but could not be marked processed — replay risk', {
        eventId: event.id,
        eventType: event.type,
        error: markError,
      });
      throw new Error('Webhook event handled but could not be marked processed');
    }

    return jsonResponse({ received: true });
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('[webhooks] Error processing event:', err);

    // Record the failure on stripe_events for the failed-webhook admin
    // dashboard/replay tooling — these columns (retry_count/last_error/
    // status) have existed since 20260115_enhance_webhook_tracking.sql but
    // were never actually written to until now. Best-effort: a failure here
    // must not mask the original processing error already being returned to
    // Stripe (which is what actually triggers Stripe's own retry).
    try {
      await supabase.rpc('record_stripe_event_failure', {
        p_stripe_event_id: event!.id,
        p_error_message: err?.message ?? String(error),
      });
    } catch (dlqErr) {
      console.error('[webhooks] Failed to record DLQ failure state (non-fatal)', { dlqErr });
    }

    return jsonResponse({ error: 'Webhook processing failed' }, 500);
  }
});
