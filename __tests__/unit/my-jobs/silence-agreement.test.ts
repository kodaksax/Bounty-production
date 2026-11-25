/**
 * E2E-04, item 6: the job page and My Jobs must say the same thing about the
 * same job. The job page computes hired / working / silent from the thread's
 * messages (PERSON_MESSAGE_RULE in TypeScript); My Jobs from the two values
 * get_conversation_summaries returns (the SQL's own filter, evaluated from the
 * migration file). Same fixtures, same answer.
 */
import { buildMyJobs, hiredPhaseFromThread } from '../../../lib/my-jobs/build-my-jobs';
import { buildHireWelcomeMessage } from '../../../lib/messaging/hire-welcome';
import { FOCUS_POLICY } from '../../../lib/constants/focus-policy';
import type { Conversation } from '../../../lib/types';
import { lastPersonMessageAt, resolveHiredPhase, type ThreadMessage } from '../../../lib/utils/hired-phase';
import { sqlLastPersonMessages, type SqlMessageRow } from '../../helpers/person-message-sql';
import { bounty, makeInput, ME, request } from './fixtures';

const POSTER = 'poster-1';
const HELPER = 'helper-1';
const HIRED_AT = '2026-11-20T10:00:00Z';
const at = (hours: number) => new Date(new Date(HIRED_AT).getTime() + hours * 3_600_000).toISOString();

const row = (sender: string, hours: number, message_type: string, text: string): SqlMessageRow => ({
  sender_id: sender,
  created_at: at(hours),
  message_type,
  text,
});

/** Every thread opens the way the app opens it: the applied card, the hire welcome. */
const opening = [
  row(HELPER, -20, 'system', 'Applied to this bounty.'),
  row(POSTER, 0, 'system', 'Accepted the application.'),
  row(POSTER, 0.01, 'text', buildHireWelcomeMessage('Fix the gate')),
];

const FIXTURES: Record<string, { rows: SqlMessageRow[]; nowHours: number; expect: 'hired' | 'working' | 'silent' }> = {
  'a system card last ("Submitted…" in the helper\'s name)': {
    rows: [...opening, row(HELPER, 10, 'text', 'Coming Saturday'), row(HELPER, 60, 'system', 'Submitted the work for review.')],
    nowHours: 72,
    expect: 'silent',
  },
  "the poster's message last": {
    rows: [...opening, row(HELPER, 30, 'text', 'On it'), row(POSTER, 60, 'text', 'Any news?')],
    nowHours: 72,
    expect: 'working',
  },
  "the poster's message last, past the threshold": {
    rows: [...opening, row(HELPER, 30, 'text', 'On it'), row(POSTER, 60, 'text', 'Any news?')],
    nowHours: 80,
    expect: 'silent',
  },
  "the helper's photo last": {
    rows: [...opening, row(HELPER, 5, 'text', 'Hi'), row(HELPER, 60, 'image', '')],
    nowHours: 72,
    expect: 'working',
  },
  'nothing but the opening cards and the welcome': {
    rows: [...opening],
    nowHours: 2,
    expect: 'hired',
  },
};

const toThread = (rows: SqlMessageRow[]): ThreadMessage[] =>
  rows.map((r) => ({ senderId: r.sender_id, createdAt: r.created_at, text: r.text, messageType: r.message_type }));

describe.each(Object.entries(FIXTURES))('%s', (_label, f) => {
  const now = new Date(at(f.nowHours));
  const jobPage = resolveHiredPhase({
    hiredAt: HIRED_AT,
    helperLastMessageAt: lastPersonMessageAt(toThread(f.rows), HELPER),
    thresholdHours: FOCUS_POLICY.silenceThresholdHours,
    now,
  })!;

  it('the job page says it', () => {
    expect(jobPage.phase).toBe(f.expect);
  });

  it("My Jobs agrees, from the poster's conversation summary", () => {
    const s = sqlLastPersonMessages(f.rows, POSTER);
    const conv = { id: 'c', isGroup: false, name: '', participantIds: [POSTER, HELPER], myLastMessageAt: s.mine, otherLastMessageAt: s.other } as Conversation;
    expect(hiredPhaseFromThread([conv], 'other', HIRED_AT, now)).toEqual(jobPage);
  });

  it("My Jobs agrees, from the helper's conversation summary", () => {
    const s = sqlLastPersonMessages(f.rows, HELPER);
    const conv = { id: 'c', isGroup: false, name: '', participantIds: [POSTER, HELPER], myLastMessageAt: s.mine, otherLastMessageAt: s.other } as Conversation;
    expect(hiredPhaseFromThread([conv], 'me', HIRED_AT, now)).toEqual(jobPage);
  });
});

