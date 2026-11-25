/**
 * The poster workspace's stage copy (lib/utils/poster-stage-copy.ts): one
 * test per handoff screen, the money truth for every charge state, the
 * applicant view's honest-facts rules, the hiring confirmation, and the
 * stage-aware help options.
 */
import { FOCUS_POLICY } from '../../../lib/constants/focus-policy';
import { getHelpOptions, helpSubtitle } from '../../../lib/utils/help-options';
import {
  describeApplicant,
  describeHire,
  describePosterStage,
  formatDistanceWords,
  onDay,
  othersCloseLine,
  POSTER_UNPAID,
  posterHeaderMeta,
  type PosterStageInput,
} from '../../../lib/utils/poster-stage-copy';

const NOW = new Date('2026-11-21T12:00:00Z');

function lifecycle(status: string, over: Record<string, unknown> = {}) {
  return { status, headline: 'Headline', explanation: 'Explanation.', nextStep: 'Next.', tone: 'progress', ...over } as any;
}

function input(over: Partial<PosterStageInput> = {}): PosterStageInput {
  return {
    bounty: { status: 'open', amount: 60, is_for_honor: false, accepted_by: null, created_at: '2026-11-21T08:00:00Z', funding_mode: 'at_accept' },
    lifecycle: lifecycle('open'),
    helperName: null,
    applicantCount: 0,
    submission: null,
    hasDispute: false,
    openJobCharge: 'not_charged',
    now: NOW,
    ...over,
  };
}

const HIRED = { status: 'in_progress', amount: 60, is_for_honor: false, accepted_by: 'h1', created_at: '2026-11-16T08:00:00Z', funding_mode: 'at_accept' };

describe('stage A / B — before anyone offers', () => {
  it('A: just posted', () => {
    const v = describePosterStage(input({ justPosted: true }));
    expect(v).toEqual(
      expect.objectContaining({
        screenId: 'A',
        step: 1,
        stage: 'Step 1 of 5 · Posted',
        now: 'Your job is live.',
        means: "People nearby can see it now. When someone offers to help, we'll send you a notification and show them here.",
        money: { kind: 'none', text: POSTER_UNPAID },
        after: 'You choose one person to help.',
      })
    );
    expect(v.primary).toEqual(expect.objectContaining({ key: 'done', label: 'Done', kind: 'primary' }));
  });

  it('B: two days with no offers nudges for a photo or details, with Other options open', () => {
    const v = describePosterStage(input({ bounty: { ...input().bounty, created_at: '2026-11-19T10:00:00Z' } }));
    expect(v.screenId).toBe('B');
    expect(v.now).toBe('No one has offered yet.');
    expect(v.means).toBe("It's been 2 days. A clear photo and a few details can help people decide.");
    expect(v.after).toBe("We'll tell you as soon as someone offers.");
    expect(v.primary?.label).toBe('Add a photo or details');
    expect(v.secondary.map((a) => a.label)).toEqual(['Keep waiting']);
    expect(v.moreOpen).toBe(true);
  });

  it('before the nudge threshold it stays A, without a toast-driven flag', () => {
    expect(describePosterStage(input()).screenId).toBe('A');
  });
});

describe('stage C — offers received', () => {
  it('says how many, the money truth and that offers close', () => {
    const v = describePosterStage(input({ applicantCount: 3, expiryHours: 72 }));
    expect(v).toEqual(
      expect.objectContaining({
        screenId: 'C',
        step: 2,
        stage: 'Step 2 of 5 · Choosing help',
        now: '3 people want to help.',
        means: 'Each one read your job and offered to do it for $60. Look at each person, then choose one.',
        money: { kind: 'none', text: POSTER_UNPAID },
        after: 'The person you choose starts the work.',
      })
    );
    expect(v.primary?.label).toBe('See each person');
    expect(v.show.peopleStrip).toBe(true);
    expect(v.show.offersCloseNote).toBe("Offers close after 3 days if you don't answer.");
  });

  it('uses the live expiry window', () => {
    expect(describePosterStage(input({ applicantCount: 1, expiryHours: 48 })).show.offersCloseNote).toBe(
      "Offers close after 2 days if you don't answer."
    );
  });

  it('one offer reads in the singular', () => {
    const v = describePosterStage(input({ applicantCount: 1 }));
    expect(v.now).toBe('1 person wants to help.');
    expect(v.primary?.label).toBe('See this person');
  });
});

