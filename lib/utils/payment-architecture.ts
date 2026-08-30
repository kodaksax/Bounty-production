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
