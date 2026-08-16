/**
 * Copy for the `poster_first` variant of the onboarding welcome screen
 * (app/onboarding/welcome.tsx, see components/onboarding/PosterFirstWelcome.tsx)
 * and for the trust copy relocated out of that screen into the poster
 * amount-entry step (components/onboarding/PosterTaskPrompt.tsx).
 *
 * No app-wide i18n layer exists in this codebase yet — this is a scoped
 * strings module for this feature so copy lives in one place instead of
 * being hardcoded inline across multiple components.
 */

export const firstScreenStrings = {
  headline: "You've walked past it four hundred times.",
  primaryCta: 'Name your price',
  secondaryCta: "I'd rather earn",

  proofCardCompletedBody: (firstName: string, taskSummary: string, neighborhood: string): string =>
    `${firstName} ${taskSummary} in ${neighborhood}.`,
  proofCardOpenBody: (neighborhood: string, taskSummary: string): string =>
    `Someone in ${neighborhood} needs ${taskSummary}.`,

  // `distance` is pre-formatted (e.g. "1.2") and omitted entirely — not
  // faked — when location isn't available.
  proofCardCompletedMeta: (amount: string, distance: string | null, relativeTime: string): string =>
    distance ? `${amount} · ${distance} mi · ${relativeTime}` : `${amount} · ${relativeTime}`,
  proofCardOpenMeta: (amount: string, distance: string | null, relativeTime: string): string =>
    distance ? `${amount} · ${distance} mi · posted ${relativeTime}` : `${amount} · posted ${relativeTime}`,

  // Cold-market fallback: makes no factual claim about any real bounty.
  fallbackCardBody: "A mounted TV. A hauled mattress.\nA closet door that finally closes.",
  fallbackCardMeta: 'Most bounties run $35–$75',
} as const;

// Relocated from welcome.tsx's old feature rows (removed in the poster_first
// redesign) into PosterTaskPrompt.tsx, beneath the price input — the step
// where it actually converts, per the design rationale: trust copy is a
// closer, not an opener.
export const posterTrustCopyStrings = {
  line1: 'You set the price.',
  line2: 'Your money is held safe and only released when you mark the job done.',
} as const;
