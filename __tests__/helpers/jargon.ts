/**
 * User-facing words the plain-language standards rule out (say job, helper,
 * offer; "Bounty" the name is fine, "bounty" the noun is not). Shared so every
 * copy test applies the same rule.
 */
export const JARGON = /\b(hunters?|escrow|payouts?|apply|applied|applicants?|ACH|Connect|onboarding|disputes?)\b|\bbounty\b/;
