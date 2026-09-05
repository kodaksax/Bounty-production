/**
 * Unit tests for the profile-completion meter's percentage calculator
 */

import { calculateProfileCompleteness } from '../../lib/utils/profile-completeness';

describe('calculateProfileCompleteness', () => {
  it('is 0% and incomplete for empty input, without throwing', () => {
    expect(() => calculateProfileCompleteness({})).not.toThrow();
    const result = calculateProfileCompleteness({});
    expect(result.percent).toBe(0);
    expect(result.isComplete).toBe(false);
    expect(result.missingItems).toHaveLength(6);
  });

  it('is 100% and complete when all six fields are set', () => {
    const result = calculateProfileCompleteness({
      username: 'alice',
      display_name: 'Alice',
      avatar_url: 'https://example.com/a.jpg',
      bio: 'Hello',
      location: 'NYC',
      banner_url: 'https://example.com/b.jpg',
    });
    expect(result.percent).toBe(100);
    expect(result.isComplete).toBe(true);
    expect(result.missingItems).toHaveLength(0);
  });

  it('treats whitespace-only values as missing', () => {
    const result = calculateProfileCompleteness({ bio: '   ' });
    expect(result.missingItems).toContain('bio');
  });

  it('computes a partial percentage proportional to filled fields', () => {
    const result = calculateProfileCompleteness({
      username: 'alice',
      display_name: 'Alice',
      avatar_url: 'https://example.com/a.jpg',
    });
    // 3 of 6 items set
    expect(result.percent).toBe(50);
    expect(result.completedItems).toEqual(
      expect.arrayContaining(['username', 'display_name', 'avatar_url'])
    );
    expect(result.missingItems).toEqual(expect.arrayContaining(['bio', 'location', 'banner_url']));
  });

  it('never throws on null/undefined field values', () => {
    expect(() =>
      calculateProfileCompleteness({
        username: null,
        display_name: undefined,
        avatar_url: null,
        bio: undefined,
        location: null,
        banner_url: undefined,
      })
    ).not.toThrow();
  });
});
