/**
 * The hunter workspace's stage copy (lib/utils/hunter-stage-copy.ts): one
 * test per handoff screen (H.3–H.10, M.3, X.1, X.4), the money line at every
 * step, the fee and take-home from calculateHunterEarnings, the review-window
 * line with the flag on and off, and the offer sheet and job facts.
 */
import { calculateHunterEarnings, PLATFORM_FEE_PERCENT } from '../../../lib/constants/fees';
import {
  describeHunterStage,
  describeJobFacts,
  describeOfferSheet,
  hunterHeaderMeta,
  hunterMoney,
  hunterReceiptRows,
  reviewDeadlineLine,
  type HunterStageInput,
} from '../../../lib/utils/hunter-stage-copy';

const NOW = new Date('2026-11-21T12:00:00Z');
const NET = `$${calculateHunterEarnings(80).net}`;

function input(status: string, over: Partial<HunterStageInput> = {}): HunterStageInput {
  return {
    bounty: { amount: 80, is_for_honor: false, status: 'in_progress' },
    lifecycle: { status, headline: 'Headline', explanation: 'Explanation.', nextStep: 'Next.', tone: 'progress', waitingOn: 'other' } as any,
    posterName: 'Jordan K.',
    hasDispute: false,
    ...over,
  };
}

describe('money comes from calculateHunterEarnings, never sample data', () => {
  it('uses the live fee, not the design sample 10%', () => {
    const m = hunterMoney(80);
    expect(m.split).toEqual(calculateHunterEarnings(80));
    expect(m.percent).toBe(`${PLATFORM_FEE_PERCENT}%`);
    expect(m.net).toBe(NET);
  });

  it('a server fee wins over the estimate', () => {
    expect(hunterMoney(80, 6).net).toBe('$74');
  });
});

describe('H.3 — offer sent', () => {
  it('nothing is held yet; withdrawing is the one thing to do', () => {
    const v = describeHunterStage(input('applied', { bounty: { amount: 80, status: 'open' } }), NOW);
    expect(v).toEqual(
      expect.objectContaining({
        screenId: 'H.3',
        side: 'offered',
        step: 2,
        stage: 'Step 2 of 5 · Choosing help',
        now: 'Your offer is with Jordan.',
        means: 'Jordan will look at everyone who offered and choose one person.',
        money: { kind: 'none', text: "Nothing is held yet. If Jordan chooses you, Jordan's $80 is held by Bounty before you start." },
        after: 'If Jordan chooses you, you start the work.',
        moreOpen: true,
      })
    );
    expect(v.more.map((a) => a.label)).toEqual(['Withdraw my offer']);
    expect(v.primary).toEqual(expect.objectContaining({ label: 'Back to My Jobs', kind: 'quiet' }));
    // No "seen by the poster" claim, and no promise of a decline notification.
    expect(`${v.now} ${v.means}`).not.toMatch(/seen|tell you either way/i);
  });
});

describe('without the poster’s name', () => {
  it('the fallback is capitalised only at the start of a sentence, in copy and in button labels', () => {
    const offered = describeHunterStage(input('applied', { posterName: null, bounty: { amount: 80, status: 'open' } }), NOW);
    expect(offered.now).toBe('Your offer is with the poster.');
    expect(offered.means).toBe('The poster will look at everyone who offered and choose one person.');

    const working = describeHunterStage(input('in_progress', { posterName: null }), NOW);
    expect(working.now).toBe("You're doing this job.");
    expect(working.means).toBe("When it's done, take a photo or two and tell the poster it's done.");
    expect(working.after).toBe('The poster checks the work and approves it.');
    expect(working.primary?.label).toBe("Tell the poster it's done");
    expect(working.secondary[0]?.label).toBe('Message the poster');
  });

  it('offer sheet: no name and no title read as plain sentences', () => {
    const sheet = describeOfferSheet({ title: null, posterName: null, amount: 80 });
    expect(sheet.title).toBe('Offer to do this job');
    expect(sheet.label).toBe('IF THE POSTER CHOOSES YOU');
    expect(sheet.items.map((i) => [i.title, i.detail])).toEqual([
      ["The poster's $80 is held by Bounty", 'Before you start, so you know the money is there.'],
      [`You get ${NET} when the poster approves`, `$80 minus the ${PLATFORM_FEE_PERCENT}% service fee.`],
      ['You can withdraw', 'Any time before the poster chooses.'],
    ]);
  });
});

