/**
 * Unit tests for Date Utilities
 */

import { formatDate, formatRelativeTime, formatDateForGrouping, formatTime } from '../../../lib/utils/date-utils';

describe('Date Utils', () => {
  // Fixed date for consistent testing
  const fixedDate = new Date('2024-01-15T14:30:00');
  const todayDate = new Date();
  const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const oldDate = new Date('2023-12-01T10:00:00');

  describe('formatDate', () => {
    it('should format today\'s date with time', () => {
      const result = formatDate(todayDate);
      expect(result).toMatch(/^Today, \d{1,2}:\d{2} (AM|PM)$/);
    });

    it('should format yesterday\'s date with time', () => {
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
