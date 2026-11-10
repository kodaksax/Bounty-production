/**
 * Step 1's hint and blocked-tap wording (app/screens/CreateBounty/quick/stepTaskCopy.ts).
 *
 * The 20-character floor itself is pinned here too: the server refuses a
 * shorter in-person description (20261019230000_posting_quality_rules), so the
 * composer must never ask for less.
 */
import {
  MIN_DETAIL_LENGTH,
  stepTaskBlockedNotice,
  stepTaskHint,
} from '../../app/screens/CreateBounty/quick/stepTaskCopy';
import { validateDescription } from '../../lib/utils/bounty-validation';

const TITLE = 'Walk my dog';
const hint = (detail: string, missingField: Parameters<typeof stepTaskHint>[0]['missingField'] = null, title = TITLE) =>
  stepTaskHint({ title, detail, missingField });

describe('MIN_DETAIL_LENGTH', () => {
  it('matches the validator the server mirrors', () => {
    expect(MIN_DETAIL_LENGTH).toBe(20);
    expect(validateDescription('x'.repeat(19))).not.toBeNull();
    expect(validateDescription('x'.repeat(20))).toBeNull();
  });
});

describe('stepTaskHint by details length', () => {
  it('0 characters: asks for what and when', () => {
    expect(hint('', 'description')).toBe('Add what and when to continue');
    // Whitespace alone is still nothing.
    expect(hint('   ', 'description')).toBe('Add what and when to continue');
  });

  it.each([
    [1, '19 more letters'],
    [8, '12 more letters'],
    [19, '1 more letter'],
  ])('%i characters: counts down in letters (%s)', (length, expected) => {
    expect(hint('x'.repeat(length), 'description')).toBe(expected);
  });

  it('counts trimmed, like the validator', () => {
    expect(hint(`  ${'x'.repeat(19)}  `, 'description')).toBe('1 more letter');
  });

  it.each([20, 21, 200])('%i characters: says what comes next', (length) => {
    expect(hint('x'.repeat(length))).toBe('Location and reward come next');
  });

  it('20+ characters but no usable title: points back at the title', () => {
    expect(hint('x'.repeat(25), 'title', '')).toBe('Name the job to continue');
  });

  it('20+ characters with contact details: says to remove them', () => {
    expect(hint('x'.repeat(25), 'contact')).toBe('Remove contact details to continue');
  });

  it('becomes a counter on long titles', () => {
    expect(hint('', 'description', 'x'.repeat(95))).toBe('95/120');
  });
});

describe('stepTaskBlockedNotice', () => {
  const notice = (title: string, detail: string, missingField: Parameters<typeof stepTaskBlockedNotice>[0]['missingField']) =>
    stepTaskBlockedNotice({ title, detail, missingField });

  it('names the details field and what is left', () => {
    expect(notice(TITLE, 'Saturday', 'description')).toBe(
      'Add a few words about what and when — 12 more letters'
    );
    expect(notice(TITLE, '', 'description')).toBe(
      'Add a few words about what and when — 20 more letters'
    );
    expect(notice(TITLE, 'x'.repeat(19), 'description')).toBe(
      'Add a few words about what and when — 1 more letter'
    );
  });

  it('asks for the job first when the title is empty', () => {
    expect(notice('', '', 'title')).toBe('Say what you need done first, like “walk my dog”');
  });

  it('counts a too-short title up to its 5-letter minimum', () => {
    expect(notice('abc', 'x'.repeat(20), 'title')).toBe('Name the job in a few words — 2 more letters');
  });

  it('says to take out contact details', () => {
    expect(notice(TITLE, 'call 410-555-1212', 'contact')).toBe(
      'Take out the phone number, email or link to continue'
    );
  });

  it('says nothing once Next is enabled', () => {
    expect(notice(TITLE, 'x'.repeat(20), null)).toBeNull();
  });
});