describe('My Jobs cards', () => {
  const NOW = new Date(at(72));
  const silentRows = FIXTURES['a system card last ("Submitted…" in the helper\'s name)'].rows;

  function postedModel(conv: Partial<Conversation>) {
    const job = bounty({ id: 'b1', status: 'in_progress', accepted_by: HELPER, poster_id: ME });
    const input = makeInput({
      postedBounties: [job],
      conversations: [{ id: 'c', isGroup: false, name: 'Ana', participantIds: [ME, HELPER], bountyId: 'b1', ...conv } as Conversation],
      now: NOW,
    });
    input.getHireTime = () => HIRED_AT;
    return buildMyJobs(input).jobs[0];
  }

  it('a silent job is featured: it needs the poster, and says since when', () => {
    // The viewer is the poster here.
    const s = sqlLastPersonMessages(
      silentRows.map((r) => ({ ...r, sender_id: r.sender_id === POSTER ? ME : r.sender_id })),
      ME
    );
    const card = postedModel({ myLastMessageAt: s.mine, otherLastMessageAt: s.other });
    expect(card.needsYou).toBe(true);
    expect(card.status.text).toMatch(/^You haven't heard from Ana since /);
  });

  it('without a hire time (a failed read) no job is called quiet, however old their last word', () => {
    const job = bounty({ id: 'b1', status: 'in_progress', accepted_by: HELPER, poster_id: ME });
    const input = makeInput({
      postedBounties: [job],
      // The helper last wrote 3 days ago, before a hire whose time we couldn't read.
      conversations: [{ id: 'c', isGroup: false, name: 'Ana', participantIds: [ME, HELPER], bountyId: 'b1', myLastMessageAt: null, otherLastMessageAt: at(-72) } as Conversation],
      now: new Date(at(1)),
    });
    input.getHireTime = () => null;
    const card = buildMyJobs(input).jobs[0];
    expect(card.status.text).not.toMatch(/haven't heard/);
    expect(card.needsYou).toBe(false);
  });

  it("a reply in the pair's older conversation (a repeat hire) keeps the job off the quiet list", () => {
    const job = bounty({ id: 'b1', status: 'in_progress', accepted_by: HELPER, poster_id: ME });
    const input = makeInput({
      postedBounties: [job],
      conversations: [
        // This job's thread: nothing from Ana since the hire.
        { id: 'c', isGroup: false, name: 'Ana', participantIds: [ME, HELPER], bountyId: 'b1', myLastMessageAt: null, otherLastMessageAt: null } as Conversation,
        // The pair's first conversation, which a direct message reuses: Ana wrote an hour ago.
        { id: 'd', isGroup: false, name: 'Ana', participantIds: [ME, HELPER], bountyId: 'old', myLastMessageAt: null, otherLastMessageAt: at(71) } as Conversation,
      ],
      now: NOW,
    });
    input.getHireTime = () => HIRED_AT;
    const card = buildMyJobs(input).jobs[0];
    expect(card.status.text).not.toMatch(/haven't heard/);
  });

  it('on the fallback conversation list (no person-message values) no job is called quiet', () => {
    const card = postedModel({ lastMessage: 'Submitted the work for review.' });
    expect(card.status.text).not.toMatch(/haven't heard/);
    expect(card.needsYou).toBe(false);
  });

  it('a helper who has gone quiet sees it on their own card', () => {
    const job = bounty({ id: 'd1', status: 'in_progress', accepted_by: ME, poster_id: POSTER, username: 'Lee' } as any);
    const s = sqlLastPersonMessages(
      silentRows.map((r) => ({ ...r, sender_id: r.sender_id === HELPER ? ME : r.sender_id })),
      ME
    );
    const input = makeInput({
      hunterRequests: [request({ bounty: job, status: 'accepted', accepted_at: HIRED_AT } as any)],
      conversations: [{ id: 'c', isGroup: false, name: 'Lee', participantIds: [ME, POSTER], bountyId: 'd1', myLastMessageAt: s.mine, otherLastMessageAt: s.other } as Conversation],
      now: NOW,
    });
    const card = buildMyJobs(input).jobs[0];
    expect(card.needsYou).toBe(true);
    expect(card.status.text).toMatch(/^Lee hasn't heard from you since /);
  });
});
