/**
 * Copy for the founder note shown immediately after payout setup
 * (app/onboarding/founder-note.tsx), between app/onboarding/payouts.tsx and
 * app/onboarding/style.tsx.
 *
 * Same pattern as lib/strings/firstScreen.ts and lib/strings/payoutSetup.ts:
 * no app-wide i18n layer exists yet, so each feature keeps its copy in one
 * scoped module rather than hardcoding it inline.
 *
 * The quote is split into lines deliberately — it's set in a monospace face,
 * so letting it wrap on its own produces ragged, uneven line lengths. Keeping
 * the breaks here means the copy and its shape stay in one place.
 */

export const founderNoteStrings = {
  quoteLines: [
    'the reason people struggle in life',
    'is the disconnect between',
    'those who need help',
    'and those that can help',
  ] as const,
  /** Typed out in the same SpaceMono face as the quote, a beat after it lands. */
  signature: 'Robert Lee Wright III',
  signatureDash: '—',
  primaryCta: 'Continue',
} as const;
