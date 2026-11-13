/**
 * Decision for POST /bounty-payments/admin-settle: which Stripe step, if any,
 * an admin may run for a bounty payment.
 *
 * admin_set_bounty_status() records an admin's disposition for a captured
 * payment on bounty_payments.metadata.admin_disposition (see
 * 20261110120000_cancelled_bounty_money_reconciliation.sql). This route only
 * EXECUTES that recorded decision. It takes nothing but a bountyId: who is
 * paid and how much always come from the row the database wrote under its own
 * checks, never from the request. A pure function, so the rules are unit
 * testable without Stripe or a database.
 */

export type AdminDisposition = 'refund_poster' | 'keep_as_platform_revenue' | 'pay_out_to_hunter';

export interface AdminSettlementPaymentRow {
  id: string;
  bounty_id: string;
  poster_id: string;
  hunter_id?: string | null;
  status: string;
  amount: number | string;
  stripe_payment_intent_id?: string | null;
  stripe_refund_id?: string | null;
  stripe_transfer_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type AdminSettlementPlan =
  | { ok: true; action: 'refund'; paymentId: string; paymentIntentId: string; amount: number }
  | { ok: true; action: 'transfer'; paymentId: string; hunterId: string; amount: number }
  | { ok: false; status: number; code: string; error: string };

const refuse = (status: number, code: string, error: string): AdminSettlementPlan => ({
  ok: false,
  status,
  code,
  error,
});

export function readAdminDisposition(
  metadata: Record<string, unknown> | null | undefined
): { disposition: AdminDisposition; hunterId: string | null; source: string | null } | null {
  const raw = metadata?.admin_disposition as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const disposition = raw.disposition;
  if (
    disposition !== 'refund_poster' &&
    disposition !== 'keep_as_platform_revenue' &&
    disposition !== 'pay_out_to_hunter'
  ) {
    return null;
  }
  return {
    disposition,
    hunterId: typeof raw.hunter_id === 'string' ? raw.hunter_id : null,
    source: typeof raw.source === 'string' ? raw.source : null,
  };
}

export function planAdminSettlement(params: {
  callerId: string;
  callerIsAdmin: boolean;
  payment: AdminSettlementPaymentRow | null;
}): AdminSettlementPlan {
  const { callerId, callerIsAdmin, payment } = params;
  if (!callerIsAdmin) return refuse(403, 'not_admin', 'Admin role required.');
  if (!payment) return refuse(404, 'payment_not_found', 'This bounty has no Stripe payment.');

  const disp = readAdminDisposition(payment.metadata);
  if (!disp) {
    return refuse(
      409,
      'no_disposition',
      'No admin disposition is recorded for this payment. Choose one when changing the bounty status first.'
    );
  }
  const amount = Number(payment.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return refuse(409, 'invalid_amount', 'The payment amount is not positive.');
  }

  if (disp.disposition === 'keep_as_platform_revenue') {
    return refuse(409, 'nothing_to_execute', 'Kept as platform revenue: already settled, no Stripe step.');
  }

  if (disp.disposition === 'refund_poster') {
    if (payment.status === 'refunded' || payment.stripe_refund_id) {
      return refuse(409, 'already_refunded', 'This payment is already refunded.');
    }
    if (payment.status !== 'refund_pending') {
      return refuse(409, 'invalid_status', `Cannot refund a payment in status "${payment.status}".`);
    }
    if (payment.stripe_transfer_id) {
      return refuse(409, 'already_transferred', 'Money was already transferred to a hunter.');
    }
    if (!payment.stripe_payment_intent_id) {
      return refuse(409, 'no_payment_intent', 'Missing payment intent; cannot refund.');
    }
    return {
      ok: true,
      action: 'refund',
      paymentId: payment.id,
      paymentIntentId: payment.stripe_payment_intent_id,
      amount,
    };
  }

  // pay_out_to_hunter
  if (payment.stripe_transfer_id) {
    return refuse(409, 'already_transferred', 'A transfer already exists for this payment.');
  }
  if (payment.stripe_refund_id) {
    return refuse(409, 'already_refunded', 'This payment was refunded.');
  }
  if (payment.status !== 'captured') {
    return refuse(409, 'invalid_status', `Cannot pay out a payment in status "${payment.status}".`);
  }
  const hunterId = disp.hunterId;
  // Both places the database recorded the payee must agree.
  if (!hunterId || payment.hunter_id !== hunterId) {
    return refuse(409, 'hunter_mismatch', 'The recorded payee does not match the payment row.');
  }
  if (hunterId === payment.poster_id) {
    return refuse(409, 'payee_is_poster', 'The poster cannot be paid out their own bounty.');
  }
  // Same rule as the RPC: an admin doesn't pay themselves. A reviewed ops
  // script (scripts/ops, merged by PR) is the only way to record that, and
  // it marks the disposition source 'ops_script'.
  if (hunterId === callerId && disp.source !== 'ops_script') {
    return refuse(403, 'self_payout', 'An admin cannot pay out to their own account.');
  }
  return { ok: true, action: 'transfer', paymentId: payment.id, hunterId, amount };
}
