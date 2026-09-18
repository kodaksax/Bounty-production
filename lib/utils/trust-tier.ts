/**
 * Bounty-level trust tier detection: a lightweight, keyword-based
 * recommendation for whether a bounty's real-world risk warrants asking for
 * ID-verified hunters only. Deliberately NOT a universal gate -- most
 * bounties (errands, delivery, general labor, standard writing/research)
 * stay completely friction-free. Deliberately NOT background checks or
 * license verification -- those require legal review this task explicitly
 * excludes; the licensed_trades and vulnerable_people tiers only ever
 * surface informational copy, never a claim that Bounty verified anything
 * beyond identity.
 *
 * Styled the same way as the existing server-side spam/scam scanner
 * (moderation_scan_content in
 * supabase/migrations/20260829120000_bounty_moderation_queue.sql) --
 * word-boundary regexes, named signal types -- but implemented client-side
 * (like lib/utils/skill-match.ts) so the recommendation appears instantly at
 * the review step with no network round-trip, and can never drift that
 * function's own spam-detection behavior.
 */

export type TrustTier =
  | 'standard'
  | 'digital_skill'
  | 'home_entry'
  | 'animal_care'
  | 'licensed_trades'
  | 'vulnerable_people';

export interface TrustTierDetection {
  tier: TrustTier;
  /** Whether an ID-verification toggle should be offered to the poster at all. */
  recommendIdVerified: boolean;
  /** The toggle's initial value when this tier is first detected. */
  defaultIdVerified: boolean;
  /** Tier-specific banner copy. Undefined for tiers that show no banner. */
  bannerCopy?: string;
}

interface TierRule {
  tier: TrustTier;
  pattern: RegExp;
  recommendIdVerified: boolean;
  defaultIdVerified: boolean;
  bannerCopy?: string;
}

// Checked in this order -- most safety-sensitive first -- so text matching
// more than one tier (e.g. "babysit and walk the dog") resolves to the more
// cautious one.
const TIER_RULES: TierRule[] = [
  {
    tier: 'vulnerable_people',
    pattern:
      /\b(nanny|baby[ -]?sit(ting|ter)?|child ?care|elder ?care|elderly care|senior care|caregiver|dependent care)\b/i,
    recommendIdVerified: true,
    defaultIdVerified: false,
    bannerCopy:
      'This bounty involves the care of a child, elderly person, or dependent. Bounty does not perform background checks. Consider requiring ID verification and checking references yourself.',
  },
  {
    tier: 'licensed_trades',
    pattern:
      /\b(electric(al|ian)|rewir(e|ing)|gas line|gas leak|structural|plumb(ing|er)|foundation|roofing|hvac|load[ -]?bearing)\b/i,
    recommendIdVerified: true,
    defaultIdVerified: false,
    bannerCopy:
      "This work may involve a licensed trade (electrical, gas, or structural). Bounty does not verify licenses or certifications -- confirm your hunter's qualifications directly.",
  },
  {
    tier: 'home_entry',
    pattern:
      /\b(house[ -]?clean(ing)?|clean (my|your|the) house|home organi[zs](e|ing|ation)|staging|declutter(ing)?|house[ -]?sitting|inside (my|your) home|enter (my|your) home)\b/i,
    recommendIdVerified: true,
    defaultIdVerified: false,
    bannerCopy:
      'This bounty involves entering someone’s home. Want to recommend ID-verified hunters only?',
  },
  {
    tier: 'animal_care',
    pattern:
      /\b(dog[ -]?walk(ing)?|pet[ -]?sit(ting)?|pet[ -]?board(ing)?|cat[ -]?sit(ting)?|walk (my|your) dog|feed (my|your) (cat|dog|pet))\b/i,
    recommendIdVerified: true,
    defaultIdVerified: true,
    bannerCopy: 'This bounty involves pet care. Want only ID-verified hunters to apply?',
  },
  {
    tier: 'digital_skill',
    pattern:
      /\b(cod(e|ing)|program(ming)?|software|website|app development|graphic design|logo design|ui\/ux|video edit(ing)?)\b/i,
    recommendIdVerified: false,
    defaultIdVerified: false,
  },
];

export function detectTrustTier(
  title: string | null | undefined,
  description: string | null | undefined
): TrustTierDetection {
  const text = `${title || ''} ${description || ''}`;

  for (const rule of TIER_RULES) {
    if (rule.pattern.test(text)) {
      return {
        tier: rule.tier,
        recommendIdVerified: rule.recommendIdVerified,
        defaultIdVerified: rule.defaultIdVerified,
        bannerCopy: rule.bannerCopy,
      };
    }
  }

  return { tier: 'standard', recommendIdVerified: false, defaultIdVerified: false };
}

/** Tiers whose real-world risk warrants emphasizing ID status on an applicant card. */
export const HIGH_RISK_TRUST_TIERS: readonly TrustTier[] = [
  'home_entry',
  'animal_care',
  'licensed_trades',
  'vulnerable_people',
];

export function isHighRiskTrustTier(tier: string | null | undefined): boolean {
  return !!tier && (HIGH_RISK_TRUST_TIERS as readonly string[]).includes(tier);
}

/** Human-readable label for a trust tier, for poster/hunter-facing copy. */
export const TRUST_TIER_LABELS: Record<TrustTier, string> = {
  standard: 'Standard',
  digital_skill: 'Digital / Skill',
  home_entry: 'Home Entry',
  animal_care: 'Animal Care',
  licensed_trades: 'Licensed Trades',
  vulnerable_people: 'Vulnerable People',
};

export function getTrustTierLabel(tier: string | null | undefined): string {
  return (tier && TRUST_TIER_LABELS[tier as TrustTier]) || TRUST_TIER_LABELS.standard;
}
