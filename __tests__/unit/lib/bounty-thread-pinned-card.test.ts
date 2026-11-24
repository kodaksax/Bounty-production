/**
 * The job thread's pinned card and job strip (Focus-first M.1–M.3, H.6):
 * built only from buildBountyThreadEvents' cards, exactly one actionable card
 * at a time, the right viewer's turn, superseded cards faded, and a strip
 * that says "held" only once someone is chosen.
 */
import { describeJobStrip } from '../../../components/bounty-inbox/job-thread-bits';
import {
  buildBountyThreadEvents,
  describePinnedCard,
  selectPinnedThreadCard,
  type BountyThreadInput,
} from '../../../lib/utils/bounty-thread-events';

jest.mock('expo-image', () => ({ Image: () => null }));

const HUNTER = 'hunter-1';
const hired = { id: 'b-1', status: 'in_progress', created_at: '2026-01-01T10:00:00Z', amount: 80, is_for_honor: false, accepted_by: HUNTER };
const accepted = { id: 'r-1', status: 'accepted', hunter_id: HUNTER, created_at: '2026-01-01T11:00:00Z', accepted_at: '2026-01-02T09:12:00Z' };
const sent = { id: 's-1', hunter_id: HUNTER, status: 'pending', message: 'TV is up and level.', proof_items: [{}, {}], submitted_at: '2026-01-04T12:40:00Z' };
const MONEY = { amount: '$80', takeHome: '$76' };

function events(role: 'hunter' | 'poster', over: Partial<BountyThreadInput> = {}) {
  return buildBountyThreadEvents({ role, viewerId: role === 'hunter' ? HUNTER : 'poster-1', bounty: hired, request: accepted, ...over });
}

describe('selectPinnedThreadCard', () => {
  it('H.6: the chosen hunter is asked to tell the poster it is done', () => {
    const pinned = selectPinnedThreadCard(events('hunter'), 'hunter');
    expect(pinned).toEqual(expect.objectContaining({ mode: 'your_turn' }));
    expect(pinned?.event.kind).toBe('hired');
    expect(describePinnedCard(pinned!, 'hunter', 'Jordan', MONEY)).toEqual({
      label: 'YOUR NEXT STEP',
      title: "When the job is done, tell Jordan it's done",
      text: null,
      button: "Tell Jordan it's done",
    });
  });

  it('M.1 and M.2 — the same moment on both phones', () => {
    const hunter = selectPinnedThreadCard(events('hunter', { submission: sent }), 'hunter');
    expect(hunter?.mode).toBe('waiting');
    expect(describePinnedCard(hunter!, 'hunter', 'Jordan', MONEY)).toEqual({
      label: 'WAITING FOR JORDAN',
      title: 'Jordan is checking your work',
      text: '$80 is still held. You get $76 when Jordan approves.',
      button: null,
    });
    const poster = selectPinnedThreadCard(events('poster', { submission: sent }), 'poster');
    expect(poster?.mode).toBe('your_turn');
    expect(describePinnedCard(poster!, 'poster', 'Maya', MONEY)).toEqual({
      label: 'YOUR NEXT STEP',
      title: 'Check the work, then decide about payment',
      text: null,
      button: 'Review the completed work',
    });
    // Same cards in the same order on both sides.
    expect(events('hunter', { submission: sent }).map((e) => e.id)).toEqual(events('poster', { submission: sent }).map((e) => e.id));
  });

  it('M.3: after a change is asked for, the old "sent the work" card is superseded and the hunter resubmits', () => {
    const revised = { ...sent, status: 'revision_requested', poster_feedback: 'Move it 5 cm left.', reviewed_at: '2026-01-04T14:05:00Z' };
    const list = events('hunter', { submission: revised });
    expect(list.find((e) => e.kind === 'work_submitted')?.superseded).toBe(true);
    const pinned = selectPinnedThreadCard(list, 'hunter');
    expect(pinned?.event.kind).toBe('revision_requested');
    expect(describePinnedCard(pinned!, 'hunter', 'Jordan', MONEY)).toEqual({
      label: 'YOUR NEXT STEP',
      title: 'Make the change, then send the work again',
      text: '$80 is still held. Nothing is paid until Jordan approves.',
      button: 'Send updated work',
    });
  });

  it('a card that merely happened earlier is not superseded', () => {
    const approved = buildBountyThreadEvents({
      role: 'hunter',
      viewerId: HUNTER,
      bounty: { ...hired, status: 'completed', completed_at: '2026-01-05T00:00:00Z' },
      request: accepted,
      submission: { ...sent, status: 'approved' },
    });
    expect(approved.find((e) => e.kind === 'work_submitted')?.superseded).toBeFalsy();
  });

  it('only one card is ever actionable, and only for the viewer whose turn it is', () => {
    for (const submission of [null, sent, { ...sent, status: 'revision_requested' }]) {
      for (const role of ['hunter', 'poster'] as const) {
        const list = events(role, { submission });
        const pinned = selectPinnedThreadCard(list, role);
        const actionable = pinned?.mode === 'your_turn' ? [pinned.event] : [];
        expect(actionable.length).toBeLessThanOrEqual(1);
        if (pinned?.mode === 'your_turn') expect(pinned.event.yourTurn).toBe(true);
        if (pinned?.mode === 'waiting') expect(describePinnedCard(pinned, role, 'X', MONEY).button).toBeNull();
      }
    }
  });

  it('an application waiting on the poster keeps its own Accept / Pass buttons and is not pinned', () => {
    const open = buildBountyThreadEvents({
      role: 'poster',
      viewerId: 'poster-1',
      bounty: { ...hired, status: 'open', accepted_by: null },
      request: { id: 'r-2', status: 'pending', hunter_id: HUNTER, created_at: '2026-01-01T11:00:00Z' },
    });
    expect(selectPinnedThreadCard(open, 'poster')).toBeNull();
  });

  it('without a name: "The poster" starts a sentence, "the poster" sits inside one; a username is never re-cased', () => {
    const hunterWaiting = selectPinnedThreadCard(events('hunter', { submission: sent }), 'hunter');
    expect(describePinnedCard(hunterWaiting!, 'hunter', '', MONEY)).toEqual({
      label: 'WAITING FOR THE POSTER',
      title: 'The poster is checking your work',
      text: '$80 is still held. You get $76 when the poster approves.',
      button: null,
    });
    const hunterTurn = selectPinnedThreadCard(events('hunter'), 'hunter');
    expect(describePinnedCard(hunterTurn!, 'hunter', '', MONEY).button).toBe("Tell the poster it's done");
    expect(describePinnedCard(hunterWaiting!, 'hunter', 'jordan_k', MONEY).title).toBe('jordan_k is checking your work');
  });

  it('for honor: no money sentence on the pinned card', () => {
    const pinned = selectPinnedThreadCard(events('hunter', { submission: sent }), 'hunter');
    expect(describePinnedCard(pinned!, 'hunter', 'Jordan', { amount: null, takeHome: null }).text).toBeNull();
  });
});