describe('money truth on an open job', () => {
  it.each([
    ['not_charged', 'none', POSTER_UNPAID],
    ['held', 'held', 'Your $60 is with Bounty. Nobody is paid until you approve.'],
    ['checking', 'none', 'Checking your payment…'],
  ] as const)('%s → %s', (charge, kind, text) => {
    expect(describePosterStage(input({ applicantCount: 2, openJobCharge: charge })).money).toEqual({ kind, text });
  });

  it('an unknown answer never claims money is held, and offers to check again', () => {
    const v = describePosterStage(input({ openJobCharge: 'unknown' }));
    expect(v.money?.kind).toBe('warn');
    expect(v.money?.text).not.toMatch(/held|with Bounty/);
    expect(v.show.checkPaymentAgain).toBe(true);
  });

  it('a for-honor job has no money line', () => {
    expect(describePosterStage(input({ bounty: { ...input().bounty, is_for_honor: true, amount: 0 } })).money).toBeNull();
  });
});

describe('after choosing someone', () => {
  it('G: hired → step 3, work underway straight away, nothing required', () => {
    const v = describePosterStage(input({ bounty: HIRED, lifecycle: lifecycle('in_progress'), helperName: 'Ada R.', openJobCharge: null }));
    expect(v.screenId).toBe('G');
    expect(v.step).toBe(3);
    expect(v.stage).toBe('Step 3 of 5 · Work underway');
    expect(v.now).toBe('Ada is working on your job.');
    expect(v.means).toBe("Ada will let you know here when it's done. You don't need to do anything until then.");
    expect(v.after).toBe('You review the work and decide about payment.');
    expect(v.primary).toEqual(expect.objectContaining({ label: 'Message Ada', kind: 'quiet' }));
    expect(v.show.lastMessage && v.show.story).toBe(true);
  });

  it('H: work submitted, with the photo count, still held', () => {
    const v = describePosterStage(
      input({
        bounty: HIRED,
        lifecycle: lifecycle('review_needed'),
        helperName: 'Ada R.',
        submission: { status: 'pending', proof_items: [{ type: 'image' }, { type: 'image' }, { type: 'file' }] },
        openJobCharge: null,
      })
    );
    expect(v.screenId).toBe('H');
    expect(v.stage).toBe('Step 4 of 5 · Reviewing the work');
    expect(v.now).toBe('Ada says the job is done.');
    expect(v.means).toBe('Ada sent a note and 2 photos. Look at them, and check the work yourself if you can.');
    expect(v.money?.kind).toBe('held');
    expect(v.after).toBe('You decide whether to approve and pay.');
    expect(v.primary?.label).toBe('Review the completed work');
    expect(v.show.proofPhotos).toBe(true);
  });

  it('I.3: finished — released (to the Bounty balance), never "paid to a bank"; optional rating', () => {
    const v = describePosterStage(
      input({
        bounty: { ...HIRED, status: 'completed', completed_at: '2026-11-21T09:00:00Z' },
        lifecycle: lifecycle('completed', { tone: 'positive' }),
        helperName: 'Ada R.',
        openJobCharge: null,
      })
    );
    expect(v).toEqual(
      expect.objectContaining({
        screenId: 'I.3',
        step: 5,
        stage: 'Step 5 of 5 · Finished',
        now: 'Done. Released to Ada.',
        means: 'Ada received your $60 in Bounty. Your job is finished.',
        money: { kind: 'released', text: 'Released to Ada today. No fees for you.' },
      })
    );
    expect(v.money?.text).not.toMatch(/\bpaid\b/i);
    expect(v.primary?.label).toBe('Send rating');
    expect(v.secondary.map((a) => a.label)).toEqual(['Skip and go to My Jobs']);
  });

  it('I.3 after rating: no rating asked again', () => {
    const v = describePosterStage(
      input({ bounty: { ...HIRED, status: 'completed' }, lifecycle: lifecycle('completed', { tone: 'positive' }), helperName: 'Ada', canRate: false, openJobCharge: null })
    );
    expect(v.show.rating).toBe(false);
    expect(v.primary?.label).toBe('Back to My Jobs');
  });

  it('a release still settling says so, and is not "released" yet', () => {
    const v = describePosterStage(
      input({ bounty: { ...HIRED, status: 'completed' }, lifecycle: lifecycle('completed', { tone: 'progress' }), helperName: 'Ada', openJobCharge: null })
    );
    expect(v.money?.kind).toBe('held');
    expect(v.now).toBe('You approved the work.');
  });

  it('a real username is never re-cased; the fallback is', () => {
    const named = describePosterStage(input({ bounty: HIRED, lifecycle: lifecycle('in_progress'), helperName: 'ana_hunts', openJobCharge: null }));
    expect(named.now).toBe('ana_hunts is working on your job.');
    const unnamed = describePosterStage(input({ bounty: HIRED, lifecycle: lifecycle('in_progress'), helperName: null, openJobCharge: null }));
    // Mid-sentence the fallback stays lowercase, in copy and in button labels.
    expect(unnamed.now).toBe('Your helper is working on your job.');
    expect(unnamed.means).toBe("Your helper will let you know here when it's done. You don't need to do anything until then.");
    expect(unnamed.primary?.label).toBe('Message your helper');
    const unnamedDone = describePosterStage(
      input({ bounty: { ...HIRED, status: 'completed' }, lifecycle: lifecycle('completed', { tone: 'positive' }), helperName: null, openJobCharge: null })
    );
    expect(unnamedDone.now).toBe('Done. Released to your helper.');
    const unnamedSettling = describePosterStage(
      input({ bounty: { ...HIRED, status: 'completed' }, lifecycle: lifecycle('completed', { tone: 'progress' }), helperName: null, openJobCharge: null })
    );
    expect(unnamedSettling.money?.text).toBe('Bounty is releasing your $60 to your helper.');
  });
});

