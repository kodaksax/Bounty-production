/**
 * Copy for the onboarding welcome carousel
 * (components/onboarding/WelcomeCarousel.tsx, rendered by app/onboarding/welcome.tsx).
 *
 * Slide headlines/body lines and the proof-card caption are spec-scripted —
 * kept verbatim. The proof-card's task title and poster name are wrapped in
 * [brackets] deliberately: they stand in for real user-generated content
 * (a completed bounty pulled live, the way ProofCard.tsx already does on
 * the funding screen) and must never be read as a claim about a specific
 * bounty or person.
 */

export interface WelcomeCarouselSlide {
  key: string;
  headline: string;
  body?: string;
}

export interface WelcomeCarouselTrustRow {
  icon: 'lock' | 'verified-user' | 'location-on';
  title: string;
  body: string;
}

export const welcomeCarouselStrings = {
  slides: [
    {
      key: 'help',
      headline: 'Help in any form.',
      body: "A mounted TV. A hauled mattress. A closet door that finally closes.",
    },
    {
      key: 'escrow',
      headline: "You don't pay till it's done. Your way.",
      body: "Money is secured when you accept a hunter and only released when you're satisfied.",
    },
    {
      key: 'proof',
      headline: 'Real jobs, real money, right nearby.',
      body: 'A real bounty, really completed. Never a mock-up.',
    },
    {
      key: 'trust',
      headline: 'Nobody gets paid until you say so.',
    },
  ] satisfies WelcomeCarouselSlide[],

  proofCard: {
    statusBadge: 'COMPLETED',
    paidOut: 'paid out 2h ago',
    taskTitle: '[Hauled a mattress to the curb]',
    amount: '$85',
    posterInitial: 'M',
    posterName: '[Marcus]',
    rating: '4.9',
    distance: '0.9 mi',
  },

  // Trust slide rows. Only the last of these ("never an address") is a claim
  // this app already keeps elsewhere (hunters see a neighborhood, not a
  // street address) — kept verbatim as scripted rather than bracketed.
  trustRows: [
    {
      icon: 'lock',
      title: 'Held in escrow',
      body: 'Released only when you mark the job done.',
    },
    {
      icon: 'verified-user',
      title: 'Both sides are ID-verified',
      body: 'Posters and hunters alike, before money moves.',
    },
    {
      icon: 'location-on',
      title: 'Your address stays yours',
      body: 'Hunters see a neighbourhood and a rating — never an address.',
    },
  ] satisfies WelcomeCarouselTrustRow[],

  howItWorksCta: 'How it works — fees, escrow & disputes',
  signUpCta: 'Sign Up',
  logInCta: 'Log In',
} as const;