describe('after being chosen', () => {
  it('H.7: doing the work; no invented "today"', () => {
    const v = describeHunterStage(input('in_progress'), NOW);
    expect(v.screenId).toBe('H.7');
    expect(v.stage).toBe('Step 3 of 5 · Doing the work');
    expect(v.now).toBe("You're doing Jordan's job.");
    expect(v.means).toBe("When it's done, take a photo or two and tell Jordan it's done.");
    expect(v.after).toBe('Jordan checks the work and approves it.');
    expect(v.primary?.label).toBe("Tell Jordan it's done");
    expect(v.secondary[0]).toEqual(expect.objectContaining({ label: 'Message Jordan', kind: 'secondary' }));
    expect(v.more.map((a) => a.label)).toEqual(["I can't do this job any more"]);
    expect(v.now).not.toMatch(/today/);
  });

  it('M.3 in the workspace: the change asked for, money still held, send again', () => {
    const v = describeHunterStage(
      input('in_progress', { submission: { status: 'revision_requested', poster_feedback: 'Move it 5 cm left.' } }),
      NOW
    );
    expect(v.now).toBe('Jordan asked for a change.');
    expect(v.money).toEqual({ kind: 'held', text: '$80 is still held. Nothing is paid until Jordan approves.' });
    expect(v.primary?.label).toBe('Send updated work');
    expect(v.show.changeRequested).toBe('Move it 5 cm left.');
  });
});

