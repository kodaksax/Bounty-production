import { createClient } from '@supabase/supabase-js';
import * as cron from 'node-cron';
import { backendAnalytics } from './analytics';
import { stripe } from './consolidated-payment-service';
import { updateBalance } from './consolidated-wallet-service';
import { logger } from './logger';

/**
 * Reconciliation Cron
 * - Periodically compares Stripe object states with DB wallet transactions
 * - Repairs DB statuses to match Stripe (mark completed/failed)
 * - Logs mismatches for manual review
 */
export class ReconciliationCronService {
  private task: cron.ScheduledTask | null = null;
  private isEnabled: boolean;

  constructor() {
    this.isEnabled = process.env.ENABLE_RECONCILIATION_CRON !== 'false';
  }

  start() {
    if (!this.isEnabled) {
      console.log('⏭️  Reconciliation cron disabled (ENABLE_RECONCILIATION_CRON=false)');
      return;
    }

    const schedule = process.env.RECONCILIATION_CRON || '*/5 * * * *'; // every 5 minutes
    console.log(`🕐 Starting reconciliation cron (schedule: ${schedule})`);

    this.task = cron.schedule(schedule, async () => {
      try {
        await this.runOnce();
        try {
          backendAnalytics.trackEvent('system', 'reconciliation_run', { schedule });
        } catch {
          /* ignore */
        }
      } catch (err) {
        logger.error({ err }, '[reconciliation] Unexpected error during reconciliation run');
      }
    });

    // Run immediately once on start
    this.runOnce().catch(err => {
      logger.error({ err }, '[reconciliation] Initial run failed');
      try {
        backendAnalytics.trackEvent('system', 'reconciliation_initial_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      } catch {
        /* ignore */
      }
    });
  }

  stop() {
    if (this.task) {
      this.task.stop();
      console.log('🛑 Reconciliation cron stopped');
    }
  }

  async runOnce() {
    // Create Supabase admin client
    const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      logger.warn('[reconciliation] Supabase admin credentials not configured; skipping run');
      return;
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Reconcile Stripe Transfers
    try {
      const { data: pendingTransfers, error: txErr } = await admin
        .from('wallet_transactions')
        .select('*')
        .not('stripe_transfer_id', 'is', null)
        .neq('status', 'completed')
        .limit(200);

      if (txErr) {
        logger.error({ error: txErr }, '[reconciliation] Failed to fetch transfer transactions');
      } else if (pendingTransfers && pendingTransfers.length) {
        for (const tx of pendingTransfers) {
          try {
            const transferId = tx.stripe_transfer_id;
            const transfer = await stripe.transfers.retrieve(transferId);
            const s = transfer.status;

            if (s === 'paid' || s === 'succeeded') {
              await admin
                .from('wallet_transactions')
                .update({ status: 'completed' })
                .eq('id', tx.id);
              logger.info(
                { txId: tx.id, transferId },
                '[reconciliation] Marked transfer transaction completed'
              );
            } else if (s === 'failed' || s === 'canceled') {
              await admin.from('wallet_transactions').update({ status: 'failed' }).eq('id', tx.id);
              logger.warn(
                { txId: tx.id, transferId, stripeStatus: s },
                '[reconciliation] Marked transfer transaction failed'
              );
            } else {
              logger.debug(
                { txId: tx.id, transferId, stripeStatus: s },
                '[reconciliation] Transfer in non-terminal state'
              );
            }
          } catch (err) {
            logger.error(
              { err, txId: tx.id },
              '[reconciliation] Error reconciling transfer transaction'
            );
          }
        }
      }
    } catch (err) {
      logger.error({ err }, '[reconciliation] Error during transfer reconciliation loop');
    }

    // Reconcile PaymentIntents (deposits / payment flow)
    try {
      const { data: pendingIntents, error: piErr } = await admin
        .from('wallet_transactions')
        .select('*')
        .not('stripe_payment_intent_id', 'is', null)
        .neq('status', 'completed')
        .limit(200);

      if (piErr) {
        logger.error(
          { error: piErr },
          '[reconciliation] Failed to fetch payment intent transactions'
        );
      } else if (pendingIntents && pendingIntents.length) {
        for (const tx of pendingIntents) {
          try {
            const piId = tx.stripe_payment_intent_id;
            const pi = await stripe.paymentIntents.retrieve(piId);
            const s = pi.status;

            if (s === 'succeeded') {
              await admin
                .from('wallet_transactions')
                .update({ status: 'completed' })
                .eq('id', tx.id);
              logger.info(
                { txId: tx.id, paymentIntent: piId },
                '[reconciliation] Marked payment intent transaction completed'
              );
            } else if (s === 'canceled' || s === 'requires_payment_method') {
              await admin.from('wallet_transactions').update({ status: 'failed' }).eq('id', tx.id);
              logger.warn(
                { txId: tx.id, paymentIntent: piId, stripeStatus: s },
                '[reconciliation] Marked payment intent transaction failed'
              );
            } else {
              logger.debug(
                { txId: tx.id, paymentIntent: piId, stripeStatus: s },
                '[reconciliation] PaymentIntent in non-terminal state'
              );
            }
          } catch (err) {
            logger.error(
              { err, txId: tx.id },
              '[reconciliation] Error reconciling payment intent transaction'
            );
          }
        }
      }
    } catch (err) {
      logger.error({ err }, '[reconciliation] Error during payment intent reconciliation loop');
    }

    // Restore balance for failed transactions where the balance rollback itself failed.
    // This covers both 'withdrawal' (Stripe transfer + rollback double-failure) and
    // 'escrow' (finalization + refund double-failure) transactions.
    // These are flagged with needs_balance_refund=true in their metadata by the
    // wallet service when the balance-restoring updateBalance call throws.
    // We include both 'failed' and 'pending' statuses because if the DB update that
    // flips the record to 'failed' itself fails, the record stays 'pending' while
    // still carrying the needs_balance_refund flag — that case would otherwise be
    // silently missed.
    try {
      const { data: orphanedTxs, error: orphanErr } = await admin
        .from('wallet_transactions')
        .select('*')
        .in('type', ['withdrawal', 'escrow'])
        .in('status', ['failed', 'pending'])
        .filter('metadata->>needs_balance_refund', 'eq', 'true')
        .limit(100);

      if (orphanErr) {
        logger.error(
          { error: orphanErr },
          '[reconciliation] Failed to fetch failed transactions needing balance refund'
        );
      } else if (orphanedTxs && orphanedTxs.length) {
        for (const tx of orphanedTxs) {
          try {
            const refundAmount: number =
              tx.metadata?.needs_balance_refund_amount ?? Math.abs(tx.amount);
            const appliedAt = new Date().toISOString();

            // Clear the flag FIRST (conditional on it still being true) before touching
            // the balance. This acts as an optimistic lock: two concurrent cron runs cannot
            // both process the same transaction, and a crash after this point cannot cause a
            // double-credit on re-run.  If updateBalance then fails we re-set the flag so
            // the next run will retry.
            const { data: claimData, error: claimErr } = await admin
              .from('wallet_transactions')
              .update({
                metadata: {
                  ...tx.metadata,
                  needs_balance_refund: false,
                  balance_refund_applied_at: appliedAt,
                },
              })
              .eq('id', tx.id)
              .filter('metadata->>needs_balance_refund', 'eq', 'true')
              .select('id');

            if (claimErr) {
              throw new Error(`Failed to claim refund flag: ${claimErr.message}`);
            }

            // If no rows were returned, the flag was already cleared by another run.
            if (!claimData || (Array.isArray(claimData) && claimData.length === 0)) {
              logger.info(
                { txId: tx.id },
                '[reconciliation] Refund flag already cleared by another run, skipping'
              );
              continue;
            }

            try {
              await updateBalance(tx.user_id, refundAmount);
            } catch (balanceErr) {
              // Balance update failed — re-set the flag so the next run will retry.
              await admin
                .from('wallet_transactions')
                .update({
                  metadata: {
                    ...tx.metadata,
                    needs_balance_refund: true,
                    balance_refund_applied_at: null,
                  },
                })
                .eq('id', tx.id);
              throw balanceErr;
            }

            logger.info(
              { txId: tx.id, userId: tx.user_id, amount: refundAmount, type: tx.type },
              '[reconciliation] Restored user balance for failed transaction rollback'
            );
            try {
              backendAnalytics.trackEvent('system', 'reconciliation_balance_refund', {
                txId: tx.id,
                userId: tx.user_id,
                amount: refundAmount,
              });
            } catch {
              /* ignore */
            }
          } catch (err) {
            logger.error(
              { err, txId: tx.id },
              '[reconciliation] Error restoring balance for failed withdrawal'
            );
          }
        }
      }
    } catch (err) {
      logger.error({ err }, '[reconciliation] Error during balance refund recovery loop');
    }
  }
}

export const reconciliationCron = new ReconciliationCronService();
