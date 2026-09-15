import { formatRelativeDate } from '../../../lib/utils/format-relative-date';

const DAY_MS = 86_400_000;

describe('formatRelativeDate', () => {
  const NOW = new Date('2026-09-14T12:00:00.000Z').getTime();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function isoDaysAgo(days: number): string {
    return new Date(NOW - days * DAY_MS).toISOString();
  }

  test('missing timestamp: returns empty string', () => {
    expect(formatRelativeDate(undefined)).toBe('');
  });

  test('invalid ISO string: returns empty string rather than "Invalid Date"', () => {
    expect(formatRelativeDate('not-a-date')).toBe('');
  });

  test('future timestamp (clock skew): treated as "Today", not negative days', () => {
    expect(formatRelativeDate(isoDaysAgo(-5))).toBe('Today');
  });

  test('exactly now: "Today"', () => {
    expect(formatRelativeDate(isoDaysAgo(0))).toBe('Today');
  });

  test('exactly 1 day ago: "Yesterday"', () => {
    expect(formatRelativeDate(isoDaysAgo(1))).toBe('Yesterday');
  });

  test('2 days ago: day bucket', () => {
    expect(formatRelativeDate(isoDaysAgo(2))).toBe('2d ago');
  });

  test('boundary just under 30 days: still a day bucket', () => {
    expect(formatRelativeDate(isoDaysAgo(29))).toBe('29d ago');
  });

  test('boundary exactly 30 days: rolls over to month bucket', () => {
    expect(formatRelativeDate(isoDaysAgo(30))).toBe('1mo ago');
  });

  test('boundary just under 12 months (359 days): still a month bucket', () => {
    expect(formatRelativeDate(isoDaysAgo(359))).toBe('11mo ago');
  });

  test('boundary exactly 360 days (12 whole 30-day months): rolls over to year bucket', () => {
    expect(formatRelativeDate(isoDaysAgo(360))).toBe('1y ago');
  });

  test('boundary exactly 365 days: still within the first year bucket', () => {
    expect(formatRelativeDate(isoDaysAgo(365))).toBe('1y ago');
  });

  test('multiple years ago', () => {
    expect(formatRelativeDate(isoDaysAgo(800))).toBe('2y ago');
  });
});
