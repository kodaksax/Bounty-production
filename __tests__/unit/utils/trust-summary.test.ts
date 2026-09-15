import { formatHunterTrustSummary, MIN_RATING_SAMPLE } from '../../../lib/utils/trust-summary';

describe('formatHunterTrustSummary', () => {
  test('new hunter: no completions, no ratings -> "New to Bounty"', () => {
    expect(formatHunterTrustSummary({ hunterCompleted: 0, averageRating: 0, ratingCount: 0 })).toBe(
      'New to Bounty'
    );
  });

  test('hunter with completed jobs but no ratings shows only the count, never "★0"', () => {
    const result = formatHunterTrustSummary({ hunterCompleted: 3, averageRating: 0, ratingCount: 0 });
    expect(result).toBe('3 bounties done');
    expect(result).not.toContain('★');
    expect(result).not.toContain('0');
  });

  test('below MIN_RATING_SAMPLE ratings: average is hidden even though it exists', () => {
    expect(MIN_RATING_SAMPLE).toBe(3);
    const result = formatHunterTrustSummary({ hunterCompleted: 3, averageRating: 5, ratingCount: 2 });
    expect(result).toBe('3 bounties done');
    expect(result).not.toContain('★');
  });

  test('at MIN_RATING_SAMPLE ratings: average is shown alongside the completed count', () => {
    const result = formatHunterTrustSummary({ hunterCompleted: 3, averageRating: 4.9, ratingCount: 4 });
    expect(result).toBe('3 bounties done · ★4.9 (4)');
  });

  test('singular "bounty" for exactly one completion', () => {
    expect(formatHunterTrustSummary({ hunterCompleted: 1, averageRating: 0, ratingCount: 0 })).toBe(
      '1 bounty done'
    );
  });

  test('0 completions but a meaningful rating sample still shows the rating', () => {
    const result = formatHunterTrustSummary({ hunterCompleted: 0, averageRating: 4.2, ratingCount: 5 });
    expect(result).toBe('★4.2 (5)');
  });

  test('never renders a bare zero star for any input combination below threshold', () => {
    for (const ratingCount of [0, 1, 2]) {
      const result = formatHunterTrustSummary({ hunterCompleted: 0, averageRating: 0, ratingCount });
      expect(result).not.toMatch(/★0/);
    }
  });

  test('negative/garbage input is clamped rather than producing "-1 bounties done"', () => {
    const result = formatHunterTrustSummary({ hunterCompleted: -5, averageRating: NaN, ratingCount: -2 });
    expect(result).toBe('New to Bounty');
  });

  test('null average with a meaningful rating count never renders "★0.0" (missing data is not a real zero)', () => {
    const result = formatHunterTrustSummary({ hunterCompleted: 3, averageRating: null, ratingCount: 5 });
    expect(result).toBe('3 bounties done');
    expect(result).not.toContain('★');
  });

  test('NaN/garbage average with a meaningful rating count is also suppressed', () => {
    const result = formatHunterTrustSummary({ hunterCompleted: 3, averageRating: NaN, ratingCount: 5 });
    expect(result).toBe('3 bounties done');
    expect(result).not.toContain('★');
  });
});
