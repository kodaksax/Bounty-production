/**
 * The featured-job rule: priority, ties, the finished window, and manual
 * picks that hold until something new outranks them.
 */
import {
  bestJobOnSide,
  canAutoFeature,
  createManualPick,
  pickFeaturedJob,
  shouldShowSideLabels,
  sortJobs,
} from '../../../lib/my-jobs/featured-job';
import type { JobRank, MyJob, MyOffer } from '../../../lib/my-jobs/types';
import { JOB_RANK } from '../../../lib/my-jobs/types';

const NOW = new Date('2026-11-21T12:00:00Z');

function job(key: string, rank: JobRank, over: Partial<MyJob> = {}): MyJob {
  return {
    key,
    bountyId: key,
    side: 'posted',
    rank,
    finished: rank === JOB_RANK.finished,
    needsYou: rank <= JOB_RANK.newMessage,
    attentionSince: '2026-11-20T00:00:00Z',
    ...over,
  } as MyJob;
}

describe('sortJobs', () => {
  it('orders by rank, most urgent first', () => {
    const jobs = sortJobs([
      job('waiting', JOB_RANK.waiting),
      job('problem', JOB_RANK.problem),
      job('offers', JOB_RANK.newOffers),
      job('you', JOB_RANK.waitingOnYou),
      job('done', JOB_RANK.finished),
      job('msg', JOB_RANK.newMessage),
      job('work', JOB_RANK.working),
    ]);
    expect(jobs.map((j) => j.key)).toEqual(['problem', 'you', 'offers', 'msg', 'work', 'waiting', 'done']);
  });

  it('breaks ties by who has waited longest', () => {
    const jobs = sortJobs([
      job('later', JOB_RANK.newOffers, { attentionSince: '2026-11-20T00:00:00Z' }),
      job('earlier', JOB_RANK.newOffers, { attentionSince: '2026-11-18T00:00:00Z' }),
      job('unknown', JOB_RANK.newOffers, { attentionSince: null }),
    ]);
    expect(jobs.map((j) => j.key)).toEqual(['earlier', 'later', 'unknown']);
  });

  it('puts an unknown wait after a known one, whatever the keys', () => {
    const jobs = sortJobs([
      job('a-unknown', JOB_RANK.newOffers, { attentionSince: null }),
      job('z-dated', JOB_RANK.newOffers, { attentionSince: '2026-11-20T00:00:00Z' }),
    ]);
    expect(jobs.map((j) => j.key)).toEqual(['z-dated', 'a-unknown']);
  });

  it('lists finished jobs most recent first', () => {
    const jobs = sortJobs([
      job('old', JOB_RANK.finished, { attentionSince: '2026-10-01T00:00:00Z' }),
      job('recent', JOB_RANK.finished, { attentionSince: '2026-11-20T00:00:00Z' }),
    ]);
    expect(jobs.map((j) => j.key)).toEqual(['recent', 'old']);
  });
});

describe('canAutoFeature', () => {
  it('features a finished job only for 7 days', () => {
    expect(canAutoFeature(job('a', JOB_RANK.finished, { attentionSince: '2026-11-16T00:00:00Z' }), NOW)).toBe(true);
    expect(canAutoFeature(job('b', JOB_RANK.finished, { attentionSince: '2026-11-01T00:00:00Z' }), NOW)).toBe(false);
    expect(canAutoFeature(job('c', JOB_RANK.waiting), NOW)).toBe(true);
  });
});

describe('pickFeaturedJob', () => {
  const garage = job('garage', JOB_RANK.newOffers)
  const door = job('door', JOB_RANK.newMessage)
  const leaves = job('leaves', JOB_RANK.waiting)
  const jobs = sortJobs([leaves, door, garage]);

  it('picks the most urgent job automatically', () => {
    expect(pickFeaturedJob(jobs, null, NOW)).toEqual({ job: garage, reason: 'auto' });
  });

  it('keeps a manual pick even though a known job outranks it', () => {
    const pick = createManualPick(jobs, 'door');
    expect(pick).toEqual({ key: 'door', outranking: ['garage:3'] });
    expect(pickFeaturedJob(jobs, pick, NOW)).toEqual({ job: door, reason: 'manual' });
  });

  it('lets something new and more urgent take over', () => {
    const pick = createManualPick(jobs, 'leaves');
    const escalated = sortJobs([leaves, door, job('garage', JOB_RANK.waitingOnYou)]);
    // garage moved from rank 3 to 2: that is a new event.
    expect(pickFeaturedJob(escalated, pick, NOW)?.job.key).toBe('garage');
    const newJob = sortJobs([...jobs, job('tv', JOB_RANK.problem)]);
    expect(pickFeaturedJob(newJob, pick, NOW)?.job.key).toBe('tv');
  });

  it('a known job calming down but still outranking does not take over', () => {
    // Picked rank 6 while another job was rank 2; it drops to 3, still above the pick.
    const urgent = job('urgent', JOB_RANK.waitingOnYou);
    const quiet = job('quiet', JOB_RANK.waiting);
    const pick = createManualPick(sortJobs([urgent, quiet]), 'quiet');
    const calmer = sortJobs([job('urgent', JOB_RANK.newOffers), quiet]);
    expect(pickFeaturedJob(calmer, pick, NOW)).toEqual({ job: quiet, reason: 'manual' });
    // …but the same job becoming *more* urgent than recorded does.
    const worse = sortJobs([job('urgent', JOB_RANK.problem), quiet]);
    expect(pickFeaturedJob(worse, pick, NOW)?.job.key).toBe('urgent');
  });

  it('a job becoming less urgent does not override the pick', () => {
    const pick = createManualPick(jobs, 'leaves');
    const calmer = sortJobs([leaves, job('door', JOB_RANK.waiting), garage]);
    expect(pickFeaturedJob(calmer, pick, NOW)).toEqual({ job: leaves, reason: 'manual' });
  });

  it('falls back to the automatic choice when the pick is gone', () => {
    expect(pickFeaturedJob(jobs, { key: 'deleted', outranking: [] }, NOW)?.reason).toBe('auto');
  });

  it('returns null when only old finished jobs remain', () => {
    expect(pickFeaturedJob([job('old', JOB_RANK.finished, { attentionSince: '2026-09-01T00:00:00Z' })], null, NOW)).toBeNull();
  });

  it('createManualPick returns null for an unknown job', () => {
    expect(createManualPick(jobs, 'nope')).toBeNull();
  });
});

describe('bestJobOnSide / shouldShowSideLabels', () => {
  const posted = job('p', JOB_RANK.waiting, { side: 'posted' });
  const doing = job('d', JOB_RANK.working, { side: 'doing' });

  it('finds the first job on a side', () => {
    expect(bestJobOnSide([posted, doing], 'doing')).toBe(doing);
    expect(bestJobOnSide([posted], 'doing')).toBeNull();
  });

  it('shows side labels only with jobs on both sides', () => {
    expect(shouldShowSideLabels([posted])).toBe(false);
    expect(shouldShowSideLabels([doing])).toBe(false);
    expect(shouldShowSideLabels([posted, doing])).toBe(true);
    expect(shouldShowSideLabels([posted], [{ key: 'o' } as MyOffer])).toBe(true);
  });
});
