/**
 * The poster job page's plain-language layer (lib/utils/poster-plain-copy.ts).
 *
 * Three rules are pinned here because breaking any of them misleads a poster:
 *   1. Money: nothing is said to be held, paid or released unless the money
 *      state the page verified says so.
 *   2. Words: no marketplace jargon in anything a poster reads.
 *   3. Silence: "Haven't heard from …" only after a known hire time and a
 *      successful message read; an unknown is never treated as quiet.
 */
import {
  buildPosterTimeline,
  derivePosterMoney,
  describePosterMoney,
  formatAgo,
  isHelperQuiet,
  posterNextStep,
  QUIET_HELPER_HOURS,
  type PosterMoneyState,
  type PosterNextStepInput,
} from '../../lib/utils/poster-plain-copy';
import type { BountyDisplayStatus } from '../../lib/utils/bounty-display-status';

const NOW = new Date('2026-11-16T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

function step(over: Partial<PosterNextStepInput> = {}) {
  return posterNextStep({
    status: 'open',
    hasDispute: false,
    hasCancellationRequest: false,
    posterMustAnswerCancellation: false,
    offerCount: 0,
    helperName: null,
    hired: false,
    amount: 60,
    isForHonor: false,
    money: 'not_charged',
    now: NOW,
    ...over,
  });
}

// "Bounty" (capital B) is the company; lowercase "bounty" for a job is jargon.
const JARGON = /\b(hunters?|escrow|payouts?|applicants?|applications?|dispute)\b/i;
const JOB_AS_BOUNTY = /\bbount(y|ies)\b/;

describe('money sentence', () => {
  it.each<PosterMoneyState>(['not_charged', 'checking', 'unknown'])(
    '%s never claims the money is held, paid or released',
    money => {
      for (const offerCount of [0, 3]) {
        const line = step({ money, offerCount }).money ?? '';
        expect(line).not.toMatch(/holding|holds|held|released|on its way|already paid/i);
      }
    }
  );

  it('unpaid with offers says nothing has been paid and the amount comes first', () => {
    expect(step({ money: 'not_charged', offerCount: 3 }).money).toBe(
      "You haven't paid anything yet. When you choose someone, you'll see the exact amount before you pay."
    );
  });

  it('held before anyone is chosen says it was already paid, naming nobody', () => {
    const line = step({ money: 'held', offerCount: 2 }).money!;
    expect(line).toBe("You've already paid $60. Bounty holds it until you approve the finished work.");
  });

  it('held after hiring names the chosen person, exactly as written', () => {
    const line = step({ status: 'in_progress', hired: true, helperName: 'ana_hunts', money: 'held' }).money;
    expect(line).toBe('Bounty is holding your $60. ana_hunts is paid only after you approve the work.');
  });

  it('awaiting approval says approving pays and cannot be undone', () => {
    const line = step({ status: 'review_needed', hired: true, helperName: 'Marcus', money: 'held' }).money;
    expect(line).toMatch(/Nothing is paid until you approve/);
    expect(line).toMatch(/can't be undone/);
  });

  it('a dispute says nobody is paid while it is looked into', () => {
    const line = step({ status: 'in_progress', hired: true, helperName: 'Marcus', money: 'held', hasDispute: true }).money;
    expect(line).toMatch(/Nobody is paid in the meantime/);
  });

  it('releasing vs released are different sentences', () => {
    expect(step({ status: 'completed', hired: true, helperName: 'Marcus', money: 'releasing' }).money).toBe(
      'You approved the work. Your $60 is on its way to Marcus.'
    );
    expect(step({ status: 'completed', hired: true, helperName: 'Marcus', money: 'released' }).money).toBe(
      'Your $60 was released to Marcus.'
    );
  });

  it('an unpaid favour has no money sentence at all', () => {
    expect(step({ isForHonor: true, amount: 0, money: 'none' }).money).toBeNull();
  });
});

describe('derivePosterMoney', () => {
  const base = { is_for_honor: false, amount: 60, status: 'open' };

  it('an open job uses only the server read, never the status-based guard', () => {
    // bountyHoldsUnreleasedEscrow says "held" for every open paid job; the
    // server read is what decides.
    expect(derivePosterMoney({ bounty: base, openJobCharge: 'not_charged' })).toBe('not_charged');
    expect(derivePosterMoney({ bounty: base, openJobCharge: 'unknown' })).toBe('unknown');
    expect(derivePosterMoney({ bounty: base, openJobCharge: 'checking' })).toBe('checking');
  });

  it('after hiring, a v1 job in progress is held; completed is released', () => {
    expect(derivePosterMoney({ bounty: { ...base, status: 'in_progress' }, openJobCharge: null })).toBe('held');
    expect(derivePosterMoney({ bounty: { ...base, status: 'completed' }, openJobCharge: null })).toBe('released');
  });

  it('a Stripe-native job still settling after approval is "releasing", not "released"', () => {
    expect(
      derivePosterMoney({
        bounty: { ...base, status: 'completed', payment_architecture_version: 2, payment_status: 'release_pending' },
        openJobCharge: null,
      })
    ).toBe('releasing');
  });

  it('for honor / $0 / cancelled', () => {
    expect(derivePosterMoney({ bounty: { ...base, is_for_honor: true }, openJobCharge: null })).toBe('none');
    expect(derivePosterMoney({ bounty: { ...base, amount: 0 }, openJobCharge: null })).toBe('none');
    expect(derivePosterMoney({ bounty: { ...base, status: 'cancelled' }, openJobCharge: null })).toBe('cancelled');
  });
});

describe('no marketplace jargon in anything a poster reads', () => {
  const statuses: BountyDisplayStatus[] = [
    'open',
    'in_progress',
    'review_needed',
    'deadline_passed',
    'completed',
    'cancelled',
    'archived',
    'cancellation_requested',
  ];
  const monies: PosterMoneyState[] = ['none', 'checking', 'unknown', 'not_charged', 'held', 'releasing', 'released', 'cancelled'];

  it.each(statuses)('%s', status => {
    for (const money of monies) {
      for (const hired of [false, true]) {
        for (const hasDispute of [false, true]) {
          const s = step({ status, money, hired, hasDispute, helperName: hired ? 'Marcus' : null, offerCount: hired ? 0 : 2 });
          const text = [s.whoActsLabel, s.title, s.body, s.money, s.primary?.label, s.secondary?.label].join(' ');
          expect(text).not.toMatch(JARGON);
          expect(text).not.toMatch(JOB_AS_BOUNTY);
          expect(text).not.toMatch(JOB_AS_BOUNTY);
        }
      }
    }
  });
});

describe('who acts next and the one primary action', () => {
  it('offers waiting: your move, compare them', () => {
    const s = step({ offerCount: 3 });
    expect(s.whoActs).toBe('you');
    expect(s.title).toBe('3 people offered to help');
    expect(s.primary).toEqual({ key: 'choose', label: 'Compare the 3 offers' });
  });

  it('no offers yet: nothing to do, sharing is the optional extra', () => {
    const s = step();
    expect(s.whoActsLabel).toBe('Nothing to do right now');
    expect(s.primary).toBeNull();
    expect(s.secondary?.key).toBe('share');
  });

  it('hired: waiting on the person, and the primary action is to message them', () => {
    const s = step({ status: 'in_progress', hired: true, helperName: 'Marcus', money: 'held', hiredAt: hoursAgo(2) });
    expect(s.whoActsLabel).toBe('Waiting on Marcus');
    expect(s.primary).toEqual({ key: 'message', label: 'Message Marcus' });
  });

  it('work submitted: your move, check the work', () => {
    const s = step({ status: 'review_needed', hired: true, helperName: 'Marcus', money: 'held' });
    expect(s.whoActs).toBe('you');
    expect(s.primary?.key).toBe('check_work');
  });

  it('completed: a review for the named person', () => {
    expect(step({ status: 'completed', hired: true, helperName: 'Marcus', money: 'released' }).primary).toEqual({
      key: 'rate',
      label: 'Leave a review for Marcus',
    });
  });

  it('completed and already reviewed: thanks, and no second "Leave a review"', () => {
    const s = step({ status: 'completed', hired: true, helperName: 'Marcus', money: 'released', alreadyRated: true });
    expect(s.primary).toBeNull();
    expect(s.body).toMatch(/Thank you for leaving a review/);
    expect(s.secondary?.key).toBe('post_again');
  });

  it('the other side asked to cancel: the poster answers', () => {
    const s = step({ status: 'cancellation_requested', hasCancellationRequest: true, posterMustAnswerCancellation: true, hired: true, helperName: 'Marcus', money: 'held' });
    expect(s.primary?.key).toBe('answer_cancellation');
    expect(s.money).toMatch(/until the cancellation is settled/);
  });
});

describe('a quiet helper', () => {
  const quiet = (over: Partial<Parameters<typeof isHelperQuiet>[0]>) =>
    isHelperQuiet({ hired: true, hiredAt: hoursAgo(QUIET_HELPER_HOURS + 1), lastHelperMessageAt: null, messagesKnown: true, now: NOW, ...over });

  it('is quiet after the threshold with no message since the hire', () => {
    expect(quiet({})).toBe(true);
    expect(quiet({ lastHelperMessageAt: hoursAgo(QUIET_HELPER_HOURS + 30) })).toBe(true); // before the hire
  });

  it('is not quiet before the threshold, after a reply, or when anything is unknown', () => {
    expect(quiet({ hiredAt: hoursAgo(QUIET_HELPER_HOURS - 1) })).toBe(false);
    expect(quiet({ lastHelperMessageAt: hoursAgo(1) })).toBe(false);
    expect(quiet({ messagesKnown: false })).toBe(false);
    expect(quiet({ hiredAt: null })).toBe(false);
    expect(quiet({ hired: false })).toBe(false);
  });

  it('turns the card into "Haven\'t heard from …" with a way to tell Bounty', () => {
    const s = step({ status: 'in_progress', hired: true, helperName: 'Marcus', money: 'held', hiredAt: hoursAgo(72), lastHelperMessageAt: null, messagesKnown: true });
    expect(s.title).toBe("Haven't heard from Marcus?");
    expect(s.body).toContain('3 days ago');
    expect(s.primary?.key).toBe('message');
    expect(s.secondary).toEqual({ key: 'report_unresponsive', label: "Tell us Marcus hasn't replied" });
  });

  it('a failed message read keeps the ordinary card', () => {
    const s = step({ status: 'in_progress', hired: true, helperName: 'Marcus', money: 'held', hiredAt: hoursAgo(72), messagesKnown: false });
    expect(s.title).toBe('Marcus is doing the job');
  });
});

describe('timeline: only what happened', () => {
  const base = {
    postedAt: hoursAgo(100),
    offers: null as { createdAt: string }[] | null,
    hired: false,
    helperName: null as string | null,
    hiredAt: null as string | null,
    fundingMode: 'at_accept',
    amount: 60,
    isForHonor: false,
    money: 'not_charged' as PosterMoneyState,
    submission: null,
    hasDispute: false,
    status: 'open' as BountyDisplayStatus,
  };
  const keys = (over: Partial<typeof base> & Record<string, unknown>) => buildPosterTimeline({ ...base, ...over } as any).map(e => e.key);

  it('a new unpaid job has only "posted" — no payment event', () => {
    expect(keys({})).toEqual(['posted']);
  });

  it('offers appear only when the read returned some', () => {
    expect(keys({ offers: [] })).toEqual(['posted']);
    expect(buildPosterTimeline({ ...base, offers: [{ createdAt: hoursAgo(50) }, { createdAt: hoursAgo(40) }] } as any)[1]).toEqual({
      key: 'offers',
      label: '2 people offered to help',
      at: hoursAgo(50),
    });
  });

  it('a pay-when-you-choose hire adds "chosen" then "paid", at the hire time', () => {
    const events = buildPosterTimeline({ ...base, hired: true, helperName: 'Marcus', hiredAt: hoursAgo(10), money: 'held', status: 'in_progress' } as any);
    expect(events.map(e => e.key)).toEqual(['posted', 'chosen', 'paid']);
    expect(events[2]).toEqual({ key: 'paid', label: 'You paid $60. Bounty is holding it', at: hoursAgo(10) });
  });

  it('a hire with an unconfirmed money state shows no payment event', () => {
    expect(keys({ hired: true, helperName: 'Marcus', money: 'unknown', status: 'in_progress' })).toEqual(['posted', 'chosen']);
  });

  it('a job paid up front shows the payment at posting', () => {
    expect(keys({ fundingMode: 'at_post', money: 'held' })).toEqual(['posted', 'paid']);
  });

  it('submission, approval and release, in order', () => {
    expect(
      keys({
        hired: true,
        helperName: 'Marcus',
        money: 'released',
        status: 'completed',
        submission: { status: 'approved', submitted_at: hoursAgo(5), reviewed_at: hoursAgo(4) },
      })
    ).toEqual(['posted', 'chosen', 'paid', 'submitted', 'approved', 'released']);
  });

  it('an unpaid favour never has money events', () => {
    expect(keys({ isForHonor: true, amount: 0, money: 'none', hired: true, helperName: 'Marcus', status: 'completed' })).toEqual([
      'posted',
      'chosen',
    ]);
  });
});

describe('formatAgo', () => {
  it('reads naturally and never invents a time', () => {
    expect(formatAgo(hoursAgo(0.001), NOW)).toBe('just now');
    expect(formatAgo(hoursAgo(3), NOW)).toBe('3 hours ago');
    expect(formatAgo(hoursAgo(30), NOW)).toBe('yesterday');
    expect(formatAgo(hoursAgo(96), NOW)).toBe('4 days ago');
    expect(formatAgo(null, NOW)).toBeNull();
    expect(formatAgo('not a date', NOW)).toBeNull();
  });
});

describe('describePosterMoney is shared with the chat', () => {
  it('returns null for "none"', () => {
    expect(
      describePosterMoney({ money: 'none', amount: 0, helperName: null, status: 'open', hired: false, hasDispute: false, hasCancellationRequest: false, offerCount: 0 })
    ).toBeNull();
  });
});
