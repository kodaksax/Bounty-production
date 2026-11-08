/**
 * Copy for the `poster-home` onboarding flow. Every string here is a draft
 * awaiting founder approval; none of it is final.
 */

export const posterHomeStrings = {
  /** The two cards on the role step (app/onboarding/role-select.tsx). */
  roleOptions: {
    poster: {
      title: 'Get something done.',
      body: 'Post a task, set your price, pay only when you hire.',
    },
    hunter: {
      title: 'Earn nearby.',
      body: 'Browse paid tasks around you.',
    },
  },
  /** The location step (app/onboarding/location.tsx), worded by role. */
  location: {
    poster: {
      heading: 'Allow location so nearby hunters can see your task',
      subheading: 'We use it to put what you post in front of the people closest to it.',
      skipAccessibilityLabel: 'Not now',
    },
    hunter: {
      heading: 'Allow location to see the closest bounties',
      subheading: 'With your location we can show you the bounties closest to you.',
      skipAccessibilityLabel: 'Not now - you will see online bounties only',
    },
  },
  /** Asked once when someone who signed up to hire applies for a bounty. */
  applyPrompt: {
    title: 'Looking to earn as well?',
    body: 'You signed up to hire. Your application goes ahead either way.',
    applyOnce: 'Just this once',
    earnToo: 'Yes, I want to earn too',
  },
} as const;
