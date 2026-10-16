import type { BountyRequirementsInput, HunterCapability } from '../capabilities';

export interface HunterQualification {
  eligible: boolean;
  score: number;
  matchedTerms: { term_id: string; importance: 'required' | 'preferred' }[];
  missingRequiredTerms: string[];
  reasons: string[];
}

/**
 * Deterministic exact-term match. Self-reported capability declarations are
 * matching signals only; this result is not credential or identity verification.
 */
export function evaluateHunterQualification(
  requirements: BountyRequirementsInput | null | undefined,
  capabilities: HunterCapability[],
): HunterQualification {
  if (!requirements || requirements.terms.length === 0) {
    return {
      eligible: true,
      score: 0.5,
      matchedTerms: [],
      missingRequiredTerms: [],
      reasons: ['No structured capability requirements'],
    };
  }

  const hasCompatibleDeclarations = capabilities.some(
    capability =>
      capability.taxonomy_version === requirements.taxonomy_version &&
      capability.task_id === requirements.task_id,
  );
  const declaredTerms = new Set(
    hasCompatibleDeclarations
      ? capabilities
          .filter(
            capability =>
              capability.taxonomy_version === requirements.taxonomy_version &&
              capability.task_id === requirements.task_id,
          )
          .map(capability => capability.term_id)
      : [],
  );
  const matchedTerms = requirements.terms
    .filter(term => declaredTerms.has(term.term_id))
    .map(({ term_id, importance }) => ({ term_id, importance }));
  const missingRequiredTerms = requirements.terms
    .filter(term => term.importance === 'required' && !declaredTerms.has(term.term_id))
    .map(term => term.term_id);
  const preferredTerms = requirements.terms.filter(term => term.importance === 'preferred');
  const preferredMatches = matchedTerms.filter(term => term.importance === 'preferred').length;

  return {
    eligible: missingRequiredTerms.length === 0,
    score: preferredTerms.length === 0 ? 1 : preferredMatches / preferredTerms.length,
    matchedTerms,
    missingRequiredTerms,
    reasons: [
      ...(missingRequiredTerms.length === 0
        ? ['All required terms are self-reported']
        : [`Missing required self-reported terms: ${missingRequiredTerms.join(', ')}`]),
      ...(preferredTerms.length > 0
        ? [`Matched ${preferredMatches} of ${preferredTerms.length} preferred terms`]
        : []),
    ],
  };
}
