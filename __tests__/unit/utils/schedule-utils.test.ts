/**
 * Unit tests for schedule-utils — getScheduleChip and formatDuration.
 */

import { formatDuration, getScheduleChip } from '../../../lib/utils/schedule-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns an ISO string offset by `offsetMs` milliseconds from `now`. */
function isoFromNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  it('returns minutes for values under 60', () => {
    expect(formatDuration(30)).toBe('30 min');
  });

  it('returns ~1 hr for exactly 60 minutes', () => {
    expect(formatDuration(60)).toBe('~1 hr');
  });

  it('returns ~N hrs for values between 120 and 479', () => {
    expect(formatDuration(120)).toBe('~2 hrs');
    expect(formatDuration(240)).toBe('~4 hrs');
  });

  it('returns Half day for 480–959', () => {
    expect(formatDuration(480)).toBe('Half day');
    expect(formatDuration(958)).toBe('Half day');
  });

  it('returns Full day for 960–1439', () => {
    expect(formatDuration(960)).toBe('Full day');
    expect(formatDuration(1439)).toBe('Full day');
  });

  it('returns d+ notation for 1440 and above', () => {
    expect(formatDuration(1440)).toBe('1d+');
    expect(formatDuration(2880)).toBe('2d+');
  });
});

// ---------------------------------------------------------------------------
// getScheduleChip — schedule type cases
// ---------------------------------------------------------------------------

describe('getScheduleChip', () => {
  describe('ASAP schedule type', () => {
    it('returns the ASAP urgent chip', () => {
      const chip = getScheduleChip('asap', null, null, null);
      expect(chip).toEqual({ label: 'ASAP', icon: '🔴', variant: 'urgent' });
    });

    it('ignores dates when schedule_type is asap', () => {
      const chip = getScheduleChip('asap', isoFromNow(DAY), isoFromNow(2 * DAY), null);
      expect(chip?.variant).toBe('urgent');
    });
  });

  describe('flexible schedule type', () => {
    it('returns a Flexible muted chip when no duration', () => {
      const chip = getScheduleChip('flexible', null, null, null);
      expect(chip).toEqual({ label: 'Flexible', icon: '📅', variant: 'muted' });
    });

    it('returns a duration chip when durationMinutes is provided', () => {
      const chip = getScheduleChip('flexible', null, null, 60);
      expect(chip?.label).toBe('~~1 hr');
      expect(chip?.variant).toBe('muted');
    });
  });

  describe('scheduled — end date urgency', () => {
    it('returns Expired chip for past end dates', () => {
      const chip = getScheduleChip('scheduled', null, isoFromNow(-HOUR), null);
      expect(chip).toEqual({ label: 'Expired', icon: '⌛', variant: 'muted' });
    });

    it('returns minutes-remaining chip when under 2 hours remain', () => {
      // Use 15 minutes — Math.round(15/60) = 0, so label is "15m left"
      const chip = getScheduleChip('scheduled', null, isoFromNow(15 * MIN), null);
      expect(chip?.variant).toBe('urgent');
      expect(chip?.label).toMatch(/m left/);
    });

    it('returns hours-remaining chip when 1–2 hours remain', () => {
      const chip = getScheduleChip('scheduled', null, isoFromNow(90 * MIN), null);
      expect(chip?.variant).toBe('urgent');
      expect(chip?.label).toMatch(/h left/);
    });

    it('returns Due Today chip for an end date later today (>2 hrs away)', () => {
      // Pick a time well into the future but still today
      const chip = getScheduleChip('scheduled', null, isoFromNow(6 * HOUR), null);
      // Due Today is only returned when the end date is the same calendar day
      // and more than 2 hours away. If the test runs close to midnight the end
      // date could fall on the next day, so we guard with a conditional.
      const end = new Date(Date.now() + 6 * HOUR);
      const now = new Date();
      if (end.toDateString() === now.toDateString()) {
        expect(chip).toEqual({ label: 'Due Today', icon: '🟠', variant: 'warning' });
      } else {
        // Ran near midnight — end is tomorrow, chip should say "Due Tomorrow"
        expect(chip).toEqual({ label: 'Due Tomorrow', icon: '🟡', variant: 'normal' });
      }
    });

    it('returns Due Tomorrow chip for an end date tomorrow', () => {
      const chip = getScheduleChip('scheduled', null, isoFromNow(DAY + HOUR), null);
      // Guard: if the test runs near midnight, +25 h might still be "today"
      const end = new Date(Date.now() + DAY + HOUR);
      const today = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (end.toDateString() === tomorrow.toDateString()) {
        expect(chip).toEqual({ label: 'Due Tomorrow', icon: '🟡', variant: 'normal' });
      } else if (end.toDateString() === today.toDateString()) {
        expect(chip?.label).toBe('Due Today');
      }
    });
  });

  describe('scheduled — start date chips', () => {
    it('returns Starting Soon when start is within 60 minutes', () => {
      const chip = getScheduleChip('scheduled', isoFromNow(30 * MIN), null, null);
      expect(chip).toEqual({ label: 'Starting Soon', icon: '⚡', variant: 'warning' });
    });

    it('returns a Starts-time chip for a future start today', () => {
      const chip = getScheduleChip('scheduled', isoFromNow(2 * HOUR), null, null);
      const start = new Date(Date.now() + 2 * HOUR);
      const today = new Date();
      if (start.toDateString() === today.toDateString()) {
        expect(chip?.label).toMatch(/^Starts /);
        expect(chip?.variant).toBe('normal');
      }
    });

    it('returns Tomorrow chip when start is on the next calendar day', () => {
      const chip = getScheduleChip('scheduled', isoFromNow(DAY + HOUR), null, null);
      const start = new Date(Date.now() + DAY + HOUR);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (start.toDateString() === tomorrow.toDateString()) {
        expect(chip).toEqual({ label: 'Tomorrow', icon: '📅', variant: 'normal' });
      }
    });
  });

  describe('scheduled — duration fallback', () => {
    it('returns a duration chip when no dates are provided', () => {
      const chip = getScheduleChip('scheduled', null, null, 120);
      expect(chip?.label).toBe('~~2 hrs');
      expect(chip?.variant).toBe('muted');
    });
  });

  describe('no schedule type', () => {
    it('returns null when scheduleType is undefined', () => {
      const chip = getScheduleChip(undefined, null, null, null);
      expect(chip).toBeNull();
    });

    it('returns null when scheduleType is null', () => {
      const chip = getScheduleChip(null, null, null, null);
      expect(chip).toBeNull();
    });
  });
});
