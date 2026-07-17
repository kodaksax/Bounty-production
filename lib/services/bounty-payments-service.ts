/**
 * Bounty Payments Service (Phase 2 — Stripe-native per-bounty escrow)
 *
 * Thin client for the `bounty-payments` edge function. This is the version-2
 * payment path where the poster's card is charged directly via a PaymentIntent
 * (transfer_group = bounty_<id>, automatic capture) and funds are transferred
 * to the hunter's Connect account on release — as opposed to the legacy
 * version-1 custodial-wallet ledger path (createEscrow/releaseEscrow via
 * lib/wallet-context.tsx), which is unchanged.
 *
 * Routing rule (enforced by callers): use these functions only for bounties
 * whose `payment_architecture_version === 2`. Version-1 bounties continue to
 * use the legacy wallet flow. Both coexist during the migration.
 *
 * Additive by design: nothing imports this yet. The funding/release/cancel
 * call sites are cut over to it as a separate, deliberate step.
 */

import { FINANCIAL_API_BASE_URL } from '../config/api';
import { supabase } from '../supabase';
import { logger } from '../utils/error-logger';

export interface CreateBountyPaymentResult {
  bountyPaymentId: string;
  paymentIntentId: string;
  /** Pass to Stripe's client SDK (PaymentSheet / confirmPayment) to charge the card. */
  clientSecret: string;
  status: string;
  amount: number;
  /** True when an existing PaymentIntent was returned instead of creating a new one. */
  reused?: boolean;
}

export interface ReleaseBountyPaymentResult {
  released: boolean;
  transferId: string;
  hunterId?: string;
  amount?: number;
  platformFee?: number;
  hunterAmount?: number;
  status: string;
  reused?: boolean;
}

export interface CancelBountyPaymentResult {
  canceled?: boolean;
  refunded?: boolean;
  refundId?: string | null;
  status: string;
  reused?: boolean;
}

/** Error thrown when the edge function returns a non-2xx response. Carries the
 *  server's machine-readable `code` (e.g. 'hunter_not_onboarded') and message. */
export class BountyPaymentError extends Error {
  code?: string;
  httpStatus: number;
  constructor(message: string, httpStatus: number, code?: string) {
    super(message);
    this.name = 'BountyPaymentError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new BountyPaymentError('Not authenticated. Please sign in again.', 401, 'not_authenticated');
  }
  return token;
}

async function postBountyPayments<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!FINANCIAL_API_BASE_URL) {
    throw new BountyPaymentError('Payments service is not configured.', 500, 'not_configured');
  }
  const token = await getAccessToken();

  let response: Response;
  try {
    response = await fetch(`${FINANCIAL_API_BASE_URL}/bounty-payments${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    logger.error?.('[bountyPayments] network error', { path, networkErr });
    throw new BountyPaymentError('Network error. Please check your connection and try again.', 0, 'network_error');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data && (data.error as string)) || `Request failed (${response.status}).`;
    throw new BountyPaymentError(message, response.status, data?.code);
  }
  return data as T;
}

/**
 * Fund a bounty (poster). Creates (or idempotently reuses) a PaymentIntent for
 * the bounty amount and marks the bounty payment_architecture_version = 2.
 * The caller must confirm the returned `clientSecret` with Stripe's client SDK
 * (PaymentSheet / confirmPayment) to actually charge the poster's card.
 */
export async function createBountyPayment(bountyId: string): Promise<CreateBountyPaymentResult> {
  return postBountyPayments<CreateBountyPaymentResult>('/create', { bountyId });
}

/**
 * Release captured funds to the hunter (poster action on completion/approval).
 * `hunterId` is optional — the server falls back to the bounty's accepted_by.
 */
export async function releaseBountyPayment(
  bountyId: string,
  hunterId?: string
): Promise<ReleaseBountyPaymentResult> {
  return postBountyPayments<ReleaseBountyPaymentResult>('/release', {
    bountyId,
    ...(hunterId ? { hunterId } : {}),
  });
}

/**
 * Cancel a bounty payment (poster). Cancels the PaymentIntent before capture,
 * or issues a Stripe refund after capture. No-ops idempotently on terminal
 * states; rejects if funds were already released to the hunter.
 */
export async function cancelBountyPayment(bountyId: string): Promise<CancelBountyPaymentResult> {
  return postBountyPayments<CancelBountyPaymentResult>('/cancel', { bountyId });
}

export const bountyPaymentsService = {
  createBountyPayment,
  releaseBountyPayment,
  cancelBountyPayment,
};

export default bountyPaymentsService;
