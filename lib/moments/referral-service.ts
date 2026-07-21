/**
 * Moments Queue — referral activation integration point.
 *
 * No referral/invite system exists yet. This is the single place a real one
 * plugs into:
 *  - `isReferralAvailable()` should check whatever real signal indicates the
 *    feature is live (a feature flag, a remote-config value, a capability
 *    check against the backend) instead of the hardcoded `false` below.
 *  - `shareInvite()` should open the actual share sheet / deep link and
 *    return whether the user completed a share.
 *
 * `invite_friends` in registry.ts calls `isReferralAvailable()` directly in
 * its `isEligible`, so the moment stays structurally dormant — never
 * evaluated as eligible, never shown — until this file reports the feature
 * is live. No other file (engine, provider, registry entries for other
 * moments) needs to change when that day comes.
 */

export const referralService = {
  /** Swap for a real feature-flag/remote-config/capability check once a referral system ships. */
  isReferralAvailable(): boolean {
    return false;
  },

  /** Resolves true only on a completed share; false (including "not available yet") otherwise. */
  async shareInvite(): Promise<boolean> {
    if (!referralService.isReferralAvailable()) return false;
    // TODO(referral): open the real share sheet / deep link here once a
    // referral system exists, and return whether the user actually shared.
    return false;
  },
};
