/**
 * How strongly a hunter should be pushed to write a "why me?" application
 * pitch for a given bounty, and what to prompt them with. There is no
 * "trust tier" concept anywhere else in the schema, so this is deliberately
 * a simple amount-based heuristic (more money at stake -> more useful to
 * know why this hunter, specifically, should get it) rather than a new
 * category/risk taxonomy.
 */

import { BOUNTY_CATEGORIES } from '../constants/bounty-categories';

export type PitchRequirement = 'optional' | 'encouraged' | 'required';

/** Below this dollar amount (or any honor bounty), the pitch stays fully optional. */
export const PITCH_ENCOURAGED_MIN_AMOUNT = 50;

/** At/above this dollar amount, a pitch is required to submit the application. */
export const PITCH_REQUIRED_MIN_AMOUNT = 150;

/** Minimum pitch length (characters) accepted when a pitch is required. */
export const PITCH_REQUIRED_MIN_LENGTH = 20;

export interface PitchRequirementBountyInput {
  amount?: number | null;
  is_for_honor?: boolean | null;
}

/**
 * `optional`   — amount < $50, or an honor bounty (no money changes hands).
 * `encouraged` — $50 to just under $150: nudged, never blocked.
 * `required`   — $150+: a pitch of at least PITCH_REQUIRED_MIN_LENGTH chars
 *                is required to submit.
 */
export function getPitchRequirement(bounty: PitchRequirementBountyInput): PitchRequirement {
  if (bounty.is_for_honor) return 'optional';
  const amount = typeof bounty.amount === 'number' && Number.isFinite(bounty.amount) ? bounty.amount : 0;
  if (amount >= PITCH_REQUIRED_MIN_AMOUNT) return 'required';
  if (amount >= PITCH_ENCOURAGED_MIN_AMOUNT) return 'encouraged';
  return 'optional';
}

const CATEGORY_PROMPTS: Record<string, string> = {
  labor: "Tell the poster about similar work you've done.",
  delivery: "Tell the poster about your experience with moving, deliveries, or heavy lifting.",
  design: "Share relevant experience or work you've done.",
  tech: "Share relevant experience or work you've done.",
  writing: "Share relevant experience or work you've done.",
  other: "Tell the poster why you're a good fit for this bounty.",
};

const DEFAULT_PROMPT = CATEGORY_PROMPTS.other;

/**
 * Category-specific "why me?" prompt copy. Falls back to the generic prompt
 * for an unset or unrecognized category rather than guessing — deliberately
 * scoped to the existing BOUNTY_CATEGORIES list, no separate taxonomy.
 */
export function getPitchPrompt(category: string | null | undefined): string {
  if (!category) return DEFAULT_PROMPT;
  const normalized = category.toLowerCase();
  if (!BOUNTY_CATEGORIES.some((c) => c.id === normalized)) return DEFAULT_PROMPT;
  return CATEGORY_PROMPTS[normalized] || DEFAULT_PROMPT;
}
