/**
 * E2E-01: after "Yes, pay" the job page read "Step 3 of 5 · Work underway"
 * for about six seconds, then "Finished". approveSubmission writes the
 * submission (approved) before the job row (completed), and the page showed
 * that gap as working.
 *
 * "Paying" is now a stage of its own, decided in the pure resolver: the
 * submission is approved and the job row doesn't say completed yet. These
 * tests cover the resolver, both sides' stage copy, the My Jobs cards, the
 * ten-second "We're confirming the payment" fallback, and the jargon rules
 * for every one of those states.
 */
import { act, renderHook } from '@testing-library/react-native';
import { calculateHunterEarnings } from '../../../lib/constants/fees';
import { buildMyJobs } from '../../../lib/my-jobs/build-my-jobs';
import { resolveBountyLifecycle, isPayingState } from '../../../lib/utils/bounty-lifecycle';
import { describeHunterStage } from '../../../lib/utils/hunter-stage-copy';
import { describePosterStage } from '../../../lib/utils/poster-stage-copy';
import { PAYING_SLOW_AFTER_MS } from '../../../lib/utils/stage-progress';
import { usePayingSlow } from '../../../hooks/usePayingSlow';
import { bounty as jobRow, makeInput, ME, request, submission } from '../my-jobs/fixtures';

const NOW = new Date('2026-11-24T12:00:00Z');
const job = { id: 'b1', status: 'in_progress', amount: 25, is_for_honor: false, accepted_by: 'h1', poster_id: 'p1' } as any;
const NET = `$${calculateHunterEarnings(25).net}`;

/** User-facing words the standards rule out (job, helper, offer, "with Bounty"). */
const JARGON = /\b(hunters?|escrow|payouts?|apply|applied|applicants?|ACH|Connect|onboarding|disputes?)\b|\bbounty\b/;

function poster(submissionStatus: string | null, status = 'in_progress') {
  return resolveBountyLifecycle({
    bounty: { ...job, status },
    role: 'poster',
    viewerId: 'p1',
    submissionStatus,
    otherPartyName: 'Ana',
    now: NOW,
  });
}
function helper(submissionStatus: string | null, status = 'in_progress', viewerId = 'h1') {
  return resolveBountyLifecycle({
    bounty: { ...job, status },
    role: 'hunter',
    viewerId,
    requestStatus: viewerId === 'h1' ? 'accepted' : 'pending',
    submissionStatus,
    submissionIsMine: viewerId === 'h1',
    otherPartyName: 'Lee',
    now: NOW,
  });
}

describe('the resolver decides "paying"', () => {
  it('approved work on a job not yet completed is paying, for both sides', () => {
    expect(isPayingState({ status: 'in_progress' }, 'approved')).toBe(true);
    expect(poster('approved').paying).toBe(true);
    expect(helper('approved').paying).toBe(true);
  });
  it('is not paying once the job reads completed, before approval, or for someone not chosen', () => {
    expect(poster('approved', 'completed').paying).toBeFalsy();
    expect(poster('pending').paying).toBeFalsy();
    expect(poster(null).paying).toBeFalsy();
    expect(helper('approved', 'in_progress', 'someone-else').paying).toBeFalsy();
    expect(isPayingState({ status: 'cancelled' }, 'approved')).toBe(false);
  });
  it('offers nothing to do while paying', () => {
    expect(poster('approved').primaryAction).toBeNull();
    expect(helper('approved').primaryAction).toBeNull();
  });
});

function posterView(payingSlow = false, honor = false) {
  return describePosterStage({
    bounty: { ...job, is_for_honor: honor },
    lifecycle: poster('approved'),
    helperName: 'Ana',
    applicantCount: 0,
    submission: { status: 'approved' },
    hasDispute: false,
    openJobCharge: null,
    payingSlow,
    now: NOW,
  });
}
function helperView(payingSlow = false) {
  return describeHunterStage({
    bounty: job,
    lifecycle: helper('approved'),
    posterName: 'Lee',
    requestStatus: 'accepted',
    submission: { status: 'approved' },
    hasDispute: false,
    payingSlow,
  });
}

