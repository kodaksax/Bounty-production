/**
 * buildMyJobs: which records become jobs vs offers, and what each job says.
 */
import { buildHireWelcomeMessage } from '../../../lib/my-jobs/hire-message';
import { calculateHunterEarnings } from '../../../lib/constants/fees';
import { buildMyJobs, groupOffers } from '../../../lib/my-jobs/build-my-jobs';
import { formatJobAmount } from '../../../lib/my-jobs/format';
import { JOB_RANK } from '../../../lib/my-jobs/types';
import { bounty, conversation, makeInput, ME, request, submission } from './fixtures';

const POSTER = 'poster-9';

describe('buildMyJobs — jobs you posted', () => {
  it('an open job with offers: "N people want to help", opens Who offered', () => {
    const b = bounty({ id: 'b1', title: 'Clear old furniture out of my garage' });
    const offers = [
      request({ bounty: b, hunter_id: 'h1', created_at: '2026-11-18T09:00:00Z' }),
      request({ bounty: b, hunter_id: 'h2', created_at: '2026-11-21T08:00:00Z' }),
      request({ bounty: b, hunter_id: 'h3', created_at: '2026-11-19T09:00:00Z' }),
    ];
    const { jobs } = buildMyJobs(
      makeInput({ postedBounties: [b], pendingApplicationsByBounty: new Map([['b1', offers]]) })
    );
    const [job] = jobs;
    expect(job.side).toBe('posted');
    expect(job.rank).toBe(JOB_RANK.newOffers);
    expect(job.needsYou).toBe(true);
    expect(job.status.text).toBe('3 people want to help');
    expect(job.detail).toContain('You only pay when you choose.');
    expect(job.cta).toEqual({ label: 'Review the 3 people', target: { kind: 'workspace', side: 'posted', bountyId: 'b1' } });
    expect(job.pendingOfferCount).toBe(3);
    // Waited longest = the first offer.
    expect(job.attentionSince).toBe('2026-11-18T09:00:00Z');
    expect(job.historyLine).toBe('Posted Monday · newest offer today');
    expect(job.contextLine).toBe('Posted Monday · $60');
  });

  it('a single offer reads in the singular', () => {
    const b = bounty({ id: 'b1' });
    const { jobs } = buildMyJobs(
      makeInput({ postedBounties: [b], pendingApplicationsByBounty: new Map([['b1', [request({ bounty: b, hunter_id: 'h1' })]]]) })
    );
    expect(jobs[0].status.text).toBe('1 person wants to help');
    expect(jobs[0].cta.label).toBe('Review the offer');
  });

  it('a job paid at posting does not claim "you only pay when you choose"', () => {
    const b = bounty({ id: 'b1', funding_mode: 'at_post' });
    const { jobs } = buildMyJobs(
      makeInput({ postedBounties: [b], pendingApplicationsByBounty: new Map([['b1', [request({ bounty: b, hunter_id: 'h1' })]]]) })
    );
    expect(jobs[0].detail).not.toContain('only pay when');
    expect(jobs[0].detail).toContain('already held by Bounty');
  });

  it('an open job with no offers is "Waiting for offers" and does not need you', () => {
    const { jobs } = buildMyJobs(makeInput({ postedBounties: [bounty({ id: 'b1' })] }));
    expect(jobs[0].status.text).toBe('Waiting for offers');
    expect(jobs[0].needsYou).toBe(false);
    expect(jobs[0].rank).toBe(JOB_RANK.waiting);
    expect(jobs[0].cta.target).toEqual({ kind: 'workspace', side: 'posted', bountyId: 'b1' });
  });

  it('work waiting for review names the helper and goes to the workspace', () => {
    const b = bounty({ id: 'b1', status: 'in_progress', accepted_by: 'ada' });
    const input = makeInput({
      postedBounties: [b],
      conversations: [conversation({ id: 'c1', bountyId: 'b1', name: 'Ada R.', participantIds: [ME, 'ada'] })],
      getSubmission: () =>
        submission({
          bounty_id: 'b1',
          hunter_id: 'ada',
          proof_items: [
            { id: 'p1', type: 'image', name: 'a' },
            { id: 'p2', type: 'image', name: 'b' },
            { id: 'p3', type: 'image', name: 'c' },
          ],
        }),
    });
    const [job] = buildMyJobs(input).jobs;
    expect(job.rank).toBe(JOB_RANK.waitingOnYou);
    expect(job.status.text).toBe('Ada says the job is done');
    expect(job.detail).toBe('Ada sent a note and 3 photos. Check the work, then decide about payment.');
    expect(job.cta).toEqual({ label: 'Review the completed work', target: { kind: 'workspace', side: 'posted', bountyId: 'b1' } });
    expect(job.contextLine).toBe('Ada is your helper · $60');
  });

  it('a hired job with an unread message becomes "X sent you a message"', () => {
    const b = bounty({ id: 'b1', status: 'in_progress', accepted_by: 'lee' });
    const [job] = buildMyJobs(
      makeInput({
        postedBounties: [b],
        conversations: [
          conversation({ id: 'c1', bountyId: 'b1', name: 'Lee', participantIds: [ME, 'lee'], unread: 2, lastMessage: 'Thursday after 4?' }),
        ],
      })
    ).jobs;
    expect(job.rank).toBe(JOB_RANK.newMessage);
    expect(job.status.text).toBe('Lee sent you a message');
    expect(job.detail).toBe('“Thursday after 4?”');
    expect(job.cta).toEqual({
      label: 'Reply to Lee',
      target: { kind: 'thread', side: 'posted', bountyId: 'b1', withId: 'lee' },
    });
  });

  it('keeps completed and cancelled jobs, last and not needing you', () => {
    const { jobs } = buildMyJobs(
      makeInput({
        postedBounties: [
          bounty({ id: 'done', status: 'completed', accepted_by: 'ada' }),
          bounty({ id: 'gone', status: 'cancelled' }),
          bounty({ id: 'live' }),
        ],
      })
    );
    expect(jobs.map((j) => j.bountyId)).toEqual(['live', expect.any(String), expect.any(String)]);
    const finished = jobs.filter((j) => j.finished);
    expect(finished).toHaveLength(2);
    expect(finished.every((j) => j.rank === JOB_RANK.finished && !j.needsYou)).toBe(true);
  });

  it("reads naturally when the helper's name is not known", () => {
    const working = bounty({ id: 'w', status: 'in_progress', accepted_by: 'ada' });
    const done = bounty({ id: 'd', status: 'completed', accepted_by: 'ada' });
    const { jobs } = buildMyJobs(
      makeInput({
        postedBounties: [working, done],
        conversations: [conversation({ id: 'c', bountyId: 'w', name: 'Unknown', participantIds: [ME, 'ada'], lastMessage: 'Saturday at 9' })],
      })
    );
    const byId = Object.fromEntries(jobs.map((j) => [j.bountyId, j]));
    expect(byId.w.contextLine).toBe('You chose a helper · $60');
    expect(byId.w.status.text).toBe('Your helper is working on it');
    expect(byId.d.status.text).toBe('Released to your helper');
  });

  it('a cancellation request outranks everything', () => {
    const { jobs } = buildMyJobs(
      makeInput({ postedBounties: [bounty({ id: 'b1', status: 'cancellation_requested', accepted_by: 'ada' })] })
    );
    expect(jobs[0].rank).toBe(JOB_RANK.problem);
    expect(jobs[0].status.tone).toBe('warning');
  });

  it('an honor job never mentions money held', () => {
    const b = bounty({ id: 'b1', status: 'in_progress', accepted_by: 'ada', is_for_honor: true });
    const [job] = buildMyJobs(makeInput({ postedBounties: [b] })).jobs;
    expect(job.contextLine).toContain('For honor');
    expect(job.detail).not.toMatch(/\$/);
  });
});

