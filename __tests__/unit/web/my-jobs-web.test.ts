/**
 * The website's My jobs and thread payloads (lib/web), which the web-account
 * Edge Function serves to bountyfinder.net/bounty. They must say what the
 * app's My jobs tab and job thread say for the same records, and carry names
 * and ids only.
 */
import { assembleWebMyJobs, webHref, type WebMyJobsRows } from '../../../lib/web/my-jobs-web';
import { describeWebThread } from '../../../lib/web/thread-web';
import { buildMyJobs } from '../../../lib/my-jobs/build-my-jobs';
import { ME, NOW, bounty, conversation, makeInput, request, submission } from '../my-jobs/fixtures';

function rows(over: Partial<WebMyJobsRows> = {}): WebMyJobsRows {
  return {
    viewerId: ME,
    posted: [],
    hunterRequests: [],
    pendingApplications: [],
    submissions: [],
    disputedBountyIds: [],
    cancellations: [],
    conversations: [],
    holdsEscrow: {},
    now: NOW,
    ...over,
  };
}

const offered = bounty({ id: 'b-open', funding_mode: 'at_accept' } as any);
const applicant = (id: string, over: Record<string, unknown> = {}) =>
  request({
    bounty: offered,
    id: `req-${id}`,
    hunter_id: id,
    profile: { id, username: `Hunter ${id}` } as any,
    ...over,
  } as any);

describe('assembleWebMyJobs', () => {
  it('says exactly what the app says for the same records', () => {
    const pending = [applicant('h1'), applicant('h2')];
    const web = assembleWebMyJobs(rows({ posted: [offered], pendingApplications: pending }));
    const app = buildMyJobs(makeInput({
      postedBounties: [offered],
      pendingApplicationsByBounty: new Map([['b-open', pending]]),
    }));
    expect(web.jobs[0].status).toEqual(app.jobs[0].status);
    expect(web.jobs[0].detail).toBe(app.jobs[0].detail);
    expect(web.jobs[0].cta.label).toBe(app.jobs[0].cta.label);
    expect(web.jobs[0].context_line).toBe(app.jobs[0].contextLine);
    expect(web.featured_key).toBe('posted:b-open');
    expect(web.needs_you_count).toBe(1);
  });

  it('features what needs you most and keeps the rest in rank order', () => {
    const working = bounty({ id: 'b-work', status: 'in_progress', accepted_by: 'h9' });
    const review = bounty({ id: 'b-review', status: 'in_progress', accepted_by: 'h8' });
    const web = assembleWebMyJobs(rows({
      posted: [working, review],
      submissions: [submission({ bounty_id: 'b-review', hunter_id: 'h8' })],
      holdsEscrow: { 'b-work': true, 'b-review': true },
    }));
    expect(web.jobs.map((j) => j.bounty_id)).toEqual(['b-review', 'b-work']);
    expect(web.featured_key).toBe('posted:b-review');
    expect(web.jobs[0].cta).toEqual({ label: 'Review the completed work', href: '/bounty?id=b-review', opens: 'page' });
  });

  it('remembers a pick until something new outranks it', () => {
    const working = bounty({ id: 'b-work', status: 'in_progress', accepted_by: 'h9' });
    const quiet = bounty({ id: 'b-quiet' });
    const first = assembleWebMyJobs(rows({ posted: [working, quiet], pickKey: 'posted:b-quiet' }));
    expect(first.featured_key).toBe('posted:b-quiet');
    expect(first.featured_reason).toBe('manual');
    expect(first.pick?.key).toBe('posted:b-quiet');

    // Same records, pick sent back: still featured.
    const again = assembleWebMyJobs(rows({ posted: [working, quiet], pick: first.pick }));
    expect(again.featured_key).toBe('posted:b-quiet');

    // Work comes in for review: new urgency takes the slot back and the pick is dropped.
    const later = assembleWebMyJobs(rows({
      posted: [working, quiet],
      pick: first.pick,
      submissions: [submission({ bounty_id: 'b-work', hunter_id: 'h9' })],
    }));
    expect(later.featured_key).toBe('posted:b-work');
    expect(later.pick).toBeNull();
  });

  it('lists only the actions the website can do', () => {
    const web = assembleWebMyJobs(rows({ posted: [offered] }));
    expect(web.jobs[0].actions.map((a) => a.key)).toEqual(['take_down']);
    const done = assembleWebMyJobs(rows({ posted: [bounty({ id: 'b-done', status: 'completed', accepted_by: 'h1' })] }));
    expect(done.jobs[0].actions).toEqual([]); // archive is app-only
  });

  it('orders Who offered nearest first, with far-away people last', () => {
    const pending = [
      applicant('far', { distance_mi: 80, is_far: true }),
      applicant('near', { distance_mi: 2 }),
      applicant('unknown'),
    ];
    const web = assembleWebMyJobs(rows({ posted: [offered], pendingApplications: pending }));
    const people = web.jobs[0].applicants;
    expect(people.map((a) => a.person.id)).toEqual(['near', 'unknown', 'far']);
    expect(people[0]).toMatchObject({ distance_label: 'About 2 mi away', far: false, href: '/bounty?id=b-open&with=near' });
    expect(people[2].far).toBe(true);
  });

  it('groups the offers you sent, with one website action each', () => {
    const theirs = bounty({ id: 'b-theirs', poster_id: 'p1', username: 'Sofia Lee' } as any);
    const web = assembleWebMyJobs(rows({ hunterRequests: [request({ bounty: theirs })] }));
    expect(web.offers.waiting).toHaveLength(1);
    expect(web.offers.waiting[0]).toMatchObject({
      status_text: "Sofia hasn't chosen yet",
      action: { key: 'withdraw' },
      href: '/bounty?id=b-theirs',
    });
  });

  it('an unread message on a hired job is the next step, with the thread link', () => {
    const hired = bounty({ id: 'b-hired', status: 'in_progress', accepted_by: 'h1' });
    const web = assembleWebMyJobs(rows({
      posted: [hired],
      holdsEscrow: { 'b-hired': true },
      conversations: [conversation({ id: 'c1', participantIds: [ME, 'h1'], bountyId: 'b-hired', name: 'Jordan K', unread: 2, lastMessage: 'On my way' } as any)],
    }));
    expect(web.jobs[0].status.text).toBe('Jordan sent you a message');
    expect(web.jobs[0].cta.href).toBe('/bounty?id=b-hired&with=h1');
    expect(web.jobs[0].flag.text).toBe('New message');
    expect(web.total_unread).toBe(2);
  });

  it('never carries an email or phone number', () => {
    const pending = [applicant('h1', { profile: { id: 'h1', username: 'Jordan', email: 'j@example.com', phone: '+15555550100' } })];
    const json = JSON.stringify(assembleWebMyJobs(rows({ posted: [offered], pendingApplications: pending })));
    expect(json).not.toMatch(/@example\.com|5555550100/);
  });
});

