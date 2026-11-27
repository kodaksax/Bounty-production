/**
 * E2E-04 / E2E-05: hired → working → silent, from the helper's own messages.
 * Silence = now − (the later of the hire and the helper's last message they
 * sent) ≥ FOCUS_POLICY.silenceThresholdHours (48). System cards and the
 * poster's messages never reset it.
 */
import { FOCUS_POLICY } from '../../../lib/constants/focus-policy';
import { buildHireWelcomeMessage } from '../../../lib/messaging/hire-welcome';
import {
  isPersonMessage,
  lastPersonMessageAt,
  othersClosedLine,
  sinceDay,
  resolveHiredPhase,
  type ThreadMessage,
} from '../../../lib/utils/hired-phase';

const HELPER = 'ana';
const POSTER = 'lee';
const HIRED_AT = '2026-11-20T10:00:00Z';
const H = 3_600_000;
const after = (hours: number) => new Date(new Date(HIRED_AT).getTime() + hours * H);
const msg = (senderId: string, at: Date | string, over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  senderId,
  createdAt: typeof at === 'string' ? at : at.toISOString(),
  text: 'hello',
  messageType: 'text',
  ...over,
});

function phase(messages: ThreadMessage[], now: Date, hiredAt: string | null = HIRED_AT) {
  return resolveHiredPhase({
    hiredAt,
    helperLastMessageAt: lastPersonMessageAt(messages, HELPER),
    thresholdHours: FOCUS_POLICY.silenceThresholdHours,
    now,
  })!;
}

it('the decided threshold is 48 hours', () => {
  expect(FOCUS_POLICY.silenceThresholdHours).toBe(48);
});

describe('time travel around the threshold', () => {
  it('hired, no word: HIRED at 47 h, SILENT at 49 h, silent since the hire', () => {
    expect(phase([], after(47)).phase).toBe('hired');
    const silent = phase([], after(49));
    expect(silent.phase).toBe('silent');
    expect(silent.silentSince).toBe(new Date(HIRED_AT).toISOString());
  });

  it('after the helper last wrote: WORKING at threshold − 1 h, SILENT at + 1 h, silent since that message', () => {
    const spoke = after(5);
    const msgs = [msg(HELPER, spoke)];
    expect(phase(msgs, new Date(spoke.getTime() + 47 * H)).phase).toBe('working');
    const silent = phase(msgs, new Date(spoke.getTime() + 49 * H));
    expect(silent.phase).toBe('silent');
    expect(silent.silentSince).toBe(spoke.toISOString());
  });

  it('exactly at the threshold counts as silent', () => {
    expect(phase([], after(48)).phase).toBe('silent');
  });

  it('a null threshold switches silence off', () => {
    expect(resolveHiredPhase({ hiredAt: HIRED_AT, helperLastMessageAt: null, thresholdHours: null, now: after(500) })?.phase).toBe('hired');
  });
});

describe('no hire time, no phase', () => {
  // A failed hire-time read must not let an old pre-hire question pass for
  // silence, or a recent one for work.
  it.each([null, '', 'not a date'])('hiredAt %p → null', (hiredAt) => {
    const old = [msg(HELPER, after(-72))];
    expect(phase(old, after(1), hiredAt as string | null)).toBeNull();
    expect(phase([msg(HELPER, after(-1))], after(1), hiredAt as string | null)).toBeNull();
    expect(phase([], after(500), hiredAt as string | null)).toBeNull();
  });
});

