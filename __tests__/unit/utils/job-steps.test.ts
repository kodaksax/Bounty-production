/** Both sides of a job show the same step at the same moment. */
import { describeHunterStage } from '../../../lib/utils/hunter-stage-copy';
import { describePosterStage } from '../../../lib/utils/poster-stage-copy';

const life = (status: string, tone = 'progress') => ({ status, headline: 'H', explanation: 'E.', nextStep: 'N.', tone, waitingOn: 'other' }) as any;
const poster = (status: string, over: object = {}, tone?: string) =>
  describePosterStage({
    bounty: { status: 'in_progress', amount: 60, accepted_by: 'ada', created_at: '2026-11-21T08:00:00Z' },
    lifecycle: life(status, tone), helperName: 'Ada R.', applicantCount: 0, hasDispute: false, openJobCharge: null,
    now: new Date('2026-11-21T10:00:00Z'), ...over,
  } as any);
const hunter = (status: string, over: object = {}, tone?: string) =>
  describeHunterStage({ bounty: { amount: 60 }, lifecycle: life(status, tone), posterName: 'Jordan K.', requestStatus: 'accepted', hasDispute: false, ...over } as any);

it.each([
  ['choosing', poster('open', { applicantCount: 1 }), hunter('applied'), 2],
  ['working', poster('in_progress'), hunter('in_progress'), 3],
  ['a change was asked for', poster('in_progress', { submission: { status: 'revision_requested' } }), hunter('in_progress', { submission: { status: 'revision_requested' } }), 3],
  ['reviewing', poster('review_needed'), hunter('submitted_for_review'), 4],
  ['finished', poster('completed', {}, 'positive'), hunter('completed', {}, 'positive'), 5],
  ['disputed', poster('in_progress', { hasDispute: true }), hunter('in_progress', { hasDispute: true }), 4],
])('%s', (_name, p, h, step) => {
  expect([p.step, h.step]).toEqual([step, step]);
});

it('the poster starts at Posted, and no step asks anyone to agree a time', () => {
  expect(poster('open').stage).toBe('Step 1 of 5 · Posted');
  for (const v of [poster('open', { applicantCount: 2 }), poster('in_progress'), hunter('applied'), hunter('in_progress')]) {
    expect(JSON.stringify(v)).not.toMatch(/agree (on )?a time/i);
  }
});
