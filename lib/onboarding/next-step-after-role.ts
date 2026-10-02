/**
 * Where onboarding goes once a role is picked.
 *
 * Hunters go to payout setup (app/onboarding/payouts.tsx): they are the side
 * that gets paid, so the Stripe Connect step is about their own earnings.
 *
 * Posters skip it. Posting, funding and hiring never touch Connect: the
 * reward is held from the wallet when they choose a hunter, and refunds go
 * back to that wallet. Connect is needed only to move a balance out to a
 * bank, and the withdraw flow asks for it at that moment. Asking a new payer
 * for bank details before they've posted anything read as a red flag, not
 * as setup (trust-spine audit T25).
 */
export type OnboardingIntent = 'poster' | 'hunter' | null | undefined;

export const POSTER_NEXT_STEP_AFTER_ROLE = '/onboarding/founder-note' as const;
export const HUNTER_NEXT_STEP_AFTER_ROLE = '/onboarding/payouts' as const;

export function nextStepAfterRole(intent: OnboardingIntent) {
  return intent === 'poster' ? POSTER_NEXT_STEP_AFTER_ROLE : HUNTER_NEXT_STEP_AFTER_ROLE;
}
