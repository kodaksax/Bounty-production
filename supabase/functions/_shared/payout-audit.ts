import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Lifecycle events written to public.payout_audit_log.
 *
 * Shared by `connect`, `webhooks` and `admin-withdrawals` — every Edge
 * Function that can decide, advance or resolve a withdrawal. Originally this
 * lived only in `connect/index.ts` and was wired exclusively into the
 * Connect-native payout path (`handleConnectNativePayout`, gated behind
 * `CONNECT_NATIVE_PAYOUTS`). That flag has never been fully enabled in
 * production, so the legacy `/transfer`, `/retry-transfer` and
 * `/instant-payout` routes — the ones actually processing every real
 * withdrawal — never called it, and the completion/failure webhooks and the
 * `mark_externally_settled` admin action never called it either. The table
 * existed; almost nothing wrote to it. This module is now imported by all
 * three functions so the audit trail actually covers the code that runs.
 */
export type PayoutAuditEvent =
  | 'withdrawal_requested'
  | 'withdrawal_validated'
  | 'stripe_payout_created'
  // An instant payout Stripe refused. Recorded separately from
  // withdrawal_failed because the withdrawal itself has NOT failed — it falls
  // back to a standard payout and stays pending. Conflating the two is the
  // reasoning that produced the 2026-08-13 incident.
  | 'instant_payout_failed'
  | 'withdrawal_completed'
  | 'withdrawal_failed';

export interface PayoutAuditEntry {
  userId: string;
  event: PayoutAuditEvent;
  payoutMethod?: 'instant' | 'standard' | null;
  amountCents?: number | null;
  currency?: string;
  balanceAvailableCents?: number;
  balanceInstantAvailableCents?: number;
  stripePayoutId?: string | null;
  stripeConnectAccountId?: string | null;
  idempotencyKey?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Best-effort audit write. Deliberately never throws and never blocks the
 * payout: losing an audit row is bad, but failing a payout that Stripe already
 * accepted because we could not write a log line would be worse. Failures are
 * logged loudly so they surface in monitoring.
 */
export async function writePayoutAudit(
  supabase: SupabaseClient,
  entry: PayoutAuditEntry
): Promise<void> {
  try {
    const { error } = await supabase.from('payout_audit_log').insert({
      user_id: entry.userId,
      event: entry.event,
      payout_method: entry.payoutMethod ?? null,
      amount_cents: entry.amountCents ?? null,
      currency: entry.currency ?? 'usd',
      balance_available_cents: entry.balanceAvailableCents ?? null,
      balance_instant_available_cents: entry.balanceInstantAvailableCents ?? null,
      stripe_payout_id: entry.stripePayoutId ?? null,
      stripe_connect_account_id: entry.stripeConnectAccountId ?? null,
      idempotency_key: entry.idempotencyKey ?? null,
      error_code: entry.errorCode ?? null,
      error_message: entry.errorMessage ?? null,
      detail: entry.detail ?? null,
    });
    if (error) {
      console.error('[payout-audit] failed to write audit row', {
        userId: entry.userId,
        event: entry.event,
        error: error.message,
      });
    }
  } catch (auditError) {
    console.error('[payout-audit] threw while writing audit row', {
      userId: entry.userId,
      event: entry.event,
      error: (auditError as { message?: string })?.message,
    });
  }
}