describe('buildMyJobs — work you are doing and offers', () => {
  const tv = bounty({
    id: 'tv',
    title: 'Mount a TV on the living room wall',
    amount: 80,
    poster_id: POSTER,
    username: 'Jordan K.',
    status: 'in_progress',
    accepted_by: ME,
  });

  it('just chosen: the work starts straight away, no messages needed', () => {
    const [job] = buildMyJobs(
      makeInput({
        hunterRequests: [request({ bounty: tv, status: 'accepted', created_at: '2026-11-17T10:00:00Z', updated_at: '2026-11-21T08:00:00Z' })],
      })
    ).jobs;
    expect(job.side).toBe('doing');
    expect(job.rank).toBe(JOB_RANK.working);
    expect(job.status.text).toBe("You're doing this job");
    // Take-home is the shared fee math, never a hard-coded percentage.
    expect(job.contextLine).toBe(`Jordan K. · you get ${formatJobAmount(calculateHunterEarnings(80).net)}`);
    expect(job.cta).toEqual({ label: "Tell Jordan it's done", target: { kind: 'workspace', side: 'doing', bountyId: 'tv' } });
    expect(job.historyLine).toBe('You offered Tuesday · chosen today');
  });

  it('a job the poster hired for is work underway, messages or not', () => {
    const b = bounty({ id: 'b1', status: 'in_progress', accepted_by: 'ada' });
    const job = (lastMessage: string) =>
      buildMyJobs(
        makeInput({
          postedBounties: [b],
          conversations: [conversation({ id: 'c1', bountyId: 'b1', name: 'Ada R.', participantIds: [ME, 'ada'], lastMessage })],
        })
      ).jobs[0];
    expect(job(buildHireWelcomeMessage('Garage')).status.text).toBe('Ada is working on it');
    expect(job('Saturday at 9').status.text).toBe('Ada is working on it');
  });

  it('once they have talked, the job is work happening', () => {
    const [job] = buildMyJobs(
      makeInput({
        hunterRequests: [request({ bounty: tv, status: 'accepted' })],
        conversations: [conversation({ id: 'c', bountyId: 'tv', participantIds: [ME, POSTER], lastMessage: 'Saturday at 10' })],
      })
    ).jobs;
    expect(job.rank).toBe(JOB_RANK.working);
    expect(job.needsYou).toBe(false);
    expect(job.cta).toEqual({ label: "Tell Jordan it's done", target: { kind: 'workspace', side: 'doing', bountyId: 'tv' } });
  });

  it('work sent: waiting on Jordan, and never says paid', () => {
    const [job] = buildMyJobs(
      makeInput({
        hunterRequests: [request({ bounty: tv, status: 'accepted' })],
        getSubmission: () => submission({ bounty_id: 'tv', hunter_id: ME }),
      })
    ).jobs;
    expect(job.status.text).toBe('Jordan is checking your work');
    expect(job.detail).toMatch(/^Not paid yet\./);
    expect(job.rank).toBe(JOB_RANK.waiting);
  });

  it('a change requested quotes the poster and needs you', () => {
    const [job] = buildMyJobs(
      makeInput({
        hunterRequests: [request({ bounty: tv, status: 'accepted' })],
        getSubmission: () =>
          submission({ bounty_id: 'tv', hunter_id: ME, status: 'revision_requested', poster_feedback: 'Move it 5 cm left' }),
      })
    ).jobs;
    expect(job.rank).toBe(JOB_RANK.waitingOnYou);
    expect(job.status.text).toBe('Jordan asked for a change');
    expect(job.detail).toContain('“Move it 5 cm left”');
    expect(job.cta.label).toBe('Send updated work');
  });

  it('a paid job says what you earned', () => {
    const paid = { ...tv, status: 'completed' } as typeof tv;
    const [job] = buildMyJobs(makeInput({ hunterRequests: [request({ bounty: paid, status: 'accepted' })] })).jobs;
    expect(job.finished).toBe(true);
    expect(job.rank).toBe(JOB_RANK.finished);
  });

  it('pending, rejected and expired applications are offers, never jobs', () => {
    const open = bounty({ id: 'wardrobe', poster_id: 'sofia', username: 'Sofia L.', amount: 50 });
    const sofa = bounty({ id: 'sofa', poster_id: 'dan', username: 'Dan P.', status: 'in_progress', accepted_by: 'someone-else' });
    const shelves = bounty({ id: 'shelves', poster_id: 'kim', username: 'Kim T.' });
    const model = buildMyJobs(
      makeInput({
        hunterRequests: [
          request({ bounty: open, created_at: '2026-11-19T10:00:00Z' }),
          request({ bounty: sofa, status: 'rejected', rejection_source: 'poster' }),
          request({ bounty: shelves, status: 'rejected', rejection_source: 'system_expiry' }),
        ],
      })
    );
    expect(model.jobs).toHaveLength(0);
    const groups = groupOffers(model.offers);
    expect(groups.waiting.map((o) => o.bountyId)).toEqual(['wardrobe']);
    expect(groups.waiting[0].statusText).toBe("Sofia hasn't chosen yet");
    expect(groups.waiting[0].subtitle).toBe('Sofia L. · sent Thursday');
    expect(groups.waiting[0].detail).toMatch(/^Nothing is held\./);
    const closed = Object.fromEntries(groups.not_going_ahead.map((o) => [o.bountyId, o.statusText]));
    expect(closed).toEqual({ sofa: 'Dan chose someone else', shelves: 'Closed: no answer in time' });
  });

  it('a pending offer on a job someone else got is "not going ahead"', () => {
    const taken = bounty({ id: 'fence', poster_id: 'kim', username: 'Kim', status: 'in_progress', accepted_by: 'other' });
    const { offers, jobs } = buildMyJobs(makeInput({ hunterRequests: [request({ bounty: taken })] }));
    expect(jobs).toHaveLength(0);
    expect(offers[0].status).toBe('not_going_ahead');
  });

  it('a job you were chosen for also lists under Chosen in your offers', () => {
    const { offers } = buildMyJobs(makeInput({ hunterRequests: [request({ bounty: tv, status: 'accepted' })] }));
    expect(groupOffers(offers).chosen).toEqual([
      expect.objectContaining({ bountyId: 'tv', statusText: 'Jordan chose you' }),
    ]);
  });

  it('skips hidden bounties, duplicates and your own postings', () => {
    const own = bounty({ id: 'own' });
    const hidden = bounty({ id: 'hidden', poster_id: 'x' });
    const dup = bounty({ id: 'dup', poster_id: 'y' });
    const model = buildMyJobs(
      makeInput({
        postedBounties: [own],
        hiddenBountyIds: new Set(['hidden']),
        hunterRequests: [
          request({ bounty: own }),
          request({ bounty: hidden }),
          request({ bounty: dup, id: 'r1' }),
          request({ bounty: dup, id: 'r2' }),
        ],
      })
    );
    expect(model.offers.map((o) => o.bountyId)).toEqual(['dup']);
    expect(model.jobs.map((j) => j.key)).toEqual(['posted:own']);
  });
});

describe('buildMyJobs — ordering', () => {
  it('sorts by rank, then whoever waited longest', () => {
    const older = bounty({ id: 'older' });
    const newer = bounty({ id: 'newer' });
    const quiet = bounty({ id: 'quiet' });
    const { jobs } = buildMyJobs(
      makeInput({
        postedBounties: [quiet, newer, older],
        pendingApplicationsByBounty: new Map([
          ['newer', [request({ bounty: newer, hunter_id: 'h', created_at: '2026-11-20T00:00:00Z' })]],
          ['older', [request({ bounty: older, hunter_id: 'h', created_at: '2026-11-18T00:00:00Z' })]],
        ]),
      })
    );
    expect(jobs.map((j) => j.bountyId)).toEqual(['older', 'newer', 'quiet']);
  });
});