describe('J.2 / J.3 — paused and cancellation', () => {
  it('J.2: a dispute pauses everything; unresolved policy is left out, not invented', () => {
    const v = describePosterStage(input({ bounty: HIRED, lifecycle: lifecycle('in_progress'), helperName: 'Ada', hasDispute: true, disputeOpenedByViewer: true, openJobCharge: null }));
    expect(v.screenId).toBe('J.2');
    expect(v.stage).toBe('Paused · Bounty is reviewing');
    expect(v.now).toBe('Bounty is looking into it.');
    expect(v.means).toBe('You reported a problem. A person at Bounty is reviewing it and may contact Ada.');
    expect(v.money).toEqual({ kind: 'held', text: 'Nobody is paid while Bounty looks into it.' });
    expect(v.after).toBeNull();
    expect(v.primary?.label).toBe('See your report');
  });

  it('J.2 with the design-review switch shows the handoff placeholders', () => {
    FOCUS_POLICY.showPlaceholders = true;
    try {
      const v = describePosterStage(input({ bounty: HIRED, lifecycle: lifecycle('in_progress'), helperName: 'Ada', hasDispute: true, openJobCharge: null }));
      expect(v.money?.kind).toBe('ph');
      expect(v.money?.text).toContain('{refund destination}');
      expect(v.after).toBe("We'll reply by email within {reply time}.");
    } finally {
      FOCUS_POLICY.showPlaceholders = false;
    }
  });

  it('J.3: the helper asked to cancel; the refund and where it goes come from the request', () => {
    const v = describePosterStage(
      input({
        bounty: HIRED,
        lifecycle: lifecycle('cancellation_requested'),
        helperName: 'Ada',
        cancellation: { requesterType: 'hunter', reason: 'My van broke down.', refundAmount: 60, refundPercentage: 100 },
        openJobCharge: null,
      })
    );
    expect(v.screenId).toBe('J.3');
    expect(v.now).toBe('Ada asked to cancel.');
    expect(v.means).toBe('“My van broke down.” Ada offers to return all $60 to your Bounty balance. If you accept, the job ends.');
    expect(v.money).toEqual({ kind: 'held', text: 'If you accept: $60 back to your Bounty balance.' });
    expect(v.after).toBe('You can post the job again.');
    expect(v.primary?.label).toBe("Respond to Ada's request");
  });
});