describe('what counts as the helper talking', () => {
  it('a system card in the helper\'s name ("Applied to this bounty.") does not reset silence', () => {
    const msgs = [msg(HELPER, after(40), { messageType: 'system', text: 'Applied to this bounty.' })];
    expect(phase(msgs, after(49)).phase).toBe('silent');
    expect(phase(msgs, after(10)).phase).toBe('hired');
  });

  it("the poster's own messages do not reset silence", () => {
    const msgs = [msg(POSTER, after(30)), msg(POSTER, after(45))];
    expect(phase(msgs, after(49)).phase).toBe('silent');
  });

  it("the app's hire welcome is not anyone talking", () => {
    expect(isPersonMessage({ text: buildHireWelcomeMessage('Garage'), messageType: 'text' })).toBe(false);
  });

  it("the helper's text does reset it", () => {
    const msgs = [msg(HELPER, after(40))];
    expect(phase(msgs, after(49)).phase).toBe('working');
  });

  it("a photo the helper sends (media, no text) counts; only system cards don't", () => {
    expect(isPersonMessage({ text: '', messageType: 'text' })).toBe(true);
    expect(isPersonMessage({ text: 'Submitted the work for review.', messageType: 'system' })).toBe(false);
  });

  it('HIRED → WORKING on the helper\'s first message after the hire', () => {
    expect(phase([], after(1)).phase).toBe('hired');
    expect(phase([msg(HELPER, after(1))], after(2)).phase).toBe('working');
  });

  it("questions before the hire don't make it WORKING, and the hire starts the silence clock", () => {
    const before = [msg(HELPER, '2026-11-19T10:00:00Z')];
    expect(phase(before, after(2)).phase).toBe('hired');
    const silent = phase(before, after(49));
    expect(silent.phase).toBe('silent');
    expect(silent.silentSince).toBe(new Date(HIRED_AT).toISOString());
  });

  it('a hire time stored without a zone is read as UTC', () => {
    expect(phase([], new Date('2026-11-22T09:30:00Z'), '2026-11-20 10:00:00').phase).toBe('hired');
    expect(phase([], new Date('2026-11-22T10:30:00Z'), '2026-11-20 10:00:00').phase).toBe('silent');
  });
});

describe('othersClosedLine', () => {
  it('names the others by first name, and adds "told" only when asked', () => {
    expect(othersClosedLine(['Ted K.', 'Sam'], false)).toBe("Ted's and Sam's offers are closed");
    expect(othersClosedLine(['Ted'], false)).toBe("Ted's offer is closed");
    expect(othersClosedLine(['A', 'B', 'C', 'D'], false)).toBe('The other 4 offers are closed');
    expect(othersClosedLine(['Ted'], true)).toBe("Ted's offer is closed and they've been told");
    expect(othersClosedLine([], false)).toBeNull();
  });
});

describe('sinceDay: weekday names only within the last 6 days', () => {
  // Local-time noon, so the test reads the same in any timezone.
  const NOW = new Date(2026, 10, 25, 12, 0); // Wednesday 25 Nov 2026
  const daysAgo = (n: number) => new Date(2026, 10, 25 - n, 9, 0).toISOString();

  it('today and yesterday by name', () => {
    expect(sinceDay(daysAgo(0), NOW)).toBe('today');
    expect(sinceDay(daysAgo(1), NOW)).toBe('yesterday');
  });
  it('a weekday from 2 to 6 days back ("since Thursday")', () => {
    expect(sinceDay(daysAgo(6), NOW)).toBe('Thursday');
    expect(sinceDay(daysAgo(2), NOW)).toBe('Monday');
  });
  it('the date from 7 days back ("since 18 Nov")', () => {
    expect(sinceDay(daysAgo(7), NOW)).toBe('18 Nov');
    expect(sinceDay(daysAgo(40), NOW)).toBe('16 Oct');
  });
  it('nothing for an unknown time', () => {
    expect(sinceDay(null, NOW)).toBeNull();
  });
});

describe('PERSON_MESSAGE_RULE', () => {
  it('counts a text, a photo and a file; never a system card or the hire welcome', () => {
    expect(isPersonMessage({ messageType: 'image', text: '' })).toBe(true);
    expect(isPersonMessage({ messageType: 'file', text: '' })).toBe(true);
    expect(isPersonMessage({ messageType: 'system', text: 'Applied to this bounty.' })).toBe(false);
    expect(isPersonMessage({ messageType: 'text', text: buildHireWelcomeMessage('Gate') })).toBe(false);
    expect(isPersonMessage({ messageType: undefined, text: 'local row' })).toBe(true);
  });
});
