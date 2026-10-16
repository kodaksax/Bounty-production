import { evaluateHunterQualification } from '../../lib/matching/hunter-qualification';
import type { BountyRequirementsInput, HunterCapability } from '../../lib/capabilities';

const requirements: BountyRequirementsInput = {
  taxonomy_version: 1,
  task_id: 'organize_items',
  terms: [
    { term_id: 'organization', importance: 'required' },
    { term_id: 'storage_bins', importance: 'preferred' },
  ],
};

const capability = (term_id: string, taxonomy_version = 1, task_id = 'organize_items'): HunterCapability => ({
  taxonomy_version,
  task_id,
  term_id,
  provenance: 'self_reported',
});

describe('evaluateHunterQualification', () => {
  it('requires exact declarations for required terms and explains self-reported matches', () => {
    expect(evaluateHunterQualification(requirements, [capability('organization')])).toEqual({
      eligible: true,
      score: 0,
      matchedTerms: [{ term_id: 'organization', importance: 'required' }],
      missingRequiredTerms: [],
      reasons: ['All required terms are self-reported', 'Matched 0 of 1 preferred terms'],
    });
  });

  it('ranks eligible hunters deterministically by preferred-term coverage', () => {
    const complete = evaluateHunterQualification(requirements, [
      capability('organization'),
      capability('storage_bins'),
    ]);
    const partial = evaluateHunterQualification(requirements, [capability('organization')]);
    expect(complete.eligible).toBe(true);
    expect(complete.score).toBe(1);
    expect(partial.score).toBe(0);
  });

  it('does not treat a different task or taxonomy version as equivalent evidence', () => {
    const result = evaluateHunterQualification(requirements, [
      capability('organization', 2),
      capability('organization', 1, 'pickup_items'),
    ]);
    expect(result.eligible).toBe(false);
    expect(result.missingRequiredTerms).toEqual(['organization']);
  });

  it('keeps missing requirements neutral rather than penalizing new hunters', () => {
    expect(evaluateHunterQualification(null, [])).toMatchObject({
      eligible: true,
      score: 0.5,
      reasons: ['No structured capability requirements'],
    });
  });
});