describe('poster: "Paying Ana…", never working', () => {
  it('says it is paying, on step 5, with the money as the server has it', () => {
    const v = posterView();
    expect(v.screenId).toBe('I.2');
    expect(v.now).toBe('Paying Ana…');
    expect(v.step).toBe(5);
    expect(v.stage).toBe('Step 5 of 5 · Paying Ana');
    expect(v.money).toEqual({ kind: 'held', text: 'Bounty is releasing your $25 to Ana.' });
    expect(v.primary).toMatchObject({ key: 'back_to_jobs' });
    expect(JSON.stringify(v)).not.toMatch(/Work underway|working/i);
  });
  it('after ten seconds: "We\'re confirming the payment", never an error', () => {
    const v = posterView(true);
    expect(v.now).toBe("We're confirming the payment.");
    expect(v.money?.kind).toBe('held');
    expect(JSON.stringify(v)).not.toMatch(/couldn't|failed|error|try again/i);
  });
});

describe('helper: "Lee approved your work. Your $X is on its way."', () => {
  it('uses the take-home from hunterMoney', () => {
    const v = helperView();
    expect(v.now).toBe('Lee approved your work.');
    expect(v.means).toBe(`Your ${NET} is on its way.`);
    expect(v.stage).toBe('Step 5 of 5 · Payment on its way');
    expect(JSON.stringify(v)).not.toMatch(/Doing the work|on the clock/i);
  });
  it('after ten seconds says it is confirming', () => {
    expect(helperView(true).now).toBe("We're confirming the payment.");
  });
});

describe('My Jobs cards say the same', () => {
  it('poster card: "Paying Ana"; helper card: "Lee approved your work"', () => {
    const posted = jobRow({ id: 'p1', status: 'in_progress', accepted_by: 'h1', amount: 25 });
    const doing = jobRow({ id: 'd1', status: 'in_progress', accepted_by: ME, poster_id: 'lee', amount: 25, username: 'Lee' } as any);
    const subs = new Map([
      ['p1', submission({ bounty_id: 'p1', status: 'approved', hunter_id: 'h1' })],
      ['d1', submission({ bounty_id: 'd1', status: 'approved', hunter_id: ME })],
    ]);
    const input = makeInput({
      postedBounties: [posted],
      hunterRequests: [request({ bounty: doing, status: 'accepted' })],
      conversations: [{ id: 'c1', isGroup: false, name: 'Ana', participantIds: [ME, 'h1'], bountyId: 'p1' } as any],
    });
    input.getSubmission = (id) => subs.get(id);
    const model = buildMyJobs(input);
    const postedCard = model.jobs.find((j) => j.bountyId === 'p1')!;
    const doingCard = model.jobs.find((j) => j.bountyId === 'd1')!;
    expect(postedCard.status.text).toBe('Paying Ana');
    expect(doingCard.status.text).toBe('Lee approved your work');
    expect(doingCard.detail).toBe(`Your ${NET} is on its way.`);
    for (const card of [postedCard, doingCard]) {
      expect(`${card.status.text} ${card.detail}`).not.toMatch(/working|Doing the work/i);
      expect(`${card.status.text} ${card.detail} ${card.cta.label}`).not.toMatch(JARGON);
    }
  });
});

describe('jargon: every paying state reads in plain words', () => {
  it.each([
    ['poster paying', posterView()],
    ['poster confirming', posterView(true)],
    ['poster paying, for honor', posterView(false, true)],
    ['helper paying', helperView()],
    ['helper confirming', helperView(true)],
  ])('%s', (_label, v) => {
    const text = [v.stage, v.now, v.means, v.money?.text, v.after, v.primary?.label].filter(Boolean).join(' ');
    expect(text).not.toMatch(JARGON);
  });
});

describe('usePayingSlow: ten seconds, and refreshes cannot reset it', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('turns on after PAYING_SLOW_AFTER_MS of paying', () => {
    const { result } = renderHook(({ paying }) => usePayingSlow(paying, 'b1'), { initialProps: { paying: true } });
    expect(result.current).toBe(false);
    act(() => jest.advanceTimersByTime(PAYING_SLOW_AFTER_MS - 1));
    expect(result.current).toBe(false);
    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('re-renders while still paying (the rating sheet opening or closing) keep the clock', () => {
    const { result, rerender } = renderHook(({ paying, n }) => usePayingSlow(paying, 'b1') && n >= 0, {
      initialProps: { paying: true, n: 0 },
    });
    act(() => jest.advanceTimersByTime(6_000));
    rerender({ paying: true, n: 1 });
    rerender({ paying: true, n: 2 });
    act(() => jest.advanceTimersByTime(4_000));
    expect(result.current).toBe(true);
  });

  it('leaving the paying stage clears it', () => {
    const { result, rerender } = renderHook(({ paying }) => usePayingSlow(paying, 'b1'), { initialProps: { paying: true } });
    act(() => jest.advanceTimersByTime(PAYING_SLOW_AFTER_MS));
    expect(result.current).toBe(true);
    rerender({ paying: false });
    expect(result.current).toBe(false);
  });
});
