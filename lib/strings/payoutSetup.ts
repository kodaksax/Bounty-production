/**
 * Copy for the onboarding payout-setup step
 * (components/onboarding/PayoutSetupScreen.tsx, rendered by
 * app/onboarding/payouts.tsx).
 *
 * The one non-negotiable in this copy: it must say the wallet is already
 * configured. This screen appears right after role selection, before the user
 * has done anything, so a bare "Set up payouts" reads as "your account is
 * incomplete" — and the wallet genuinely is not incomplete. All this step does
 * is attach a Stripe Connect account so money can leave the wallet and reach a
 * bank. Keep that distinction in any rewrite.
 */

export type PayoutCountry = {
  /** ISO 3166-1 alpha-2, the shape Stripe's `country` field expects. */
  code: string;
  name: string;
};

// Stripe Connect Express markets we support today. The list is intentionally
// short: every entry here must be a country the platform account can actually
// create connected accounts in, or the user picks it and onboarding fails at
// Stripe with an unhelpful error.
export const PAYOUT_COUNTRIES: PayoutCountry[] = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AU', name: 'Australia' },
  { code: 'IE', name: 'Ireland' },
  { code: 'NZ', name: 'New Zealand' },
];

export const DEFAULT_PAYOUT_COUNTRY: PayoutCountry = PAYOUT_COUNTRIES[0];

export const PAYOUT_SETUP_COPY = {
  headerTitle: 'Payouts',
  heroTitle: 'Set Up Payouts',
  heroBody: 'Your Bounty wallet is already configured. Connect Stripe so your money can reach your bank.',
  getStarted: 'Get Started',
  sheetTitle: 'Set Up Payouts',
  sheetBody:
    'Your wallet is configured and ready — this step is only the Stripe payout connection. Once you link a Stripe account, you can move your balance out to your bank account.',
  createAccount: 'Create Stripe Account',
  linkExisting: 'Link Existing Account',
  skip: "I'll do this later",
} as const;
