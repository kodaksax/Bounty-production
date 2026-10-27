/**
 * Field attribution for post_step_abandoned (app/screens/CreateBounty/postStepFields.ts).
 */

import type { BountyDraft } from 'app/hooks/useBountyDraft';
import {
  fieldForPatch,
  incompleteFieldsForStep,
  resumeStepForDraft,
} from 'app/screens/CreateBounty/postStepFields';

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

describe('resumeStepForDraft', () => {
  const pinned = { latitude: 40.7, longitude: -74 };

  it('stays on Task while the task is unfinished', () => {
    expect(resumeStepForDraft(draft({ description: 'too short' }))).toBe(1);
    expect(resumeStepForDraft(draft({ title: '' }))).toBe(1);
  });

  it('reopens on Location for an in-person draft with an address but no pin', () => {
    // StepWhere only geocodes on Continue, so typed text alone must not skip it.
    expect(resumeStepForDraft(draft())).toBe(2);
    expect(resumeStepForDraft(draft({ location: '' }))).toBe(2);
  });

  it('reopens on Compensation once the location is pinned or online', () => {
    expect(resumeStepForDraft(draft(pinned))).toBe(3);
    expect(resumeStepForDraft(draft({ workType: 'online', location: '' }))).toBe(3);
  });

  it('still reopens on Compensation for a draft that only lacks an amount', () => {
    expect(resumeStepForDraft(draft({ ...pinned, amount: 0 }))).toBe(3);
  });
});
