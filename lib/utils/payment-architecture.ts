/**
 * Centralized routing between the legacy custodial-wallet payment path (v1,
 * lib/wallet-context.tsx) and the Stripe-native per-bounty escrow path (v2,
 * lib/services/bounty-payments-service.ts). Single source of truth so
 * call sites don't each re-implement the same version check.
 */
import { config } from '../config';

export type PaymentArchitectureVersion = 1 | 2 | 3;

interface BountyVersionFields {
  payment_architecture_version?: number | null;
}

/**
 * The architecture an existing bounty was actually funded under. Defaults to
 * 1 (legacy) when unset, matching the DB column default — see
 * supabase/functions/bounty-payments/index.ts, which sets this to 2 after a
 * Phase 2 PaymentIntent is created, or 3 for a v3 manual-capture
 * authorization.
 */
export function getBountyPaymentArchitectureVersion(
  bounty: BountyVersionFields | null | undefined
): PaymentArchitectureVersion {
  const v = bounty?.payment_architecture_version;
  if (v === 3) return 3;
  if (v === 2) return 2;
  return 1;
}

export function isPhase2Bounty(bounty: BountyVersionFields | null | undefined): boolean {
  return getBountyPaymentArchitectureVersion(bounty) === 2;
}

export function isStripeNativeBounty(bounty: BountyVersionFields | null | undefined): boolean {
  const v = getBountyPaymentArchitectureVersion(bounty);
  return v === 2 || v === 3;
}

export function isV3Bounty(bounty: BountyVersionFields | null | undefined): boolean {
  return getBountyPaymentArchitectureVersion(bounty) === 3;
}

/**
 * Whether NEWLY CREATED bounties should be funded via the Phase 2
 * Stripe-native escrow path. This only affects funding of new bounties —
 * release/cancel/refund routing for an existing bounty must always read its
 * own `payment_architecture_version` (via isPhase2Bounty) rather than this
 * flag, since the flag's value can change after the bounty was created.
 */
export function shouldFundNewBountiesWithPhase2(): boolean {
  return config.features.paymentArchitectureVersion === '2';
}

/**
 * Whether new bounties should be funded through the Stripe-native path at all
 * (v2 automatic-capture or v3 manual-capture authorization).
 *
 * The client cannot decide between v2 and v3 — that routing is per-user and
 * lives server-side in `fn_should_use_v3`, gated by `v3_rollout_config`. This
 * flag only decides whether to call `bounty-payments/create` in the first
 * place; the response's `architectureVersion` says which path actually ran.
 */
export function shouldUseStripeNativeFunding(): boolean {
  const v = config.features.paymentArchitectureVersion;
  return v === '2' || v === '3';
}

/**
 * Statuses in which a paid bounty's escrow is still held — the funds are
 * neither released to a hunter nor refunded to the poster.
 */
const ESCROW_HELD_STATUSES = ['open', 'in_progress', 'cancellation_requested'];
const V2_ESCROW_PENDING_STATUSES = [
  'authorized',
  'captured',
  'pending_payment',
  'release_pending',
  'refund_pending',
];
const V2_ESCROW_TERMINAL_STATUSES = ['canceled', 'refunded', 'released'];

interface BountyEscrowFields {
  amount?: number | null;
  is_for_honor?: boolean | null;
  status?: string | null;
  payment_architecture_version?: number | null;
  payment_status?: string | null;
  settlement_state?: string | null;
}

/**
 * True when a bounty still holds escrowed funds. Delete paths that do not
 * refund must block on this, so a poster cannot destroy a funded bounty and
 * lose the money. Prefer the payment row's status/settlement state over the
 * bounty lifecycle status when the bounty was funded under the v2 Stripe-native
 * escrow architecture.
 */
export function bountyHoldsUnreleasedEscrow(
  bounty: BountyEscrowFields | null | undefined
): boolean {
  if (!bounty) return false;
  if (bounty.is_for_honor) return false;
  if (!bounty.amount || bounty.amount <= 0) return false;

  const normalizedStatus = (bounty.status ?? '').toLowerCase();
  const paymentStatus = (bounty.payment_status ?? '').toLowerCase();
  const settlementState = (bounty.settlement_state ?? '').toLowerCase();

  if (isPhase2Bounty(bounty)) {
    if (V2_ESCROW_TERMINAL_STATUSES.includes(paymentStatus)) {
      return false;
    }
    if (V2_ESCROW_PENDING_STATUSES.includes(paymentStatus)) {
      return true;
    }
    if (settlementState === 'stripe_settled' || settlementState === 'stripe_failed') {
      return false;
    }
    if (settlementState === 'stripe_pending') {
      return true;
    }
  }

  return ESCROW_HELD_STATUSES.includes(normalizedStatus);
}
