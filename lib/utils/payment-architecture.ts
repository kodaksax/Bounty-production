/**
 * Centralized routing between the legacy custodial-wallet payment path (v1,
 * lib/wallet-context.tsx) and the Stripe-native per-bounty escrow path (v2,
 * lib/services/bounty-payments-service.ts). Single source of truth so
 * call sites don't each re-implement the same version check.
 */
import { config } from '../config';

export type PaymentArchitectureVersion = 1 | 2;

interface BountyVersionFields {
  payment_architecture_version?: number | null;
}

/**
 * The architecture an existing bounty was actually funded under. Defaults to
 * 1 (legacy) when unset, matching the DB column default — see
 * supabase/functions/bounty-payments/index.ts, which sets this to 2 only
 * after a Phase 2 PaymentIntent is created for the bounty.
 */
export function getBountyPaymentArchitectureVersion(
  bounty: BountyVersionFields | null | undefined
): PaymentArchitectureVersion {
  return bounty?.payment_architecture_version === 2 ? 2 : 1;
}

export function isPhase2Bounty(bounty: BountyVersionFields | null | undefined): boolean {
  return getBountyPaymentArchitectureVersion(bounty) === 2;
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
 * Statuses in which a paid bounty's escrow is still held — the funds are
 * neither released to a hunter nor refunded to the poster.
 */
const ESCROW_HELD_STATUSES = ['open', 'in_progress', 'cancellation_requested'];

interface BountyEscrowFields {
  amount?: number | null;
  is_for_honor?: boolean | null;
  status?: string | null;
}

/**
 * True when a bounty still holds escrowed funds. Delete paths that do not
 * refund must block on this, so a poster cannot destroy a funded bounty and
 * lose the money.
 */
export function bountyHoldsUnreleasedEscrow(
  bounty: BountyEscrowFields | null | undefined
): boolean {
  if (!bounty) return false;
  if (bounty.is_for_honor) return false;
  if (!bounty.amount || bounty.amount <= 0) return false;
  return ESCROW_HELD_STATUSES.includes(bounty.status ?? '');
}