describe('header, days and the person view', () => {
  it('header meta', () => {
    expect(posterHeaderMeta({ bounty: { amount: 60, created_at: '2026-11-21T08:00:00Z' }, helperName: null }, NOW)).toBe('$60 · Posted today');
    expect(posterHeaderMeta({ bounty: { amount: 60, accepted_by: 'h1', status: 'in_progress' }, helperName: 'Ada R.' }, NOW)).toBe('$60 · Ada is your helper');
  });

  it('onDay reads naturally', () => {
    expect(onDay('2026-11-21T08:00:00Z', NOW)).toBe('today');
    expect(onDay('2026-11-20T08:00:00Z', NOW)).toBe('yesterday');
    expect(onDay(null, NOW)).toBeNull();
  });

  it('D: only facts the app has, with honest fallbacks', () => {
    const v = describeApplicant(
      { message: 'I have a van.', distance_mi: 2.2, profile: { username: 'Ada R.', created_at: '2025-03-10T00:00:00Z', averageRating: 4.8, ratingCount: 12, hunterCompleted: 14 } },
      { index: 0, total: 3, verified: true }
    );
    expect(v.stage).toBe('Step 2 of 5 · Person 1 of 3');
    expect(v.since).toBe('On Bounty since March 2025');
    expect(v.note).toBe('“I have a van.”');
    expect(v.facts.map((f) => f.text)).toEqual([
      "Stripe checked Ada's photo ID for Bounty",
      '4.8 out of 5 from 12 reviews',
      '14 jobs done on Bounty',
      'About 2 miles away',
    ]);
  });

  it('D: the ID line even when not verified; no rating below 3 ratings; "No reviews yet" at 0; "Distance not shown"', () => {
    const few = describeApplicant({ profile: { username: 'Sam', ratingCount: 2, averageRating: 5 } }, { index: 1, total: 2, verified: false });
    expect(few.facts.map((f) => f.text)).toEqual(["Sam hasn't verified a photo ID yet", 'Distance not shown']);
    const none = describeApplicant({ profile: { username: 'Priya', ratingCount: 0 } }, { index: 0, total: 1, verified: false });
    expect(none.facts).toEqual([
      { icon: 'badge', text: "Priya hasn't verified a photo ID yet", muted: true, kind: 'id' },
      { icon: 'star-outline', text: 'No reviews yet', muted: true },
      { icon: 'location-off', text: 'Distance not shown', muted: true },
    ]);
    expect(describeApplicant({ profile: { username: 'Lee' }, distance_mi: 1 }, { index: 0, total: 1, verified: false, online: true }).facts.pop()?.text).toBe('Online');
    expect(formatDistanceWords(0.4)).toBe('Under 1 mile away');
    expect(formatDistanceWords(1)).toBe('About 1 mile away');
  });
});

describe('E — hiring confirmation', () => {
  it('balance and card split, the hold, others close, the work starts', () => {
    const hire = describeHire({ hunterName: 'Ada R.', amount: 60, charge: 45, fromBalance: 15, paysByCard: true, otherApplicantNames: ['Priya S.', 'Sam T.'] });
    expect(hire.title).toBe('Choose Ada for $60?');
    expect(hire.label).toBe('WHAT HAPPENS WHEN YOU CHOOSE ADA');
    expect(hire.items.map((i) => [i.title, i.detail])).toEqual([
      ['You pay $60 now', '$15 from your Bounty balance and $45 from your card.'],
      ['Bounty holds it', 'Ada is paid only after you say the job is done.'],
      ["Priya's and Sam's offers close", 'Your job stops taking new offers.'],
      ['Ada starts the work', 'You can message each other any time.'],
    ]);
    expect(hire.primary).toBe('Pay $45 and choose Ada');
    expect(hire.cancel).toBe('Not yet');
  });

  it('balance covers it', () => {
    const hire = describeHire({ hunterName: 'Ada', amount: 60, charge: 0, fromBalance: 60, paysByCard: false });
    expect(hire.items[0].detail).toBe('From your Bounty balance.');
    expect(hire.primary).toBe('Choose Ada');
    expect(hire.items[2].title).toBe('Other offers close');
  });

  it('E.3: still confirming — never pay again; no promised notification', () => {
    const { pending } = describeHire({ hunterName: 'Ada', amount: 60, charge: 45, fromBalance: 15, paysByCard: true });
    expect(pending.now).toBe("We're still confirming your payment.");
    expect(pending.means).toBe("Please don't pay again. Ada isn't your helper until it's confirmed.");
    expect(pending.means).not.toMatch(/tell you/);
  });

  it('others-close wording', () => {
    expect(othersCloseLine(['Priya'])).toBe("Priya's offer closes");
    expect(othersCloseLine(['A', 'B', 'C'])).toBe("A's, B's and C's offers close");
    expect(othersCloseLine(['A', 'B', 'C', 'D'])).toBe('The other 4 offers close');
  });
});

