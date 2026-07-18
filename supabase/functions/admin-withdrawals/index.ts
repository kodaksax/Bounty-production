// Supabase Edge Function: admin-withdrawals
// Admin-only withdrawal recovery tool. Closes a real operational gap: prior
// to this function, there was no admin/support-side way to retry a
// `permanently_failed` withdrawal or correct a balance after a CRITICAL/
// orphaned-reconciliation finding — every such case required a human running
// SQL directly against production with service_role credentials (see
// docs/payments/BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md §4.8 item 5, §9.4).
//
// Must be called with an Authorization: Bearer <JWT> belonging to an admin
// user (checked via app_metadata.role/roles, same pattern as
// supabase/functions/admin-review-id/index.ts). Every action is written to
// admin_action_log (service_role-only table, see the accompanying migration)
// regardless of success or failure, so there is always a durable record of
// who did what, to whom, for how much, and why.
//
// POST body: { action: 'force_retry' | 'manual_adjustment' | 'list_log', ... }
//   force_retry:       { transactionId, reason, bankAccountId? }
//   manual_adjustment: { userId, amount, reason, relatedTransactionId? }
//   list_log:          { userId?, limit? }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';
import type { Profile, WalletTransaction } from '../_shared/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
  console.error(`CRITICAL [admin-withdrawals] ${event}`, JSON.stringify({ event, ts: new Date().toISOString(), ...context }));
}

// ─── Inlined from ../connect/withdrawal-validation.ts ───────────────────────
// (local imports are not supported by the Supabase bundler — keep in sync
// with the copies in supabase/functions/connect/index.ts and
// supabase/functions/connect/withdrawal-validation.ts, the unit-tested
// source of truth)

const MAX_TRANSFER_RETRIES = 3;
const MAX_ADJUSTMENT_USD = 10000; // sanity cap on a single manual adjustment; mirrors WITHDRAW_MAX_USD

function mapStripeTransferError(err: {
  code?: string;
  type?: string;
  message?: string;
}): { error: string; code: string; status: number } {
  const code = err?.code ?? '';
  const type = err?.type ?? '';

  if (code === 'balance_insufficient') {
    return {
      error: 'Transfers are temporarily unavailable at the platform level. Please try again later.',
      code: 'platform_balance_insufficient',
      status: 503,
    };
  }
  if (code === 'account_invalid' || code === 'transfers_not_allowed') {
    return {
      error: 'The destination bank account cannot receive transfers right now.',
      code: 'destination_account_invalid',
      status: 400,
    };
  }
  if (type === 'StripeConnectionError' || type === 'api_connection_error') {
    return {
      error: 'Could not reach Stripe. No balance was charged — try again.',
      code: 'stripe_unreachable',
      status: 503,
    };
  }
  return {
    error: 'The transfer could not be completed.',
    code: 'transfer_failed',
    status: 502,
  };
}

interface ExternalAccountSummary {
  id: string;
  default_for_currency?: boolean | null;
  bank_name?: string | null;
  last4?: string | null;
}

type DestinationResolution =
  | { ok: true; targetAccount: ExternalAccountSummary; needsDefaultUpdate: boolean }
  | { ok: false; error: string; code: string };

function resolveWithdrawalDestination(
  accounts: ExternalAccountSummary[],
  requestedBankAccountId: string | undefined
): DestinationResolution {
  if (accounts.length === 0) {
    return {
      ok: false,
      error: 'No bank account is linked to this payout account.',
      code: 'no_bank_account',
    };
  }
  if (requestedBankAccountId) {
    const requested = accounts.find(a => a.id === requestedBankAccountId);
    if (!requested) {
      return { ok: false, error: 'Requested bank account not found.', code: 'bank_account_not_found' };
    }
    return { ok: true, targetAccount: requested, needsDefaultUpdate: !requested.default_for_currency };
  }
  const current = accounts.find(a => a.default_for_currency) ?? accounts[0];
  return { ok: true, targetAccount: current, needsDefaultUpdate: false };
}
// ─── End inlined withdrawal-validation helpers ──────────────────────────────

