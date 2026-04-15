// Supabase Edge Function: wallet
// Handles wallet routes previously served by the Node/Express server.
// Routes:
//   GET  /wallet/balance
//   GET  /wallet/transactions
//   POST /wallet/deposit   (client-initiated deposit after Stripe payment confirmation)
//   POST /wallet/escrow    (hold funds when a bounty is posted)
//   POST /wallet/refund    (return escrowed funds to poster on cancellation)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ApplyDepositResult, Profile, WalletTransaction } from '../_shared/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isApplyDepositResult(obj: unknown): obj is ApplyDepositResult {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.applied === 'boolean';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Single outer try/catch ensures ALL errors—including those thrown by the
  // authentication step—are caught and returned as a JSON response instead of
  // propagating to Deno's default handler (which returns text/plain; 500).
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/wallet');
    const subPath = pathParts.length > 1 ? pathParts[1] : '/';

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.warn('[wallet edge fn] missing Authorization header');
      return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401);
    }
    const token = authHeader.substring(7);

    let userId: string;
    try {
      const { data, error: authError } = await supabase.auth.getUser(token);
      if (authError || !data?.user) {
        console.warn('[wallet edge fn] invalid or expired token', authError || 'no user');
        return jsonResponse({ error: 'Authentication required. Please sign in to continue.' }, 401);
      }
      userId = data.user.id;
    } catch (authException: unknown) {
      const msg = authException instanceof Error ? authException.message : String(authException);
      console.error('[wallet edge fn] getUser threw unexpectedly:', msg);
      return jsonResponse({ error: 'Authentication service unavailable. Please try again.' }, 503);
    }

    try {
      // POST /wallet/deposit — client-initiated deposit after Stripe payment confirmation.
      // Called immediately after processPayment() succeeds on the client so that
      // profiles.balance is updated durably without relying solely on the webhook.
      // Uses the apply_deposit RPC which is idempotent on stripe_payment_intent_id,
      // so a concurrent webhook delivery results in a safe no-op.
      if (req.method === 'POST' && subPath === '/deposit') {
        let body: { amount?: unknown; paymentIntentId?: unknown };
        try {
          body = await req.json();
        } catch {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }

        const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
        const paymentIntentId =
          typeof body.paymentIntentId === 'string' ? body.paymentIntentId.trim() : '';

        if (!Number.isFinite(amount) || amount <= 0) {
          return jsonResponse({ error: 'Invalid amount' }, 400);
        }
        if (!paymentIntentId) {
          return jsonResponse({ error: 'paymentIntentId is required' }, 400);
        }

        // Call the atomic apply_deposit function which:
        //   1. Inserts the wallet_transaction (ON CONFLICT DO NOTHING for idempotency)
        //   2. Updates profiles.balance atomically
        // Returns { applied: boolean, tx_id: UUID }
        const { data: applyRes, error: applyErr } = await supabase.rpc('apply_deposit', {
          p_user_id: userId,
          p_amount: amount,
          p_payment_intent_id: paymentIntentId,
          p_metadata: {
            payment_intent_id: paymentIntentId,
            created_via: 'client_post_payment',
          },
        });

        if (applyErr) {
          console.error('[wallet] apply_deposit error:', applyErr);
          return jsonResponse({ error: 'Failed to record deposit' }, 500);
        }

        // Normalize possible shapes: RPC may return an object or an array with a single row.
        let applied = false;
        let tx_id: string | null = null;
        const candidate = Array.isArray(applyRes)
          ? (applyRes[0] as unknown)
          : (applyRes as unknown);
        if (isApplyDepositResult(candidate)) {
          applied = candidate.applied;
          tx_id = (candidate as any).tx_id ?? null;
        } else if (candidate && typeof (candidate as any).applied === 'boolean') {
          applied = Boolean((candidate as any).applied);
          tx_id = (candidate as any).tx_id ?? null;
        } else {
          console.warn('[wallet] apply_deposit returned unexpected shape', applyRes);
        }

        // Fetch updated balance to return to client
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('balance')
          .eq('id', userId)
          .single();

        if (profileError) {
          console.error('[wallet] failed to fetch updated balance after deposit:', profileError);
          return jsonResponse(
            {
              success: applied,
              tx_id,
              balance: null,
              warning: 'Deposit recorded, but failed to fetch updated balance',
            },
            500
          );
        }

        const newBalance = (profileData as Profile | null)?.balance ?? (applied ? amount : 0);

        return jsonResponse({ success: applied, tx_id, balance: newBalance });
      }

      // GET /wallet/balance
      if (subPath === '/balance') {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('balance, payout_failed_at, payout_failure_code')
          .eq('id', userId)
          .single();

        if (error) {
          console.error('[wallet] Error fetching balance:', error);
          return jsonResponse({ error: 'Failed to fetch balance' }, 500);
        }

        let balance = (profile as Profile | null)?.balance ?? 0;

        // Cross-check: when cached balance is 0, derive from completed
        // transactions. wallet_transactions stores signed amounts (negative for
        // debits), so we sum them directly instead of applying direction by type.
        if (balance === 0) {
          const { data: txRows } = await supabase
            .from('wallet_transactions')
            .select('amount')
            .eq('user_id', userId)
            .eq('status', 'completed');

          if (txRows && txRows.length > 0) {
            let derived = 0;
            for (const tx of txRows as { amount: number }[]) {
              derived += Number(tx.amount) || 0;
            }
            if (derived > 0) {
              balance = derived;
              // Reconcile (fire-and-forget)
              supabase
                .from('profiles')
                .update({ balance: derived, updated_at: new Date().toISOString() })
                .eq('id', userId)
                .then(() =>
                  console.log('[wallet] Reconciled stale profile balance', userId, derived)
                )
                .catch((err: unknown) =>
                  console.warn('[wallet] Failed to reconcile cached balance', userId, err)
                );
            }
          }
        }

        const typedProfile = profile as (Profile & {
          payout_failed_at?: string | null;
          payout_failure_code?: string | null;
        }) | null;

        return jsonResponse({
          balance,
          currency: 'USD',
          payoutFailedAt: typedProfile?.payout_failed_at ?? null,
          payoutFailureCode: typedProfile?.payout_failure_code ?? null,
        });
      }

      // GET /wallet/transactions
      if (subPath === '/transactions') {
        const limitParam = parseInt(url.searchParams.get('limit') ?? '50', 10);
        const limit = Math.min(Number.isNaN(limitParam) ? 50 : limitParam, 100);
        const offsetParam = parseInt(url.searchParams.get('offset') ?? '0', 10);
        const offset = Math.max(Number.isNaN(offsetParam) ? 0 : offsetParam, 0);

        const { data: transactions, error } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) {
          console.error('[wallet] Error fetching transactions:', error);
          return jsonResponse({ error: 'Failed to fetch transactions' }, 500);
        }

        const formattedTransactions = (transactions ?? []).map((tx: WalletTransaction) => ({
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          date: tx.created_at,
          details: {
            title: tx.description,
            method: tx.stripe_payment_intent_id ? 'Stripe' : 'Wallet',
            status: tx.status ?? 'completed',
            bounty_id: tx.bounty_id,
          },
        }));

        return jsonResponse({ transactions: formattedTransactions });
      }

      // POST /wallet/escrow — hold funds when a bounty is posted.
      // Mirrors the Fastify-only route that was previously unreachable from the
      // mobile client in production once EXPO_PUBLIC_SUPABASE_URL is configured
      // (API_BASE_URL resolves to the Edge Functions URL, not the Fastify server).
      if (req.method === 'POST' && subPath === '/escrow') {
        let body: {
          bountyId?: unknown;
          amount?: unknown;
          title?: unknown;
          idempotencyKey?: unknown;
        };
        try {
          body = await req.json();
        } catch {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }

        const bountyId = typeof body.bountyId === 'string' ? body.bountyId.trim() : '';
        const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
        const title = typeof body.title === 'string' ? body.title.trim() : undefined;
        const idempotencyKey =
          typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;

        if (!bountyId) return jsonResponse({ error: 'bountyId is required' }, 400);
        if (!Number.isFinite(amount) || amount <= 0)
          return jsonResponse({ error: 'Invalid amount' }, 400);

        const effectiveKey = idempotencyKey || `escrow_${bountyId}_${userId}`;
        const description = title ? `Escrow for bounty: ${title}` : `Escrow for bounty ${bountyId}`;

        // apply_escrow is a SECURITY DEFINER RPC that atomically:
        //   1. Returns applied=false if a completed escrow already exists (idempotent).
        //   2. Deducts the balance via update_balance() — raises on insufficient funds,
        //      rolling back the whole transaction.
        //   3. Inserts the escrow wallet_transactions row.
        // This replaces four separate non-atomic operations that were vulnerable to a
        // race condition where concurrent requests for the same bounty could both pass
        // the existence check and each create an escrow row + deduct the balance.
        const { data: escrowResult, error: escrowErr } = await supabase
          .rpc('apply_escrow', {
            p_user_id: userId,
            p_bounty_id: bountyId,
            p_amount: amount,
            p_description: description,
            p_metadata: {
              bounty_id: bountyId,
              escrowed_at: new Date().toISOString(),
              idempotency_key: effectiveKey,
            },
          })
          .single();

        if (escrowErr) {
          const errMsg: string = (escrowErr as { message?: string }).message ?? '';
          // SQLSTATE 23514 is raised by update_balance() when balance would go negative.
          if (escrowErr.code === '23514' || errMsg.toLowerCase().includes('insufficient')) {
            return jsonResponse({ error: 'Insufficient balance' }, 400);
          }
          console.error('[wallet] apply_escrow RPC error:', escrowErr);
          return jsonResponse({ error: 'Failed to create escrow transaction' }, 500);
        }

        const { applied, transaction_id, new_balance } = escrowResult as {
          applied: boolean;
          transaction_id: string;
          new_balance: number | null;
        };

        if (!applied) {
          return jsonResponse(
            { error: 'Escrow already exists for this bounty', code: 'duplicate_transaction' },
            409
          );
        }

        return jsonResponse({
          success: true,
          transactionId: transaction_id,
          amount,
          newBalance: new_balance,
          message: `$${amount.toFixed(2)} held in escrow for bounty.`,
        });
      }

      // POST /wallet/refund — return escrowed funds to a poster on cancellation.
      // Also previously Fastify-only and unreachable in production with Supabase.
      if (req.method === 'POST' && subPath === '/refund') {
        let body: {
          bountyId?: unknown;
          reason?: unknown;
          idempotencyKey?: unknown;
          refundPercentage?: unknown;
        };
        try {
          body = await req.json();
        } catch {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }

        const bountyId = typeof body.bountyId === 'string' ? body.bountyId.trim() : '';
        const reason =
          typeof body.reason === 'string' && body.reason.trim()
            ? body.reason.trim()
            : 'Bounty cancelled';
        const idempotencyKey =
          typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;
        // Clamp to (0, 100]; default to 100 (full refund) when not provided.
        const rawRefundPct =
          typeof body.refundPercentage === 'number' ? body.refundPercentage : 100;
        const refundPercentage = Math.min(100, Math.max(0, rawRefundPct));

        if (!bountyId) return jsonResponse({ error: 'bountyId is required' }, 400);

        // Verify the caller is the bounty owner (user_id is the canonical owner column)
        const { data: bountyRow, error: bountyErr } = await supabase
          .from('bounties')
          .select('user_id')
          .eq('id', bountyId)
          .single();
        if (bountyErr || !bountyRow) return jsonResponse({ error: 'Bounty not found' }, 404);
        if ((bountyRow as { user_id: string }).user_id !== userId) {
          return jsonResponse({ error: 'Unauthorized to refund funds' }, 403);
        }

        // Prevent double-refund / double-release.
        // Also block on 'pending' records: if a prior attempt credited the user's balance
        // but failed to promote the transaction to 'completed', the pending row must be
        // treated as a completed settlement to prevent a retry from double-crediting.
        const { data: existingSettlement } = await supabase
          .from('wallet_transactions')
          .select('id, type, status')
          .eq('bounty_id', bountyId)
          .in('type', ['release', 'refund'])
          .in('status', ['completed', 'pending'])
          .maybeSingle();
        if (existingSettlement) {
          const verb = (existingSettlement as any).type === 'release' ? 'released' : 'refunded';
          const isPending = (existingSettlement as any).status === 'pending';
          return jsonResponse(
            {
              error: isPending
                ? `A ${verb} transaction for this bounty is already pending`
                : `Escrow already ${verb} for this bounty`,
              code: 'duplicate_transaction',
            },
            409
          );
        }

        // Locate the escrow transaction to determine the amount to return
        const { data: escrowTx, error: escrowErr } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('bounty_id', bountyId)
          .eq('type', 'escrow')
          .eq('status', 'completed')
          .single();
        if (escrowErr || !escrowTx)
          return jsonResponse({ error: 'Escrow transaction not found' }, 404);

        const escrowAmount = Math.abs((escrowTx as WalletTransaction).amount);
        const refundAmount = Math.round(((escrowAmount * refundPercentage) / 100) * 100) / 100;
        const effectiveKey = idempotencyKey || `refund_${bountyId}_${userId}`;

        // Insert refund transaction as 'pending' first; promote to 'completed' only after
        // the balance update succeeds. This prevents an orphaned 'completed' record from
        // permanently blocking future refund attempts if the balance update fails.
        const { data: refundTxRow, error: refundTxErr } = await supabase
          .from('wallet_transactions')
          .insert([
            {
              user_id: userId,
              bounty_id: bountyId,
              type: 'refund',
              amount: refundAmount,
              description: `Refund for bounty ${bountyId}: ${reason}`,
              status: 'pending',
              metadata: {
                bounty_id: bountyId,
                escrow_transaction_id: (escrowTx as WalletTransaction).id,
                reason,
                refund_percentage: refundPercentage,
                original_escrow_amount: escrowAmount,
                refunded_at: new Date().toISOString(),
                idempotency_key: effectiveKey,
              },
            },
          ])
          .select()
          .single();
        if (refundTxErr) {
          console.error('[wallet] create refund tx error:', refundTxErr);
          return jsonResponse({ error: 'Failed to create refund transaction' }, 500);
        }

        // Credit balance
        const { data: profileData2, error: profileFetchErr2 } = await supabase
          .from('profiles')
          .select('balance')
          .eq('id', userId)
          .single();
        if (profileFetchErr2 || !profileData2) {
          console.error('[wallet] fetch balance error before refund credit:', profileFetchErr2);
          const { error: rollbackErr1 } = await supabase
            .from('wallet_transactions')
            .delete()
            .eq('id', (refundTxRow as WalletTransaction).id);
          if (rollbackErr1) {
            console.error(
              '[wallet] CRITICAL: failed to roll back pending refund tx after balance fetch error; tx id:',
              (refundTxRow as WalletTransaction).id,
              rollbackErr1
            );
          }
          return jsonResponse({ error: 'Failed to fetch balance for refund' }, 500);
        }
        const currentBalance2: number = (profileData2 as Profile | null)?.balance ?? 0;
        const { error: balanceErr2 } = await supabase
          .from('profiles')
          .update({ balance: currentBalance2 + refundAmount })
          .eq('id', userId);
        if (balanceErr2) {
          console.error(
            '[wallet] balance credit error after refund, rolling back tx:',
            balanceErr2
          );
          const { error: rollbackErr2 } = await supabase
            .from('wallet_transactions')
            .delete()
            .eq('id', (refundTxRow as WalletTransaction).id);
          if (rollbackErr2) {
            console.error(
              '[wallet] CRITICAL: failed to roll back pending refund tx after balance update error; tx id:',
              (refundTxRow as WalletTransaction).id,
              rollbackErr2
            );
          }
          return jsonResponse({ error: 'Failed to update balance' }, 500);
        }

      const profileRow = profile as Profile | null
      return jsonResponse({
        balance,
        currency: 'USD',
        payoutFailedAt: profileRow?.payout_failed_at ?? null,
        payoutFailureCode: profileRow?.payout_failure_code ?? null,
      })
    }
        // Balance updated — promote the transaction to 'completed' atomically
        const { error: confirmErr } = await supabase
          .from('wallet_transactions')
          .update({ status: 'completed' })
          .eq('id', (refundTxRow as WalletTransaction).id);
        if (confirmErr) {
          // Balance was credited but the status promotion failed. Log for manual reconciliation;
          // do not return an error to the caller since the funds have already moved.
          console.error(
            '[wallet] CRITICAL: balance credited but failed to mark refund tx completed; tx id:',
            (refundTxRow as WalletTransaction).id,
            confirmErr
          );
        }

        return jsonResponse({
          success: true,
          transactionId: (refundTxRow as WalletTransaction).id,
          amount: refundAmount,
          message: `Refund of $${refundAmount.toFixed(2)} processed.`,
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('[wallet edge fn] Error:', err);
      return jsonResponse({ error: err.message ?? 'Internal server error' }, 500);
    }
  } catch (outerError: unknown) {
    const err = outerError as { message?: string };
    console.error('[wallet edge fn] Outer unhandled error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
