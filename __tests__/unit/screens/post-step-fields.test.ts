/**
 * Field attribution for post_step_abandoned (app/screens/CreateBounty/postStepFields.ts).
 */

import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { fieldForPatch, incompleteFieldsForStep } from 'app/screens/CreateBounty/postStepFields';

const draft = (overrides: Partial<BountyDraft> = {}): BountyDraft => ({
  title: 'Walk my dog',
  description: 'Thirty minute walk around the block on Saturday morning',
  amount: 20,
  isForHonor: false,
  location: '123 Main St',
  workType: 'in_person',
  ...overrides,
});

describe('fieldForPatch', () => {
  it.each([
    [{ title: 'x' }, 'title'],
    [{ description: 'x' }, 'description'],
    [{ title: 'Walk my dog', category: 'pets', requirements: undefined, amount: 25 }, 'template'],
    [{ category: 'pets', requirements: null }, 'category'],
    [{ workType: 'online' as const }, 'location'],
    [{ latitude: 1, longitude: 2, zipCode: '10001' }, 'location'],
    [{ amount: 15, isForHonor: false }, 'amount'],
    [{ isForHonor: true, amount: 0 }, 'honor'],
  ])('maps %j to %s', (patch, expected) => {
    expect(fieldForPatch(patch)).toBe(expected);
  });

  it('ignores the trust-tier patch StepPay writes from an effect', () => {
    expect(fieldForPatch({ trustTier: 'standard', requiresIdVerified: false })).toBeNull();
  });
});

describe('incompleteFieldsForStep', () => {
  it('reports nothing for a complete draft on any step', () => {
    expect(incompleteFieldsForStep('Task', draft())).toEqual([]);
    expect(incompleteFieldsForStep('Location', draft())).toEqual([]);
    expect(incompleteFieldsForStep('Compensation', draft())).toEqual([]);
  });

  it('reports a missing title and description on Task', () => {
    expect(incompleteFieldsForStep('Task', draft({ title: '', description: '' }))).toEqual([
      'title',
      'description',
    ]);
  });

  it('reports contact info that blocks Next on Task', () => {
    expect(
      incompleteFieldsForStep('Task', draft({ description: 'Call me at 555-123-4567 any time this week' }))
    ).toContain('contact_info');
  });

  it('requires an address only for in-person work', () => {
    expect(incompleteFieldsForStep('Location', draft({ location: '' }))).toEqual(['location']);
    expect(incompleteFieldsForStep('Location', draft({ location: '', workType: 'online' }))).toEqual([]);
  });

  it('reports a $0 paid amount on Compensation but not an honor post', () => {
    expect(incompleteFieldsForStep('Compensation', draft({ amount: 0 }))).toEqual(['amount']);
    expect(incompleteFieldsForStep('Compensation', draft({ amount: 0, isForHonor: true }))).toEqual([]);
  });

  it('returns nothing for an unknown step', () => {
    expect(incompleteFieldsForStep(undefined, draft({ title: '' }))).toEqual([]);
  });
});