describe('describeJobStrip', () => {
  it('says "held" only once someone is chosen', () => {
    expect(describeJobStrip({ role: 'hunter', viewerId: HUNTER, bounty: hired, counterpartName: 'Jordan' }).text).toBe(
      "You're doing this · $80 held by Bounty"
    );
    expect(describeJobStrip({ role: 'poster', viewerId: 'poster-1', bounty: hired, counterpartName: 'Maya' }).text).toBe(
      'You posted this · $80 held by Bounty'
    );
    expect(
      describeJobStrip({ role: 'hunter', viewerId: HUNTER, bounty: { ...hired, status: 'open', accepted_by: null }, counterpartName: 'Jordan' }).text
    ).toBe('You offered · $80');
  });

  it('after approval: release wording stays unconfirmed until settlement is confirmed', () => {
    const strip = describeJobStrip({ role: 'hunter', viewerId: HUNTER, bounty: { ...hired, status: 'completed' }, counterpartName: 'Jordan' });
    expect(strip.text).toMatch(/^You did this · \$\d+(\.\d\d)? release status unconfirmed$/);
    expect(strip.text).not.toMatch(/paid|released to your wallet/i);
  });

  it('confirms release only from payment settlement and uses a safe helper fallback', () => {
    const strip = describeJobStrip({
      role: 'poster',
      viewerId: 'poster-1',
      counterpartId: 'applicant-1',
      bounty: { ...hired, status: 'completed', accepted_by: 'hunter-1' },
      counterpartName: 'Jordan',
      paymentState: 'released',
    });
    expect(strip.text).toBe('You posted this · Released to your helper');
  });

  it('archived completed work uses the completed, read-only strip', () => {
    const strip = describeJobStrip({
      role: 'hunter',
      viewerId: HUNTER,
      bounty: { ...hired, status: 'archived', completed_at: '2026-01-01' },
      counterpartName: 'Jordan',
      paymentState: 'released',
    });
    expect(strip.text).toMatch(/^You did this · \$\d+(\.\d\d)? released to your wallet$/);
  });

  it('after confirmed approval: released to the wallet, never "paid"', () => {
    const strip = describeJobStrip({
      role: 'hunter',
      viewerId: HUNTER,
      bounty: { ...hired, status: 'completed' },
      counterpartName: 'Jordan',
      paymentState: 'released',
    });
    expect(strip.text).toMatch(/^You did this · \$\d+(\.\d\d)? released to your wallet$/);
    expect(strip.text).not.toMatch(/paid/i);
  });

  it('someone else chosen: still "You offered", no money claimed', () => {
    const strip = describeJobStrip({ role: 'hunter', viewerId: HUNTER, bounty: { ...hired, accepted_by: 'other' }, counterpartName: 'Jordan' });
    expect(strip.side).toBe('offered');
    expect(strip.text).not.toMatch(/held/);
  });
});