describe('help options (J / X.3)', () => {
  it('poster, work underway: message, no-show, not finished, something else', () => {
    const options = getHelpOptions({ side: 'posted', otherName: 'Ada', working: true, workSubmitted: false, disputeOpen: false });
    expect(options.map((o) => o.text)).toEqual(['Message Ada', "Ada hasn't replied or didn't come", "The job isn't finished", 'Something else is wrong']);
    expect(options.find((o) => o.key === 'no_show')?.reason).toBe('hunter_unresponsive');
    expect(options.find((o) => o.key === 'not_finished')?.reason).toBe('missed_deadline');
  });

  it('poster, work submitted: no "didn\'t come"; not finished is about the work', () => {
    const options = getHelpOptions({ side: 'posted', otherName: 'Ada', working: true, workSubmitted: true, disputeOpen: false });
    expect(options.some((o) => o.key === 'no_show')).toBe(false);
    expect(options.find((o) => o.key === 'not_finished')?.reason).toBe('work_quality');
  });

  it('hunter doing the job: X.3 options', () => {
    const options = getHelpOptions({ side: 'doing', otherName: 'Jordan', working: true, workSubmitted: false, disputeOpen: false });
    expect(options.map((o) => o.text)).toEqual(['Message Jordan', "Jordan isn't replying", "I can't do this job any more", 'Something else is wrong']);
    expect(options.find((o) => o.key === 'cant_do')?.target).toBe('cancel_request');
  });

  it('before anyone is chosen, or during a dispute, only support', () => {
    expect(getHelpOptions({ side: 'posted', otherName: null, working: false, workSubmitted: false, disputeOpen: false }).map((o) => o.target)).toEqual(['support']);
    expect(getHelpOptions({ side: 'posted', otherName: 'Ada', working: true, workSubmitted: false, disputeOpen: true }).map((o) => o.key)).toEqual(['message', 'other']);
  });

  it('subtitle', () => {
    expect(helpSubtitle({ side: 'posted', otherName: 'Ada', working: true, heldAmount: '$60' })).toBe('Ada is working on it · $60 held by Bounty');
    expect(helpSubtitle({ side: 'doing', otherName: 'Jordan', working: true, heldAmount: '$80' })).toBe("You're doing this · $80 held by Bounty");
    expect(helpSubtitle({ side: 'doing', otherName: 'Jordan', working: false, heldAmount: '$80' })).toBeNull();
  });
});

describe("E.2 — haven't heard from the helper", () => {
  const quiet = () =>
    describePosterStage(
      input({ bounty: HIRED, lifecycle: lifecycle('in_progress'), helperName: 'Ada R.', awaitingReplySince: '2026-11-18T08:00:00Z' })
    );
  afterEach(() => {
    FOCUS_POLICY.silenceThresholdHours = null;
  });
  it('stays on G until a threshold is decided (Q-PRD-2)', () => {
    expect(quiet().screenId).toBe('G');
  });
  it('shows once the helper has been quiet past the threshold', () => {
    FOCUS_POLICY.silenceThresholdHours = 48;
    const v = quiet();
    expect(v.screenId).toBe('E.2');
    expect(v.now).toBe("You haven't heard from Ada.");
    expect(v.primary).toEqual(expect.objectContaining({ key: 'message', label: 'Message Ada' }));
    expect(v.secondary[0]).toEqual(expect.objectContaining({ key: 'report_no_reply', label: "Tell us Ada hasn't replied" }));
    FOCUS_POLICY.silenceThresholdHours = 200;
    expect(quiet().screenId).toBe('G');
  });
});

it('E.3: a payment still confirming replaces choosing, with only the way back', () => {
  const v = describePosterStage(input({ applicantCount: 3, paymentConfirmingFor: 'Ada R.' }));
  expect(v.screenId).toBe('E.3');
  expect(v.now).toBe("We're still confirming your payment.");
  expect(v.means).toBe("Please don't pay again. Ada isn't your helper until it's confirmed.");
  expect(v.primary).toEqual(expect.objectContaining({ key: 'back_to_jobs', label: 'Back to My Jobs' }));
  expect(v.show.peopleStrip).toBe(false);
});