async function logAdminAction(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  entry: {
    adminUserId: string;
    actionType: 'force_retry_withdrawal' | 'manual_balance_adjustment';
    targetUserId: string;
    targetTransactionId?: string | null;
    amount?: number | null;
    reason: string;
    result: 'success' | 'failure';
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await supabase.from('admin_action_log').insert({
    admin_user_id: entry.adminUserId,
    action_type: entry.actionType,
    target_user_id: entry.targetUserId,
    target_transaction_id: entry.targetTransactionId ?? null,
    amount: entry.amount ?? null,
    reason: entry.reason,
    result: entry.result,
    metadata: entry.metadata ?? null,
  });
  if (error) {
    // The underlying action (money movement) has already happened at this
    // point — a failed audit-log write must not silently disappear.
    logCritical('failed to write admin_action_log entry', { entry, error });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Authenticate caller and verify admin role — identical to admin-review-id.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401);
  }
  const token = authHeader.substring(7);
  const {
    data: { user: adminUser },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !adminUser) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }
  const roles = adminUser.app_metadata?.roles;
  const hasAdminRole = Array.isArray(roles)
    ? roles.includes('admin')
    : typeof roles === 'string'
      ? roles === 'admin'
      : false;
  const isAdmin = adminUser.app_metadata?.role === 'admin' || hasAdminRole;
  if (!isAdmin) {
    return jsonResponse({ error: 'Forbidden: admin access required' }, 403);
  }

  let body: {
    action?: string;
    transactionId?: string;
    userId?: string;
    amount?: number;
    reason?: string;
    bankAccountId?: string;
    relatedTransactionId?: string;
    limit?: number;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { action } = body;

  // ─── list_log ───────────────────────────────────────────────────────────
  if (action === 'list_log') {
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    let query = supabase
      .from('admin_action_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (body.userId) {
      query = query.eq('target_user_id', body.userId);
    }
    const { data, error } = await query;
    if (error) {
      console.error('[admin-withdrawals] Failed to list admin_action_log', { error });
      return jsonResponse({ error: 'Failed to list log' }, 500);
    }
    return jsonResponse({ entries: data });
  }

  // ─── force_retry ────────────────────────────────────────────────────────
  if (action === 'force_retry') {
    const { transactionId, reason } = body;
    const requestedBankAccountId =
      typeof body.bankAccountId === 'string' && body.bankAccountId.trim()
        ? body.bankAccountId.trim()
        : undefined;

    if (!transactionId) {
      return jsonResponse({ error: 'transactionId is required' }, 400);
    }
    if (!reason || !reason.trim()) {
      return jsonResponse({ error: 'reason is required' }, 400);
    }

    // Unlike the self-service /connect/retry-transfer route, this is not
    // scoped to a specific caller's user_id (an admin is acting on behalf of
    // whichever hunter owns the transaction) and there is no retry_count>=3
    // gate — bypassing that cap is the entire point of this endpoint.
    const { data: tx, error: txError } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('id', transactionId)
      .eq('status', 'failed')
      .single();

    if (txError || !tx) {
      return jsonResponse({ error: 'Failed transaction not found' }, 404);
    }

    const t = tx as WalletTransaction;
    const targetUserId = t.user_id;
    const retryCount = ((t.metadata as Record<string, unknown> | null)?.retry_count as number) ?? 0;

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_connect_account_id, balance, balance_on_hold')
      .eq('id', targetUserId)
      .single();

    const p = profile as Profile | null;
    if (!p?.stripe_connect_account_id) {
      await logAdminAction(supabase, {
        adminUserId: adminUser.id,
        actionType: 'force_retry_withdrawal',
        targetUserId,
        targetTransactionId: transactionId,
        reason,
        result: 'failure',
        metadata: { error: 'no_stripe_connect_account' },
      });
      return jsonResponse({ error: 'Stripe Connect account not found for this user' }, 400);
    }

    const amount = Math.abs(t.amount);

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      return jsonResponse({ error: 'Stripe not configured' }, 500);
    }
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const originalDestinationId = (t.metadata as Record<string, unknown> | null)
      ?.destination_bank_account_id;
    const effectiveRequestedBankAccountId =
      requestedBankAccountId ??
      (typeof originalDestinationId === 'string' ? originalDestinationId : undefined);

    let destinationAccount: ExternalAccountSummary;
    try {
      const externalAccounts = await stripe.accounts.listExternalAccounts(
        p.stripe_connect_account_id,
        { object: 'bank_account', limit: 100 }
      );
      const summaries: ExternalAccountSummary[] = externalAccounts.data.map(ba => ({
        id: ba.id,
        default_for_currency: (ba as unknown as { default_for_currency?: boolean })
          .default_for_currency,
        bank_name: (ba as unknown as { bank_name?: string }).bank_name ?? null,
        last4: (ba as unknown as { last4?: string }).last4 ?? null,
      }));

      const destination = resolveWithdrawalDestination(summaries, effectiveRequestedBankAccountId);
      if (!destination.ok) {
        await logAdminAction(supabase, {
          adminUserId: adminUser.id,
          actionType: 'force_retry_withdrawal',
          targetUserId,
          targetTransactionId: transactionId,
          reason,
          result: 'failure',
          metadata: { error: destination.code },
        });
        return jsonResponse({ error: destination.error, code: destination.code }, 400);
      }
      destinationAccount = destination.targetAccount;

      if (destination.needsDefaultUpdate) {
        const updated = (await stripe.accounts.updateExternalAccount(
          p.stripe_connect_account_id,
          destinationAccount.id,
          { default_for_currency: true } as Stripe.ExternalAccountUpdateParams
        )) as Stripe.BankAccount;
        if (!(updated as unknown as { default_for_currency?: boolean }).default_for_currency) {
          logCritical('default_for_currency update did not take effect during admin retry', {
            targetUserId, accountId: p.stripe_connect_account_id,
          });
          return jsonResponse(
            { error: 'Could not confirm the payout destination — aborted before charging balance.' },
            502
          );
        }
      }
    } catch (bankAccountError) {
      console.error('[admin-withdrawals] failed to resolve destination bank account', {
        targetUserId,
        error: (bankAccountError as { message?: string })?.message,
      });
      return jsonResponse({ error: 'Could not resolve the payout destination.' }, 503);
    }

    const available = (p.balance ?? 0) - (p.balance_on_hold ?? 0);
    if (available < amount) {
      await logAdminAction(supabase, {
        adminUserId: adminUser.id,
        actionType: 'force_retry_withdrawal',
        targetUserId,
        targetTransactionId: transactionId,
        amount,
        reason,
        result: 'failure',
        metadata: { error: 'insufficient_balance' },
      });
      return jsonResponse({ error: 'Insufficient balance for retry' }, 400);
    }

    const { error: rpcError } = await supabase.rpc('withdraw_balance', {
      p_user_id: targetUserId,
      p_amount: amount,
    });
    if (rpcError) {
      await logAdminAction(supabase, {
        adminUserId: adminUser.id,
        actionType: 'force_retry_withdrawal',
        targetUserId,
        targetTransactionId: transactionId,
        amount,
        reason,
        result: 'failure',
        metadata: { error: 'withdraw_balance_failed', detail: rpcError.message },
      });
      return jsonResponse({ error: 'Failed to reserve balance for retry' }, 500);
    }

    let transfer: Stripe.Transfer;
    try {
      transfer = await stripe.transfers.create(
        {
          amount: Math.round(amount * 100),
          currency: 'usd',
          destination: p.stripe_connect_account_id,
          metadata: {
            user_id: targetUserId,
            retry_of_transaction: transactionId,
            admin_retry: 'true',
            admin_user_id: adminUser.id,
          },
        },
        { idempotencyKey: `admin_retry_${transactionId}_${retryCount + 1}` }
      );
    } catch (stripeError) {
      const { error: retryRefundError } = await supabase.rpc('update_balance', {
        p_user_id: targetUserId,
        p_amount: amount,
      });
      if (retryRefundError) {
        logCritical('balance refund after failed admin retry transfer also failed — manual reconciliation required', {
          targetUserId, amount, error: retryRefundError,
        });
      }
      const mapped = mapStripeTransferError(
        stripeError as { code?: string; type?: string; message?: string }
      );
      await logAdminAction(supabase, {
        adminUserId: adminUser.id,
        actionType: 'force_retry_withdrawal',
        targetUserId,
        targetTransactionId: transactionId,
        amount,
        reason,
        result: 'failure',
        metadata: { error: mapped.code, refunded: !retryRefundError },
      });
      return jsonResponse({ error: mapped.error, code: mapped.code }, mapped.status);
    }

    await supabase
      .from('wallet_transactions')
      .update({
        stripe_transfer_id: transfer.id,
        status: 'completed',
        metadata: {
          ...t.metadata,
          retry_count: retryCount + 1,
          retried_at: new Date().toISOString(),
          retried_by_admin: adminUser.id,
          destination_bank_account_id: destinationAccount.id,
          destination_bank_last4: destinationAccount.last4 ?? null,
          destination_bank_name: destinationAccount.bank_name ?? null,
        },
      })
      .eq('id', transactionId);

    await logAdminAction(supabase, {
      adminUserId: adminUser.id,
      actionType: 'force_retry_withdrawal',
      targetUserId,
      targetTransactionId: transactionId,
      amount,
      reason,
      result: 'success',
      metadata: { transferId: transfer.id, retryCount: retryCount + 1 },
    });

    console.log(
      `[admin-withdrawals] Admin ${adminUser.id} force-retried transaction ${transactionId}: transfer ${transfer.id}`
    );

    return jsonResponse({ success: true, transferId: transfer.id, transactionId });
  }

  // ─── manual_adjustment ──────────────────────────────────────────────────
  if (action === 'manual_adjustment') {
    const { userId, reason, relatedTransactionId } = body;
    const amount = Number(body.amount);

    if (!userId) {
      return jsonResponse({ error: 'userId is required' }, 400);
    }
    if (!reason || !reason.trim()) {
      return jsonResponse({ error: 'reason is required' }, 400);
    }
    if (!Number.isFinite(amount) || amount === 0) {
      return jsonResponse({ error: 'amount must be a non-zero finite number' }, 400);
    }
    if (Math.abs(amount) > MAX_ADJUSTMENT_USD) {
      return jsonResponse(
        { error: `A single adjustment cannot exceed $${MAX_ADJUSTMENT_USD.toLocaleString('en-US')}.` },
        400
      );
    }
    const amountCents = Math.round(amount * 100);
    if (Math.abs(amount * 100 - amountCents) > 1e-6) {
      return jsonResponse({ error: 'amount cannot include fractions of a cent' }, 400);
    }

    const { data: newBalance, error: rpcError } = await supabase.rpc('update_balance', {
      p_user_id: userId,
      p_amount: amount,
    });

    if (rpcError) {
      await logAdminAction(supabase, {
        adminUserId: adminUser.id,
        actionType: 'manual_balance_adjustment',
        targetUserId: userId,
        targetTransactionId: relatedTransactionId ?? null,
        amount,
        reason,
        result: 'failure',
        metadata: { error: rpcError.message },
      });
      return jsonResponse({ error: rpcError.message || 'Balance adjustment failed' }, 400);
    }

    // Record a real ledger row (type='admin_adjustment') so the amount is
    // visible in wallet_transactions history and reconciliation, not just an
    // opaque profiles.balance change — see the accompanying migration.
    const { error: txInsertError } = await supabase.from('wallet_transactions').insert({
      user_id: userId,
      type: 'admin_adjustment',
      amount,
      status: 'completed',
      description: `Manual admin adjustment: ${reason}`,
      metadata: {
        admin_user_id: adminUser.id,
        reason,
        related_transaction_id: relatedTransactionId ?? null,
      },
    });
    if (txInsertError) {
      logCritical('balance adjusted but wallet_transactions insert failed — manual backfill required', {
        userId, amount, error: txInsertError,
      });
    }

    await logAdminAction(supabase, {
      adminUserId: adminUser.id,
      actionType: 'manual_balance_adjustment',
      targetUserId: userId,
      targetTransactionId: relatedTransactionId ?? null,
      amount,
      reason,
      result: 'success',
      metadata: { newBalance, ledgerRowRecorded: !txInsertError },
    });

    console.log(
      `[admin-withdrawals] Admin ${adminUser.id} adjusted balance for user ${userId} by $${amount}: ${reason}`
    );

    return jsonResponse({ success: true, newBalance });
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
});
