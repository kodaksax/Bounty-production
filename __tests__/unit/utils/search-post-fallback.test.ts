/**
 * lib/utils/search-post-fallback.ts — when Search offers "Post it as a
 * bounty", what title it posts, what it reports, and how long it waits
 * before searching.
 */

import {
  SEARCH_DEBOUNCE_BASE_MS,
  SEARCH_DEBOUNCE_MAX_MS,
  countQueryWords,
  postableTitleFromQuery,
  searchDebounceMs,
  searchPostCtaProps,
  titleFromSearchQuery,
} from 'lib/utils/search-post-fallback';
import { validateTitle } from 'lib/utils/bounty-validation';

describe('3-word threshold', () => {
  it('offers the card for the query that prompted it', () => {
    expect(postableTitleFromQuery('Remove home trash to apt.')).toBe('Remove home trash to apt.');
  });

  it('needs three words', () => {
    expect(postableTitleFromQuery('Carry')).toBeNull();
    expect(postableTitleFromQuery('Carry boxes')).toBeNull();
    expect(postableTitleFromQuery('Carry boxes upstairs')).toBe('Carry boxes upstairs');
  });

  it('counts words, not stray spaces or punctuation', () => {
    expect(countQueryWords('  carry   boxes  ')).toBe(2);
    expect(countQueryWords('fix - -')).toBe(1);
    expect(countQueryWords('')).toBe(0);
    expect(countQueryWords(undefined)).toBe(0);
    // Letters outside ASCII count as words.
    expect(countQueryWords('réparer mon évier')).toBe(3);
  });

  it('turns every 3-word query into a title validateTitle accepts', () => {
    // Three one-letter words: 5 characters, the shortest title allowed.
    expect(postableTitleFromQuery('a b c')).toBe('a b c');
    expect(validateTitle('a b c')).toBeNull();
    expect(postableTitleFromQuery('. a b c .')).toBe('. a b c .');
  });
});

describe('titleFromSearchQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(titleFromSearchQuery('  Remove   home\ttrash \n to apt.  ')).toBe('Remove home trash to apt.');
  });

  it('caps at 120 characters and still passes validateTitle', () => {
    const long = 'Carry heavy boxes '.repeat(12);
    const title = titleFromSearchQuery(long);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title).toBe(title.trim());
    expect(validateTitle(title)).toBeNull();
    expect(postableTitleFromQuery(long)).toBe(title);
  });
});

describe('analytics payload', () => {
  it('carries the length and zero-results flag, never the text', () => {
    const query = 'Remove home trash to apt. 123 Main St';
    const props = searchPostCtaProps(query, true);
    expect(props).toEqual({
      query_length: query.length,
      had_zero_results: true,
      entry_point: 'search_fallback',
    });
    const serialized = JSON.stringify(props);
    for (const word of ['Remove', 'trash', 'Main', '123']) {
      expect(serialized).not.toContain(word);
    }
  });

  it('measures the trimmed query, like bounty_search', () => {
    expect(searchPostCtaProps('  fix my sink  ', false).query_length).toBe('fix my sink'.length);
  });
});

describe('searchDebounceMs', () => {
  it('is 300 ms before there is a typing pace', () => {
    expect(searchDebounceMs([])).toBe(SEARCH_DEBOUNCE_BASE_MS);
    expect(searchDebounceMs([900])).toBe(SEARCH_DEBOUNCE_BASE_MS);
  });

  it('stays at 300 ms for a fast typist', () => {
    expect(searchDebounceMs([120, 90, 150, 110])).toBe(300);
  });

  it("stretches to a slow typist's pace", () => {
    // The Nov 7 session: keystrokes 360-1,150 ms apart.
    const delay = searchDebounceMs([578, 546, 480, 635, 825]);
    expect(delay).toBe(Math.round(578 * 1.5));
  });

  it('is capped at 1.2 s', () => {
    expect(searchDebounceMs([1500, 1600, 1700])).toBe(SEARCH_DEBOUNCE_MAX_MS);
  });

  it('ignores pauses when judging pace', () => {
    expect(searchDebounceMs([100, 120, 12000])).toBe(300);
  });
});
