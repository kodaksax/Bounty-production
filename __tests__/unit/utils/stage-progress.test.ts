/**
 * E2E-01: a refetch may move a job's stage forward, and backward only for the
 * five real server changes the product owner approved (plus a report or
 * cancellation request closing). Every allowed move and a set of refused ones.
 */
import { checkStageMove, stageRank, type StageFacts } from '../../../lib/utils/stage-progress';

const base: StageFacts = {
  bountyStatus: 'in_progress',
  acceptedBy: 'h1',
  applicationCount: 0,
  submissionStatus: null,
  hasDispute: false,
  hasCancellationRequest: false,
};
const posted: StageFacts = { ...base, bountyStatus: 'open', acceptedBy: null };
const offers: StageFacts = { ...posted, applicationCount: 3 };
const working = base;
const review: StageFacts = { ...base, submissionStatus: 'pending' };
const paying: StageFacts = { ...base, submissionStatus: 'approved' };
const finished: StageFacts = { ...base, bountyStatus: 'completed', submissionStatus: 'approved' };

describe('stageRank', () => {
  it('orders the job: posted < offers < working < review < paying < finished', () => {
    const ranks = [posted, offers, working, review, paying, finished].map(stageRank);
    expect(ranks).toEqual([10, 20, 30, 40, 45, 50]);
  });
  it('cancelled, archived, deleted and removed are "ended"', () => {
    for (const s of ['cancelled', 'archived', 'deleted', 'removed']) {
      expect(stageRank({ ...base, bountyStatus: s })).toBe('ended');
    }
  });
});

describe('checkStageMove: forward is always allowed', () => {
  it.each([
    ['posted → offers', posted, offers],
    ['offers → working (hired)', offers, working],
    ['working → review', working, review],
    ['review → paying', review, paying],
    ['paying → finished', paying, finished],
    ['review → finished', review, finished],
  ])('%s', (_label, prev, next) => {
    expect(checkStageMove(prev, next)).toMatchObject({ allowed: true, direction: 'forward' });
  });
});

describe('checkStageMove: the allowed backward moves', () => {
  it('cancelled / taken down / removed, from any stage', () => {
    for (const from of [offers, working, review, paying]) {
      for (const s of ['cancelled', 'deleted', 'archived']) {
        expect(checkStageMove(from, { ...from, bountyStatus: s })).toMatchObject({ allowed: true, reason: 'ended' });
      }
    }
  });
  it('work sent back (review → working)', () => {
    expect(checkStageMove(review, { ...working, submissionStatus: 'revision_requested' })).toMatchObject({
      allowed: true,
      direction: 'backward',
      reason: 'work_sent_back',
    });
  });
  it('a report opened (paused)', () => {
    // A stale submission plus a new dispute: the report is the real change.
    expect(checkStageMove(review, { ...working, hasDispute: true })).toMatchObject({ allowed: true, reason: 'report_opened' });
  });
  it('every offer withdrawn or expired (choosing → posted)', () => {
    expect(checkStageMove(offers, posted)).toMatchObject({ allowed: true, reason: 'offers_gone' });
  });
  it('the helper asks to stop during review', () => {
    const next: StageFacts = { ...review, bountyStatus: 'cancellation_requested', submissionStatus: null, hasCancellationRequest: true };
    expect(checkStageMove(review, next)).toMatchObject({ allowed: true, reason: 'cancellation_requested' });
  });
  it('a report or cancellation request closing shows the job again', () => {
    expect(checkStageMove({ ...review, hasDispute: true }, working)).toMatchObject({ allowed: true, reason: 'report_or_request_closed' });
    expect(checkStageMove({ ...review, hasCancellationRequest: true }, working)).toMatchObject({
      allowed: true,
      reason: 'report_or_request_closed',
    });
  });
});

describe('checkStageMove: every other backward move is refused', () => {
  it.each([
    ['review → working (submission vanished: a stale read)', review, working],
    ['paying → review (stale submission after approval)', paying, review],
    ['paying → working (the audit\'s "Work underway" after Yes, pay)', paying, working],
    ['finished → paying', finished, paying],
    ['finished → working', finished, working],
    ['working → offers', working, offers],
    ['ended → working', { ...working, bountyStatus: 'cancelled' }, working],
  ])('%s', (_label, prev, next) => {
    expect(checkStageMove(prev, next)).toMatchObject({ allowed: false, direction: 'backward' });
  });
});