describe('webHref', () => {
  it('names the hunter for a thread', () => {
    expect(webHref({ kind: 'thread', side: 'posted', bountyId: 'b1', withId: 'h1' })).toBe('/bounty?id=b1&with=h1');
    expect(webHref({ kind: 'workspace', side: 'doing', bountyId: 'b1' })).toBe('/bounty?id=b1');
  });
});

describe('describeWebThread', () => {
  const hired = { id: 'b1', status: 'in_progress', amount: 80, accepted_by: 'h1', created_at: '2026-11-20T10:00:00Z' };

  it('poster with work to review: the strip and a pinned step the website can take', () => {
    const v = describeWebThread({
      role: 'poster',
      viewerId: ME,
      bounty: hired,
      submission: { status: 'pending', hunter_id: 'h1', submitted_at: '2026-11-21T09:00:00Z' },
      counterpart: { id: 'h1', name: 'Jordan K' },
    });
    expect(v.strip.text).toBe('You posted this · $80 held by Bounty');
    expect(v.pinned).toMatchObject({
      mode: 'your_turn',
      label: 'YOUR NEXT STEP',
      button: 'Review the completed work',
      web_action: 'approve_release',
      app_only: false,
    });
  });

  it('hunter who still has to send the work: the step in words, no button the website can’t back', () => {
    const v = describeWebThread({
      role: 'hunter',
      viewerId: 'h1',
      bounty: { ...hired },
      request: { id: 'r1', status: 'accepted', hunter_id: 'h1' },
      counterpart: { id: ME, name: 'Sofia' },
    });
    expect(v.strip.text).toMatch(/^You're doing this/);
    expect(v.pinned).toMatchObject({ mode: 'your_turn', button: null, web_action: null, app_only: true });
  });

  it('poster waiting on the hunter: a waiting card without a button', () => {
    const v = describeWebThread({ role: 'poster', viewerId: ME, bounty: hired, counterpart: { id: 'h1', name: 'Jordan K' } });
    expect(v.pinned).toMatchObject({ mode: 'waiting', label: 'WAITING FOR JORDAN', button: null, app_only: false });
  });
});
