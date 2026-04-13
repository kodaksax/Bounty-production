/**
 * Unit tests for Date Utilities
 */

import {
  formatDate,
  formatDateForGrouping,
  formatRelativeTime,
  formatTime,
} from '../../../lib/utils/date-utils';

// Epoch shared by the whole suite so it can be referenced before beforeAll.
const FIXED_NOW = new Date('2024-01-15T14:30:00').getTime();

describe('Date Utils', () => {
  // Set up a deterministic clock without relying on setSystemTime / getEpoch,
  // which fails in some @sinonjs/fake-timers versions.
  beforeAll(() => {
    try {
      // Jest 27+ / @sinonjs/fake-timers 8+: pass `now` at construction time.
      // This avoids the post-construction setSystemTime call that triggers the
      // getEpoch error in certain legacy fake-timers environments.
      jest.useFakeTimers({ now: FIXED_NOW });
    } catch {
      // Fallback for environments that do not support the `now` option:
      // activate fake timers (so setTimeout etc. are controlled) and pin
      // Date.now via a plain spy.
      jest.useFakeTimers();
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    }
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  // Fixed date for consistent testing — derived from the shared FIXED_NOW epoch.
  const fixedDate = new Date(FIXED_NOW);
  let todayDate: Date;
  let yesterdayDate: Date;
  const oldDate = new Date('2023-12-01T10:00:00');

  beforeEach(() => {
    // Create dates after fake timer is set to ensure consistency
    todayDate = new Date();
    yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  });

  describe('formatDate', () => {
    it("should format today's date with time", () => {
      const result = formatDate(todayDate);
      expect(result).toMatch(/^Today, \d{1,2}:\d{2} (AM|PM)$/);
    });

    it("should format yesterday's date with time", () => {
      const result = formatDate(yesterdayDate);
      expect(result).toMatch(/^Yesterday, \d{1,2}:\d{2} (AM|PM)$/);
    });

    it('should format older dates with full date', () => {
      const result = formatDate(oldDate);
      expect(result).toBe('Dec 1, 2023');
    });
  });

  describe('formatRelativeTime', () => {
    it('should format a recent date as relative time', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const result = formatRelativeTime(oneHourAgo);
      expect(result).toContain('ago');
    });

    it('should format a future date with "in"', () => {
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      const result = formatRelativeTime(oneHourFromNow);
      expect(result).toContain('in');
    });

    it('should format a date from several days ago', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const result = formatRelativeTime(threeDaysAgo);
      expect(result).toMatch(/\d+ days? ago/);
    });
  });

  describe('formatDateForGrouping', () => {
    it('should return "Today" for today\'s date', () => {
      const result = formatDateForGrouping(todayDate);
      expect(result).toBe('Today');
    });

    it('should return "Yesterday" for yesterday\'s date', () => {
      const result = formatDateForGrouping(yesterdayDate);
      expect(result).toBe('Yesterday');
    });

    it('should return full formatted date for older dates', () => {
      const result = formatDateForGrouping(oldDate);
      expect(result).toBe('Friday, December 1, 2023');
    });
  });

  describe('formatTime', () => {
    it('should format time in 12-hour format', () => {
      const result = formatTime(fixedDate);
      expect(result).toBe('2:30 PM');
    });

    it('should format morning time correctly', () => {
      const morningDate = new Date('2024-01-15T09:15:00');
      const result = formatTime(morningDate);
      expect(result).toBe('9:15 AM');
    });

    it('should format midnight correctly', () => {
      const midnightDate = new Date('2024-01-15T00:00:00');
      const result = formatTime(midnightDate);
      expect(result).toBe('12:00 AM');
    });

    it('should format noon correctly', () => {
      const noonDate = new Date('2024-01-15T12:00:00');
      const result = formatTime(noonDate);
      expect(result).toBe('12:00 PM');
    });
  });
});
