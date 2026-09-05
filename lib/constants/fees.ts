/**
 * Platform fee — the single client-side source of truth.
 *
 * This MUST track the server's `PLATFORM_FEE_PERCENT` env default, which is
 * read in three places and defaults to 5:
 *   - supabase/functions/wallet/index.ts       (internal wallet release)
 *   - supabase/functions/bounty-payments/index.ts (v2 / v3 release)
 *   - services/api/src/services/completion-release-service.ts
 *
 * Before this file existed the client kept its own constant at 10% and the
 * FAQ derived its copy from it, so the app told every user the fee was twice
 * what is actually deducted. The fee is money the user is told about before
 * they transact, so a drifting duplicate here is a trust bug, not a cosmetic
 * one.
 *
 * IMPORTANT: this is the *estimate* shown in the UI. Whenever the server has
 * already returned an authoritative `platformFee` for a specific release,
 * display that number instead of recomputing from this constant — the server
 * env can be tuned without a client release.
 */

/** Platform service fee, as a percent (5 = 5%). Mirrors PLATFORM_FEE_PERCENT. */
export const PLATFORM_FEE_PERCENT = 5;

/** Same fee expressed as a rate (0.05). */
export const PLATFORM_FEE_RATE = PLATFORM_FEE_PERCENT / 100;

/** "5%" — for display. Avoids "5.0%" for whole numbers. */
export const PLATFORM_FEE_DISPLAY = `${
  Number.isInteger(PLATFORM_FEE_PERCENT)
    ? PLATFORM_FEE_PERCENT
    : PLATFORM_FEE_PERCENT.toFixed(1)
}%`;

export interface HunterEarnings {
  /** The bounty amount the poster named. */
  gross: number;
  /** Platform service fee deducted on release. */
  fee: number;
  /** What actually lands in the hunter's wallet. */
  net: number;
}

/**
 * Split a bounty amount into what the hunter is quoted, what is deducted, and
 * what they actually receive.
 *
 * Rounds to cents the same way the server does (round the fee, then subtract)
 * so the displayed net matches the credited net rather than drifting a cent.
 *
 * @param amount   Bounty amount in dollars.
 * @param feeCents Optional authoritative fee, in dollars, from the server's
 *                 release response. When supplied it wins over the estimate.
 */
export function calculateHunterEarnings(
  amount: number | null | undefined,
  actualFee?: number | null
): HunterEarnings {
  const gross = Number.isFinite(amount) && (amount as number) > 0 ? Number(amount) : 0;
  const fee =
    actualFee != null && Number.isFinite(actualFee)
      ? Math.max(0, Number(actualFee))
      : Math.round(gross * PLATFORM_FEE_RATE * 100) / 100;
  return {
    gross,
    fee,
    net: Math.max(0, Math.round((gross - fee) * 100) / 100),
  };
}

/** Fee actually applied to a completed release, as a percent, for receipts. */
export function effectiveFeePercent(gross: number, fee: number): number {
  if (!Number.isFinite(gross) || gross <= 0) return PLATFORM_FEE_PERCENT;
  return Math.round((fee / gross) * 1000) / 10;
}
