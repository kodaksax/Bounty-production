/**
 * Copy for the onboarding welcome carousel
 * (components/onboarding/WelcomeCarousel.tsx, rendered by app/onboarding/welcome.tsx).
 *
 * Slide headlines/body lines and the proof-card caption are spec-scripted —
 * kept verbatim. The proof cards are illustrative requests, not transactions,
 * and say so on the card itself ("EXAMPLE"). They used to carry
 * "COMPLETED · paid out 2h ago · 4.9 ✓" plus bracketed placeholders that
 * rendered literally, which read as both a broken template and a claim about
 * real jobs (trust-spine audit T9). Nothing on these cards may state an
 * outcome, payout, rating or verification.
 */

export interface WelcomeCarouselSlide {
  key: string;
  headline: string;
  body?: string;
}

/**
 * The cards the `proof` slide rolls through, slot-machine style (see
 * RotatingProofCards in WelcomeCarousel.tsx) instead of showing one static
 * card.
 *
 * Illustrative asks in a poster's own voice, labelled as examples on the
 * card. Names, amounts and distances are made up; the card shows no status,
 * payout, rating or verification for them.
 */
export interface WelcomeProofExampleCard {
  key: string;
  request: string;
  amount: string;
  distance: string;
  posterInitial: string;
  posterName: string;
}

export const welcomeProofExampleCards = [
  {
    key: 'couch',
    request:
      "I'm moving this weekend and my new couch arrives while I'm at work. Can someone be there to receive it and help get it inside?",
    amount: '$90',
    distance: '1.1 mi',
    posterInitial: 'D',
    posterName: 'Dana',
  },
  {
    key: 'groceries',
    request:
      "My mom is visiting from the Philippines and I'm at work all day. Can someone who speaks Filipino go grocery shopping with her and help her get around?",
    amount: '$120',
    distance: '0.6 mi',
    posterInitial: 'R',
    posterName: 'Rey',
  },
  {
    key: 'charger',
    request:
      'I left my laptop charger at a coffee shop 30 minutes away. Can someone pick it up and bring it to me?',
    amount: '$45',
    distance: '2.4 mi',
    posterInitial: 'S',
    posterName: 'Sam',
  },
  {
    key: 'ride',
    request:
      "My dad needs to get something from a store across town, but he can't drive right now. Can someone pick him up, take him there, and bring him home?",
    amount: '$75',
    distance: '1.8 mi',
    posterInitial: 'A',
    posterName: 'Alex',
  },
] satisfies WelcomeProofExampleCard[];

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
      body: "Big, small, weird, or specific. Someone can help.",
    },
    {
      key: 'proof',
      headline: 'Anything can be a bounty',
      body: 'Even the things you’d never think to ask someone to do.',
    },
    {
      key: 'escrow',
      headline: "You don't pay till it's done. Your way.",
      body: "Money is secured when you accept a hunter and only released when you're satisfied.",
    },
    {
      key: 'trust',
      headline: 'Nobody gets paid until you say so.',
    },
  ] satisfies WelcomeCarouselSlide[],

  proofCard: {
    // Shown on every rolling card. Neutral, not the "completed" colour.
    exampleBadge: 'EXAMPLE',
  },

  // Trust slide rows. Every one must describe behaviour the app actually
  // enforces. ID verification is NOT mandatory for either side — it's a
  // per-bounty requirement the poster can switch on (requires_id_verified,
  // StepPay.tsx), so the middle row says exactly that and nothing stronger.
  trustRows: [
    {
      icon: 'lock',
      title: 'Held in escrow',
      body: 'Released only when you mark the job done.',
    },
    {
      icon: 'verified-user',
      title: 'Require ID when it matters',
      body: 'Switch it on for a bounty and only ID-verified hunters can apply.',
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
