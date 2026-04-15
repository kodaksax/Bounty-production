// Supabase Edge Function: webhooks
// Handles POST /webhooks/stripe — Stripe webhook event processing.
// This is the most critical function to migrate as it processes payments
// and must verify Stripe's webhook signature.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';
import type { WalletTransaction } from '../_shared/types.ts';

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
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeKey || !webhookSecret) {
    console.error('[webhooks] Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
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

  function hex(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function computeHmacSha256(key: string, data: string) {
    const enc = new TextEncoder();
    const keyData = enc.encode(key);
    const msgData = enc.encode(data);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    return hex(sig);
  }

  function safeCompare(a: string, b: string) {
    if (a.length !== b.length) return false;
    let res = 0;
    for (let i = 0; i < a.length; i++) {
      res |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return res === 0;
  }

  async function verifyStripeSignature(payload: string, header: string | null, secret: string) {
    if (!header) return false;
    // header like: t=timestamp,v1=signature[,v1=...]
    const headerParts = header.split(',').map(part => part.trim());
    const headerKeyValues: Record<string, string[]> = {};
    for (const part of headerParts) {
      const [key, value] = part.split('=');
      if (!headerKeyValues[key]) headerKeyValues[key] = [];
      headerKeyValues[key].push(value);
    }
    const t = headerKeyValues['t']?.[0];
    const signatures = headerKeyValues['v1'] ?? [];
    if (!t || signatures.length === 0) return false;

    const signedPayload = `${t}.${payload}`;
    const expected = await computeHmacSha256(secret, signedPayload);

    for (const s of signatures) {
      if (safeCompare(s, expected)) {
        // optional: validate timestamp skew (5 minutes)
        const ts = Number(t);
        if (Number.isFinite(ts)) {
          const now = Math.floor(Date.now() / 1000);
          if (Math.abs(now - ts) > 5 * 60) return false;
        }
        return true;
      }
    }
    return false;
  }

  try {
    const verified = await verifyStripeSignature(rawBody, sig, webhookSecret);
    if (!verified) {
      console.error('[webhooks] Signature verification failed (manual):', {
        timestamp: new Date().toISOString(),
        rawBodyLength: typeof rawBody === 'string' ? rawBody.length : undefined,
      });
      return jsonResponse({ error: `Webhook signature verification failed` }, 400);
    }

    // signature verified — parse event
    event = JSON.parse(rawBody) as Stripe.Event;
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[webhooks] Error parsing/verification:', e?.message ?? err);
    return jsonResponse({ error: 'Webhook verification/parsing failed' }, 400);
  }

  try {
    // Log event for tracking — upsert on stripe_event_id to safely handle retries
    await supabase.from('stripe_events').upsert(
      {
        stripe_event_id: event.id,
        event_type: event.type,
        event_data: event.data.object,
        processed: false,
      },
      { onConflict: 'stripe_event_id' }
    );

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const userId = paymentIntent.metadata?.user_id;

        if (!userId) {
          console.error('[webhooks] Missing user_id in payment intent metadata');
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

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const userId = paymentIntent.metadata?.user_id;
        const error = paymentIntent.last_payment_error;

        console.log(`[webhooks] PaymentIntent failed: ${paymentIntent.id} for user ${userId}`);
        console.log(`[webhooks] Failure reason: ${error?.code} - ${error?.message}`);

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
        }
        break;
      }

      case 'transfer.created': {
        // Replay-safe: this handler performs an UPDATE (not INSERT), so a second
        // delivery of the same event is a no-op — the row already has
        // stripe_transfer_id set and the `.is('stripe_transfer_id', null)` filter
        // will match zero rows, leaving the database unchanged.
        const transfer = event.data.object as Stripe.Transfer;
        console.log(`[webhooks] Transfer created: ${transfer.id}`);
        const transferUserId = transfer.metadata?.user_id;
        const transferAmountDollars = transfer.amount / 100;
        if (transferUserId) {
          await supabase
            .from('wallet_transactions')
            .update({
              stripe_transfer_id: transfer.id,
              metadata: { transfer_status: 'created' },
            })
            .eq('user_id', transferUserId)
            .eq('type', 'withdrawal')
            .eq('amount', -transferAmountDollars)
            .is('stripe_transfer_id', null)
            .order('created_at', { ascending: false })
            .limit(1);
        }
        break;
      }

      case 'transfer.paid': {
        const transfer = event.data.object as Stripe.Transfer;
        console.log(`[webhooks] Transfer paid: ${transfer.id}`);
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
        console.log(`[webhooks] Transfer failed: ${transfer.id}`);

        // Read the existing metadata so we can (a) preserve fields written by
        // the retry endpoint (e.g. retry_count, retried_at) and (b) check
        // whether the retry limit has been reached without double-incrementing
        // retry_count (the retry endpoint already does that increment).
        // IMPORTANT: Also select `id` so the subsequent UPDATE is keyed on the
        // immutable primary key rather than `stripe_transfer_id`.  A concurrent
        // retry will overwrite `stripe_transfer_id` with a new Stripe transfer
        // ID between this read and the update below; using `id` prevents the
        // update from silently matching zero rows (TOCTOU race → missed refund).
        const { data: existingTx, error: existingTxError } = await supabase
          .from('wallet_transactions')
          .select('id, metadata')
          .eq('stripe_transfer_id', transfer.id)
          .maybeSingle();

        if (existingTxError) {
          console.error('[webhooks] Failed to look up transaction for transfer.failed', {
            transferId: transfer.id,
            error: existingTxError,
          });
          throw existingTxError;
        }

        if (!existingTx) {
          // No matching row — the transfer ID may have already been superseded by
          // a retry.  Log and skip; there is nothing to refund for this event.
          console.warn(
            `[webhooks] No wallet_transaction found for transfer ${transfer.id} — possibly superseded by a retry. Skipping.`
          );
          break;
        }

        const existingMetadata = (existingTx?.metadata as Record<string, unknown> | null) ?? {};
        const currentRetries = (existingMetadata.retry_count as number | undefined) ?? 0;
        const permanentlyFailed = currentRetries >= MAX_TRANSFER_RETRIES;

        const { data: tx, error: txUpdateError } = await supabase
          .from('wallet_transactions')
          .update({
            // wallet_transactions.status is constrained to ('pending','completed','failed').
            // Encode permanent-failure state in metadata.transfer_status instead.
            status: 'failed',
            metadata: {
              ...existingMetadata,
              transfer_status: permanentlyFailed ? 'permanently_failed' : 'failed',
              // Stripe Transfer objects expose failure_code on the Transfer type
              failure_reason: (transfer as Stripe.Transfer & { failure_code?: string })
                .failure_code,
            },
          })
          // Use the primary key — immune to concurrent stripe_transfer_id overwrites.
          .eq('id', existingTx.id)
          .select()
          .single();

        if (txUpdateError) {
          console.error('[webhooks] Failed to update transaction for transfer.failed', {
            transactionId: existingTx.id,
            transferId: transfer.id,
            error: txUpdateError,
          });
          throw txUpdateError;
        }

        const txRow = tx as WalletTransaction;
        const refundAmount = Math.abs(txRow.amount);
        const txUserId = txRow.user_id;

        if (permanentlyFailed) {
          // Do NOT automatically refund — requires manual review.
          console.warn(
            `[webhooks] Transfer ${transfer.id} permanently failed after ${currentRetries} retries for user ${txUserId}. Manual review required.`
          );

          // Check for an existing notification to keep this handler idempotent
          // (Stripe may re-deliver the same webhook event on transient errors).
          const { data: existingNotification, error: existingNotificationError } = await supabase
            .from('notifications')
            .select('id')
            .eq('user_id', txUserId)
            .eq('type', 'payment')
            .eq('title', 'Withdrawal Failed')
            .contains('data', { transferId: transfer.id })
            .maybeSingle();

          if (existingNotificationError) {
            console.error(
              '[webhooks] Failed to check for existing permanently_failed notification',
              {
                userId: txUserId,
                transferId: transfer.id,
                error: existingNotificationError,
              }
            );
            throw existingNotificationError;
          }

          if (!existingNotification) {
            const { error: notifError } = await supabase.from('notifications').insert({
              user_id: txUserId,
              type: 'payment',
              title: 'Withdrawal Failed',
              body: 'Your withdrawal could not be completed after multiple attempts. Please contact support.',
              data: { transferId: transfer.id, retry_count: currentRetries },
            });
            if (notifError) {
              console.error('[webhooks] Failed to insert permanently_failed notification', {
                userId: txUserId,
                transferId: transfer.id,
                error: notifError,
              });
              throw notifError;
            }
          } else {
            console.log(
              `[webhooks] Skipping duplicate permanently_failed notification for transfer ${transfer.id} and user ${txUserId}`
            );
          }
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
                '[webhooks] Atomic balance update for transfer refund failed — letting Stripe retry'
              );
              throw retryError;
            }
          }
          console.log(
            `[webhooks] Refunded $${refundAmount} to user ${txUserId} for failed transfer (retries: ${currentRetries}/${MAX_TRANSFER_RETRIES})`
          );
        }
        break;
      }

      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        console.log(`[webhooks] Connect account updated: ${account.id}`);
        if (account.metadata?.user_id) {
          await supabase
            .from('profiles')
            .update({
              stripe_connect_onboarded_at:
                account.charges_enabled && account.payouts_enabled
                  ? new Date().toISOString()
                  : null,
            })
            .eq('id', account.metadata.user_id);
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
          } else {
            console.warn(`[webhooks] No profile found for Connect account ${paidAccountId}`);
          }
        }
        break;
      }

      case 'payout.failed': {
        const payout = event.data.object as Stripe.Payout;
        const failedAccountId = (event as any).account as string | undefined;
        console.log(`[webhooks] Payout failed: ${payout.id}, reason: ${payout.failure_code}`);

        if (failedAccountId) {
          const { data: failedProfile, error: failedProfileError } = await supabase
            .from('profiles')
            .select('id')
            .eq('stripe_connect_account_id', failedAccountId)
            .maybeSingle();

          if (failedProfileError) {
            console.error('[webhooks] Supabase error looking up profile for payout.failed', {
              accountId: failedAccountId,
              error: failedProfileError,
            });
            throw failedProfileError;
          }

          if (failedProfile) {
            // Insert notification, falling back to an update when the insert
            // conflicts. Avoid `.upsert()` because the DB uses a partial unique
            // index on (user_id,type,stripe_payout_id) WHERE stripe_payout_id IS NOT NULL.
            const notifRow = {
              user_id: failedProfile.id,
              type: 'payment',
              title: 'Payout Failed',
              body: `Your payout of $${(payout.amount / 100).toFixed(2)} could not be processed. ${payout.failure_message || payout.failure_code || 'Please update your bank account details.'}`,
              data: {
                payoutId: payout.id,
                failureCode: payout.failure_code,
                failureMessage: payout.failure_message,
              },
              stripe_payout_id: payout.id,
            };

            const { error: insertErr } = await supabase.from('notifications').insert(notifRow);

            if (insertErr) {
              const { data: updatedNotif, error: updateFallbackErr } = await supabase
                .from('notifications')
                .update(notifRow)
                .eq('user_id', failedProfile.id)
                .eq('type', 'payment')
                .eq('stripe_payout_id', payout.id)
                .select()
                .maybeSingle();

              if (updateFallbackErr) {
                console.error('[webhooks] Failed to insert payout.failed notification', {
                  profileId: failedProfile.id,
                  insert_error: insertErr,
                  update_error: updateFallbackErr,
                });
                throw updateFallbackErr;
              }

              if (!updatedNotif) {
                console.error(
                  '[webhooks] Failed to insert or update payout.failed notification (no rows affected)',
                  { profileId: failedProfile.id, insert_error: insertErr }
                );
                throw new Error('Failed to insert or update payout.failed notification');
              }

              console.log(
                `[webhooks] Notified hunter ${failedProfile.id} of payout.failed (update fallback)`
              );
            } else {
              console.log(`[webhooks] Notified hunter ${failedProfile.id} of payout.failed`);
            }

            // Flag the profile so support can follow up
            const { error: payoutFlagError } = await supabase
              .from('profiles')
              .update({
                payout_failed_at: new Date().toISOString(),
                payout_failure_code: payout.failure_code ?? null,
              })
              .eq('id', failedProfile.id);
            if (payoutFlagError) {
              console.error('[webhooks] Failed to flag profile payout_failed_at', {
                profileId: failedProfile.id,
                error: payoutFlagError,
              });
              throw payoutFlagError;
            }
          } else {
            console.warn(`[webhooks] No profile found for Connect account ${failedAccountId}`);
          }
        }
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

        // Notify the poster
        const { error: notifError } = await supabase.from('notifications').insert({
          user_id: disputeUserId,
          type: 'payment',
          title: 'Payment Dispute Opened',
          body: 'A payment dispute has been opened on your account. Your wallet has been temporarily frozen.',
          data: { stripeDisputeId: dispute.id },
        });
        if (notifError) {
          console.error('[webhooks] charge.dispute.created: failed to insert notification', {
            user_id: disputeUserId,
            error: notifError,
          });
          // Non-fatal — do not rethrow; dispute row and freeze are the critical ops
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
            const { data: appliedTx, error: applyError } = await supabase.rpc(
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

        const { error: closedNotifError } = await supabase.from('notifications').insert({
          user_id: closedUserId,
          type: 'payment',
          title: disputeWon ? 'Dispute Resolved — Won' : 'Dispute Resolved — Lost',
          body: outcomeMsg,
          data: { stripeDisputeId: closedDispute.id },
        });
        if (closedNotifError) {
          console.error('[webhooks] charge.dispute.closed: failed to insert notification', {
            user_id: closedUserId,
            error: closedNotifError,
          });
          // Non-fatal
        }

        console.log(
          `[webhooks] charge.dispute.closed: dispute ${closedDispute.id} resolved (${closedStatus}) for user ${closedUserId}`
        );
        break;
      }

      default:
        console.log(`[webhooks] Unhandled event type: ${event.type}`);
    }

    // Mark event as processed
    await supabase
      .from('stripe_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('stripe_event_id', event.id);

    return jsonResponse({ received: true });
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('[webhooks] Error processing event:', err);
    return jsonResponse({ error: 'Webhook processing failed' }, 500);
  }
});
