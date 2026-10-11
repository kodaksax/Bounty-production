/**
 * Where onboarding goes once a role is picked.
 *
 * Hunters go to payout setup (app/onboarding/payouts.tsx): they are the side
 * that gets paid, so the Stripe Connect step is about their own earnings.
 *
 * Posters go to the poster profile step (app/onboarding/poster-profile.tsx)
 * instead: name, photo and bio, which hunters see before taking a bounty.
 * They skip payouts because posting, funding and hiring never touch Connect: the
 * reward is held from the wallet when they choose a hunter, and refunds go
 * back to that wallet. Connect is needed only to move a balance out to a
 * bank, and the withdraw flow asks for it at that moment. Asking a new payer
 * for bank details before they've posted anything read as a red flag, not
 * as setup (trust-spine audit T25).
 *
 * Only defined for a picked role. With no role there is no "after role":
 * callers route to role selection's own entry (the style step) instead, and
 * the type makes them decide that rather than inheriting a default.
 */
export type OnboardingRole = 'poster' | 'hunter';

export const POSTER_NEXT_STEP_AFTER_ROLE = '/onboarding/poster-profile' as const;
export const HUNTER_NEXT_STEP_AFTER_ROLE = '/onboarding/payouts' as const;

export function nextStepAfterRole(role: OnboardingRole) {
  switch (role) {
    case 'poster':
      return POSTER_NEXT_STEP_AFTER_ROLE;
    case 'hunter':
      return HUNTER_NEXT_STEP_AFTER_ROLE;
    default: {
      // Unreachable for typed callers; untyped data (e.g. a corrupted
      // onboarding draft) fails loudly instead of landing on payout setup.
      const unexpected: never = role;
      throw new Error(`nextStepAfterRole: unknown role ${String(unexpected)}`);
    }
  }
}

/** For values read from storage/drafts, which the type system can't vouch for. */
export function isOnboardingRole(value: unknown): value is OnboardingRole {
  return value === 'poster' || value === 'hunter';
}
