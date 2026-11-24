/**
 * Formatting helpers behind My Jobs copy, and the shared bounty cover helper.
 */
import {
  firstName,
  formatJobAmount,
  formatJobDay,
  peopleWant,
} from '../../../lib/my-jobs/format';
import { getBountyCategoryIcon, getBountyCoverUri } from '../../../lib/utils/bounty-cover';

describe('formatJobAmount', () => {
  it('drops cents on whole amounts and keeps them otherwise', () => {
    expect(formatJobAmount(60)).toBe('$60');
    expect(formatJobAmount(60.5)).toBe('$60.50');
    expect(formatJobAmount(1250)).toBe('$1,250');
  });
  it('says "For honor" for honor jobs and $0 for missing amounts', () => {
    expect(formatJobAmount(60, true)).toBe('For honor');
    expect(formatJobAmount(null)).toBe('$0');
  });
});

describe('formatJobDay', () => {
  const now = new Date(2026, 10, 21, 12); // Saturday 21 Nov 2026, local time
  const at = (d: number) => new Date(2026, 10, d, 9).toISOString();
  it('reads as people say it', () => {
    expect(formatJobDay(at(21), now)).toBe('today');
    expect(formatJobDay(at(20), now)).toBe('yesterday');
    expect(formatJobDay(at(16), now)).toBe('Monday');
    expect(formatJobDay(at(4), now)).toBe('Nov 4');
  });
  it('returns null for missing or invalid dates', () => {
    expect(formatJobDay(null, now)).toBeNull();
    expect(formatJobDay('not a date', now)).toBeNull();
  });
});

describe('firstName / peopleWant', () => {
  it('takes the first word of a name', () => {
    expect(firstName(' Ada R. ')).toBe('Ada');
    expect(firstName('')).toBeNull();
    expect(firstName(undefined)).toBeNull();
  });
  it('agrees in number', () => {
    expect(peopleWant(1)).toBe('1 person wants');
    expect(peopleWant(3)).toBe('3 people want');
  });
});

describe('bounty cover', () => {
  it('returns the first uploaded image', () => {
    const json = JSON.stringify([
      { id: 'a', name: 'doc', uri: 'x', mimeType: 'application/pdf', remoteUri: 'https://x/doc.pdf' },
      { id: 'b', name: 'local', uri: 'y', mimeType: 'image/jpeg' },
      { id: 'c', name: 'photo', uri: 'z', mimeType: 'image/png', remoteUri: 'https://x/photo.png' },
    ]);
    expect(getBountyCoverUri(json)).toBe('https://x/photo.png');
  });
  it('returns null for nothing, junk or no images', () => {
    expect(getBountyCoverUri(undefined)).toBeNull();
    expect(getBountyCoverUri('{not json')).toBeNull();
    expect(getBountyCoverUri('{"a":1}')).toBeNull();
    expect(getBountyCoverUri('[]')).toBeNull();
  });
  it('falls back to a neutral icon for unknown categories', () => {
    expect(getBountyCategoryIcon('tech')).toBe('computer');
    expect(getBountyCategoryIcon('TECH')).toBe('computer');
    expect(getBountyCategoryIcon(null)).toBe('work-outline');
    expect(getBountyCategoryIcon('nope')).toBe('work-outline');
  });
});

describe('getFeaturedFlag', () => {
  const { getFeaturedFlag } = jest.requireActual('../../../lib/my-jobs/format');
  const base = { finished: false, needsYou: false, rank: 6, lifecycle: { waitingOn: 'other' } };

  it('says what the job needs in words', () => {
    expect(getFeaturedFlag({ ...base, needsYou: true, rank: 3 }).text).toBe('Needs you');
    expect(getFeaturedFlag({ ...base, needsYou: true, rank: 4 }).text).toBe('New message');
    expect(getFeaturedFlag({ ...base, finished: true, rank: 7 }).text).toBe('Finished');
    expect(getFeaturedFlag(base).text).toBe('Nothing to do yet');
  });

  it('a dispute says Bounty is on it, not that the user must act', () => {
    expect(getFeaturedFlag({ ...base, needsYou: true, rank: 1, lifecycle: { waitingOn: 'support' } })).toEqual(
      expect.objectContaining({ kind: 'help', text: 'Bounty is on it' })
    );
  });
});
