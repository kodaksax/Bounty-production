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

describe('formatPosterTrustSummary', () => {
  const { formatPosterTrustSummary } = require('../../../lib/utils/trust-summary');

  test('new poster says so plainly; no credibility is manufactured', () => {
    expect(formatPosterTrustSummary({ bountiesCompleted: 0, averageRating: null, ratingCount: 0 })).toBe(
      'No completed bounties yet'
    );
  });

  test('never claims "paid" — completed is a bounty status, not a verified payout', () => {
    const result = formatPosterTrustSummary({ bountiesCompleted: 4, averageRating: 4.8, ratingCount: 4 });
    expect(result).toBe('4 completed bounties · ★4.8 (4)');
    expect(result.toLowerCase()).not.toContain('paid');
  });

  test('singular', () => {
    expect(formatPosterTrustSummary({ bountiesCompleted: 1 })).toBe('1 completed bounty');
  });

  test('rating hidden below MIN_RATING_SAMPLE, same rule as the applicant card', () => {
    expect(formatPosterTrustSummary({ bountiesCompleted: 2, averageRating: 5, ratingCount: 2 })).toBe(
      '2 completed bounties'
    );
  });
});

describe('formatAccountAge', () => {
  const { formatAccountAge } = require('../../../lib/utils/trust-summary');
  const NOW = new Date('2026-10-02T12:00:00.000Z').getTime();
  const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

  test('recent accounts show a day count, not a flattering month', () => {
    expect(formatAccountAge(daysAgo(0), NOW)).toBe('Joined today');
    expect(formatAccountAge(daysAgo(1), NOW)).toBe('Joined yesterday');
    expect(formatAccountAge(daysAgo(3), NOW)).toBe('Joined 3 days ago');
  });

  test('older accounts show month + year', () => {
    expect(formatAccountAge('2026-03-10T00:00:00.000Z', NOW)).toBe('Joined Mar 2026');
  });

  test('missing or invalid -> empty (line omitted, never defaulted to now)', () => {
    expect(formatAccountAge(undefined, NOW)).toBe('');
    expect(formatAccountAge(null, NOW)).toBe('');
    expect(formatAccountAge('not a date', NOW)).toBe('');
  });
});
