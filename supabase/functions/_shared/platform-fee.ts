/**
 * The platform fee split, in integer cents — the single server-side rule.
 *
 * Why this exists (2026-11-04 Stripe dev-workflow audit): v1 (wallet /release)
 * and v2 (bounty-payments /release) computed the fee in floating-point dollars,
 *     Math.round(((amount * pct) / 100) * 100) / 100
 * while v3 and the web receipt (web-account/logic.ts hunterNetCents) used
 * integer cents. Float error makes the dollar form round half-cents DOWN:
 * $11.50 → 11.5*5/100*100 = 57.49999… → fee $0.57, where the cents form gives
 * 575/10 = 57.5 → $0.58. 286 of the 100,000 amounts from $0.01 to $1,000
 * disagreed, including whole-dollar-and-a-half amounts like $20.50 and $99.50.
 * The receipt therefore showed a different fee and net than was credited.
 *
 * Rule: convert the amount to whole cents once, round the fee (half up) to a
 * whole cent, and the hunter receives the remainder. Fee + net always equals
 * the amount exactly.
 */

/**
 * Platform fee percent used when the PLATFORM_FEE_PERCENT secret is unset.
 *
 * 8% is the business rate (owner decision 2026-11-04). Production has charged
 * 8% via the PLATFORM_FEE_PERCENT secret since 2026-07-12 while this default,
 * and the client's displayed rate, still said 5%. Keep in lockstep with
 * PLATFORM_FEE_PERCENT in lib/constants/fees.ts (asserted by
 * __tests__/unit/platform-fee-parity.test.ts).
 */
export const DEFAULT_PLATFORM_FEE_PERCENT = 8;

/** The fee percent from the PLATFORM_FEE_PERCENT secret, or the default. */
export function platformFeePercentFromEnv(raw: string | undefined | null): number {
  return Number(raw ?? String(DEFAULT_PLATFORM_FEE_PERCENT));
}

export interface PlatformFeeSplit {
  amountCents: number;
  feeCents: number;
  hunterCents: number;
}

/** Splits an amount already in integer cents. */
export function splitPlatformFeeCents(amountCents: number, feePercent: number): PlatformFeeSplit {
  const cents = Math.round(Number(amountCents) || 0);
  const feeCents = Math.round((cents * feePercent) / 100);
  return { amountCents: cents, feeCents, hunterCents: cents - feeCents };
}

/**
 * Splits a dollar amount (as stored in numeric columns) and returns dollars
 * for the existing dollar-denominated ledgers. The arithmetic is in cents; the
 * division back to dollars is exact to two decimals.
 */
export function splitPlatformFeeDollars(
  amountDollars: number,
  feePercent: number
): { platformFee: number; hunterAmount: number; feeCents: number; hunterCents: number } {
  const split = splitPlatformFeeCents(Math.round(Number(amountDollars || 0) * 100), feePercent);
  return {
    platformFee: split.feeCents / 100,
    hunterAmount: split.hunterCents / 100,
    feeCents: split.feeCents,
    hunterCents: split.hunterCents,
  };
}
