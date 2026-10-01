/**
 * Escrow-commitment gate for owner-initiated refunds.
 *
 * Used by POST /wallet/refund (v1 wallet escrow) and POST /bounty-payments/cancel
 * (v2/v3 Stripe escrow) before any money moves back to the poster.
 *
 * The rule itself lives in the database (`fn_owner_refund_block_reason`,
 * migration 20261001120100) so both endpoints, and the staging RLS suite, share
 * one definition:
 *   - no hunter was ever accepted                      -> allowed
 *   - the accepted hunter filed a cancellation that is
 *     pending or accepted                              -> allowed
 *   - anything else, and always while a dispute is open -> blocked (409)
 *
 * Before this gate the owner could refund 100% of the escrow at any time:
 * after acceptance, after the hunter submitted work, or mid-dispute
 * (trust-spine audit 2026-09-30, T4 / S2).
 *
 * Fails closed: if the gate cannot be evaluated (RPC missing because the
 * migration has not been applied, or a database error), the refund is refused
 * with a retryable 503 rather than silently falling back to the old,
 * ungated behaviour.
 */

export interface OwnerRefundGateClient {
  rpc(
    fn: 'fn_owner_refund_block_reason',
    args: { p_bounty_id: string; p_caller: string }
  ): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

export type OwnerRefundGateResult =
  | { ok: true }
  | { ok: false; status: number; error: string; code: string; retryable: boolean };

const BLOCK_MESSAGES: Record<string, { status: number; error: string }> = {
  refund_requires_cancellation_or_dispute: {
    status: 409,
    error:
      'A hunter has been accepted on this bounty, so the escrow is committed to them. ' +
      "It can only be returned through the hunter's cancellation request or a dispute.",
  },
  refund_blocked_by_open_dispute: {
    status: 409,
    error: 'This bounty has an open dispute. Bounty support will settle the escrow.',
  },
  not_bounty_owner: { status: 403, error: 'Unauthorized to refund funds' },
  bounty_not_found: { status: 404, error: 'Bounty not found' },
};

export async function checkOwnerRefundGate(
  client: OwnerRefundGateClient,
  bountyId: string,
  callerId: string
): Promise<OwnerRefundGateResult> {
  let data: unknown;
  let error: { message?: string; code?: string } | null;
  try {
    ({ data, error } = await client.rpc('fn_owner_refund_block_reason', {
      p_bounty_id: bountyId,
      p_caller: callerId,
    }));
  } catch (err) {
    error = { message: err instanceof Error ? err.message : String(err) };
  }

  if (error) {
    console.error('[owner-refund-gate] gate unavailable; refusing refund', {
      bountyId,
      error,
    });
    return {
      ok: false,
      status: 503,
      error: 'Refunds are temporarily unavailable. Please try again shortly.',
      code: 'refund_gate_unavailable',
      retryable: true,
    };
  }

  // NULL means allowed. PostgREST returns a scalar function's value directly.
  const reason = Array.isArray(data) ? data[0] : data;
  if (reason === null || reason === undefined) {
    return { ok: true };
  }

  const code = String(reason);
  const known = BLOCK_MESSAGES[code] ?? {
    status: 409,
    error: 'This bounty cannot be refunded in its current state.',
  };
  return { ok: false, status: known.status, error: known.error, code, retryable: false };
}