describe('H.9 — waiting for approval', () => {
  const submitted = { status: 'pending', submitted_at: '2026-11-21T09:40:00Z', proof_items: [{ type: 'image' }, { type: 'image' }] };

  it('not paid yet: still held, and what they get when approved', () => {
    const v = describeHunterStage(input('submitted_for_review', { submission: submitted }), NOW);
    expect(v.screenId).toBe('H.9');
    expect(v.stage).toBe('Step 4 of 5 · Reviewing the work');
    expect(v.now).toBe('Jordan is checking your work.');
    expect(v.means).toMatch(/^You sent a note and 2 photos today at \d{1,2}:\d{2} (am|pm)\. Jordan will approve it or ask for a change\.$/);
    expect(v.money).toEqual({ kind: 'held', text: `Not paid yet. Jordan's $80 is still held by Bounty. You get ${NET} when Jordan approves.` });
    expect(v.after).toBe("You'll get a notification either way.");
    expect(v.primary).toEqual(expect.objectContaining({ label: 'Message Jordan', kind: 'quiet' }));
  });

  it('review window off (the default): no deadline line', () => {
    expect(describeHunterStage(input('submitted_for_review', { submission: submitted, reviewDeadline: null }), NOW).show.deadline).toBeNull();
  });

  it('review window on: says when, and that Bounty reviews it', () => {
    const deadline = new Date('2026-11-24T12:40:00Z');
    const v = describeHunterStage(input('submitted_for_review', { submission: submitted, reviewDeadline: deadline }), NOW);
    expect(v.show.deadline).toBe(reviewDeadlineLine('Jordan', deadline, NOW));
    expect(v.show.deadline).toMatch(/^Jordan has until .+ to approve the work or raise a problem\. If they don't respond, Bounty reviews it\.$/);
  });
});

describe('H.10 — approved', () => {
  it('released to the Bounty wallet, never "paid to your bank"; receipt from the live fee', () => {
    const v = describeHunterStage(input('completed', { lifecycle: { ...input('completed').lifecycle, tone: 'positive' } }), NOW);
    expect(v.screenId).toBe('H.10');
    expect(v.side).toBe('did');
    expect(v.stage).toBe('Step 5 of 5 · Finished');
    expect(v.now).toBe(`Jordan approved. You earned ${NET}.`);
    expect(v.means).toBe('Jordan said the job is done, and Bounty released the payment to you.');
    expect(v.money).toEqual({ kind: 'released', text: `${NET} is in your Bounty wallet. Wallet shows when you can move it to your bank.` });
    expect(v.money?.text).not.toMatch(/paid to your bank|sent to your bank/i);
    expect(v.primary?.label).toBe('See my wallet');
    const split = calculateHunterEarnings(80);
    expect(hunterReceiptRows('Jordan K.', 80)).toEqual([
      { label: 'Jordan paid', value: '$80' },
      { label: `Service fee (${PLATFORM_FEE_PERCENT}%)`, value: `−$${split.fee}` },
      { label: 'You get', value: `$${split.net}`, strong: true },
    ]);
  });

  it('approval still settling is not "released" yet', () => {
    const v = describeHunterStage(input('completed'), NOW);
    expect(v.money?.kind).toBe('held');
  });

  it('before approval nothing says released or paid', () => {
    for (const status of ['applied', 'in_progress', 'submitted_for_review']) {
      const v = describeHunterStage(input(status, { submission: { status: 'pending' } }), NOW);
      expect(v.money?.kind).not.toBe('released');
      expect(v.money?.text ?? '').not.toMatch(/is in your Bounty wallet/);
    }
  });
});

describe('problems', () => {
  it('X.1: not chosen — nothing was held', () => {
    const v = describeHunterStage(input('rejected', { bounty: { amount: 80, status: 'in_progress' } }), NOW);
    expect(v).toEqual(
      expect.objectContaining({
        screenId: 'X.1',
        stage: 'Not going ahead',
        now: 'Jordan chose someone else.',
        means: "Thanks for offering. This job isn't taking offers any more.",
        money: { kind: 'none', text: 'Nothing was held, so nothing changes in your wallet.' },
      })
    );
    expect(v.primary?.label).toBe('Find more work');
    expect(v.secondary.map((a) => a.label)).toEqual(['Remove from my list']);
  });

  it('X.1 after a system closure does not say someone else was chosen', () => {
    const v = describeHunterStage(input('rejected', { requestRejectionSource: 'system_expiry' }), NOW);
    expect(v.now).not.toMatch(/chose someone else/);
  });

  it('X.4: paused for a dispute; undecided outcome and timing are left out', () => {
    const v = describeHunterStage(input('in_progress', { hasDispute: true, disputeOpenedByViewer: false }), NOW);
    expect(v.screenId).toBe('X.4');
    expect(v.stage).toBe('Paused · Bounty is reviewing');
    expect(v.means).toBe('Jordan reported a problem with the work. A person at Bounty will look at the photos and messages, and may contact you.');
    expect(v.money).toEqual({ kind: 'held', text: 'Nobody is paid while Bounty looks into it.' });
    expect(v.after).toBeNull();
    expect(v.primary?.label).toBe('See the report');
    expect(v.secondary.map((a) => a.label)).toEqual(['Add information']);
  });
});

describe('H.1 / H.2', () => {
  it('offer sheet: held before you start, take-home and fee, withdraw any time', () => {
    const sheet = describeOfferSheet({ title: 'Mount a TV', posterName: 'Jordan K.', amount: 80 });
    expect(sheet.label).toBe('IF JORDAN CHOOSES YOU');
    expect(sheet.items.map((i) => [i.title, i.detail])).toEqual([
      ["Jordan's $80 is held by Bounty", 'Before you start, so you know the money is there.'],
      [`You get ${NET} when Jordan approves`, `$80 minus the ${PLATFORM_FEE_PERCENT}% service fee.`],
      ['You can withdraw', 'Any time before Jordan chooses.'],
    ]);
    expect(sheet.field).toBe('Why you? (optional)');
    expect(sheet.send).toBe('Send offer');
    expect(sheet.send).not.toMatch(/earn|paid|\$/);
  });

  it('facts: online jobs say Online; unknown distance is left out, never invented', () => {
    expect(describeJobFacts({ posterName: 'Jordan', amount: 80, online: true }).map((r) => r.value)).toContain('Online');
    const inPerson = describeJobFacts({ posterName: 'Jordan', amount: 80, distanceText: null });
    expect(inPerson.some((r) => r.label === 'Where')).toBe(false);
    expect(inPerson.find((r) => r.label === 'You get')?.value).toBe(`${NET} after the ${PLATFORM_FEE_PERCENT}% fee`);
  });

  it('header meta', () => {
    expect(hunterHeaderMeta(80, false, 'Jordan K.')).toBe('$80 · Posted by Jordan K.');
  });
});

describe('hired, working, silent — the helper side (E2E-04, E2E-05)', () => {
  // NOW is Saturday 21 Nov 2026; the silence started Wednesday 18 Nov.
  const at = (phase: 'hired' | 'working' | 'silent') =>
    describeHunterStage(input('in_progress', { hired: { phase, silentSince: '2026-11-18T16:00:00Z' } }), NOW);

  it('HIRED: the next step is agreeing a day and time with the poster', () => {
    const v = at('hired');
    expect(v.stage).toBe('Step 3 of 5 · Hired');
    expect(v.now).toBe('Jordan chose you for this job.');
    expect(v.means).toBe('Message Jordan to agree a day and time.');
    expect(v.primary).toEqual(expect.objectContaining({ key: 'message', label: 'Message Jordan', kind: 'primary' }));
    expect(v.secondary[0]).toEqual(expect.objectContaining({ key: 'tell_done' }));
  });

  it("SILENT: \"Jordan hasn't heard from you since Wednesday.\"", () => {
    const v = at('silent');
    expect(v.stage).toBe('Step 3 of 5 · Jordan is waiting to hear from you');
    expect(v.now).toBe("Jordan hasn't heard from you since Wednesday.");
    expect(v.primary).toEqual(expect.objectContaining({ key: 'message', kind: 'primary' }));
  });

  it('WORKING: H.7 as before', () => {
    const v = at('working');
    expect(v.now).toBe("You're doing Jordan's job.");
    expect(v.primary).toEqual(expect.objectContaining({ key: 'tell_done' }));
  });

  it('every one of these reads in plain words', () => {
    for (const p of ['hired', 'working', 'silent'] as const) {
      const v = at(p);
      const text = [v.stage, v.now, v.means, v.money?.text, v.after, v.primary?.label, ...v.secondary.map((a) => a.label)]
        .filter(Boolean)
        .join(' ');
      expect(text).not.toMatch(/\b(hunters?|escrow|payouts?|apply|applied|applicants?|ACH|Connect|onboarding|disputes?)\b|\bbounty\b/);
    }
  });
});
