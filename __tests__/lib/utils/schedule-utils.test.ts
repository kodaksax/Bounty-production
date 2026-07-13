import type { BountySchedule } from '../../../lib/types';
import {
    DURATION_PRESETS,
    formatDuration,
    formatScheduleDescription,
    formatTimeOnly,
    getScheduleChip,
    schedulePresetToDates,
} from '../../../lib/utils/schedule-utils';

/**
 * Fixed reference "now": Saturday, July 4 2026, 10:00 local time.
 * All relative-time assertions are computed against this instant so the
 * suite is deterministic regardless of the machine's clock.
 */
const NOW = new Date(2026, 6, 4, 10, 0, 0);

/** Build a local ISO string for the given components (month is 0-based). */
const iso = (y: number, mo: number, d: number, h: number, mi = 0): string =>
  new Date(y, mo, d, h, mi, 0).toISOString();

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

describe('DURATION_PRESETS', () => {
  test('is a non-empty, ascending list of presets', () => {
    expect(DURATION_PRESETS.length).toBeGreaterThan(0);
    for (let i = 1; i < DURATION_PRESETS.length; i++) {
      expect(DURATION_PRESETS[i].minutes).toBeGreaterThan(DURATION_PRESETS[i - 1].minutes);
    }
    // Every preset carries a human label
    DURATION_PRESETS.forEach(p => expect(typeof p.label).toBe('string'));
  });
});

describe('formatDuration', () => {
  test('renders minutes under an hour', () => {
    expect(formatDuration(5)).toBe('5 min');
    expect(formatDuration(30)).toBe('30 min');
    expect(formatDuration(59)).toBe('59 min');
  });

  test('renders ~1 hr between 60 and 119 minutes', () => {
    expect(formatDuration(60)).toBe('~1 hr');
    expect(formatDuration(119)).toBe('~1 hr');
  });

  test('renders rounded hours between 2 and 8 hours', () => {
    expect(formatDuration(120)).toBe('~2 hrs');
    expect(formatDuration(240)).toBe('~4 hrs');
    expect(formatDuration(479)).toBe('~8 hrs');
  });

  test('renders half day and full day bands', () => {
    expect(formatDuration(480)).toBe('Half day');
    expect(formatDuration(959)).toBe('Half day');
    expect(formatDuration(960)).toBe('Full day');
    expect(formatDuration(1439)).toBe('Full day');
  });

  test('renders multi-day durations', () => {
    expect(formatDuration(1440)).toBe('1d+');
    expect(formatDuration(2880)).toBe('2d+');
  });
});

describe('formatTimeOnly', () => {
  test('formats on-the-hour times without minutes', () => {
    expect(formatTimeOnly(iso(2026, 6, 4, 19, 0))).toBe('7 PM');
    expect(formatTimeOnly(iso(2026, 6, 4, 9, 0))).toBe('9 AM');
  });

  test('formats times with zero-padded minutes', () => {
    expect(formatTimeOnly(iso(2026, 6, 4, 9, 5))).toBe('9:05 AM');
    expect(formatTimeOnly(iso(2026, 6, 4, 19, 30))).toBe('7:30 PM');
  });

  test('handles midnight and noon boundaries', () => {
    expect(formatTimeOnly(iso(2026, 6, 4, 0, 0))).toBe('12 AM');
    expect(formatTimeOnly(iso(2026, 6, 4, 12, 0))).toBe('12 PM');
  });
});

describe('getScheduleChip', () => {
  test('returns null when schedule type is absent', () => {
    expect(getScheduleChip(undefined)).toBeNull();
    expect(getScheduleChip(null)).toBeNull();
  });

  test('ASAP is the highest-urgency chip', () => {
    expect(getScheduleChip('asap')).toEqual({ label: 'ASAP', icon: '🔴', variant: 'urgent' });
  });

  test('flexible falls back to a duration hint or a generic label', () => {
    expect(getScheduleChip('flexible', null, null, 240)).toEqual({
      label: '~~4 hrs',
      icon: '⏱',
      variant: 'muted',
    });
    expect(getScheduleChip('flexible')).toEqual({
      label: 'Flexible',
      icon: '📅',
      variant: 'muted',
    });
  });

  describe('scheduled — end date drives urgency', () => {
    test('past end date renders as expired', () => {
      const chip = getScheduleChip('scheduled', null, iso(2026, 6, 4, 9, 0));
      expect(chip).toEqual({ label: 'Expired', icon: '⌛', variant: 'muted' });
    });

    test('under 2 hours remaining shows hours left', () => {
      const chip = getScheduleChip('scheduled', null, iso(2026, 6, 4, 11, 0));
      expect(chip).toEqual({ label: '1h left', icon: '⏳', variant: 'urgent' });
    });

    test('under 30 minutes remaining shows minutes left', () => {
      const chip = getScheduleChip('scheduled', null, iso(2026, 6, 4, 10, 20));
      expect(chip).toEqual({ label: '20m left', icon: '⏳', variant: 'urgent' });
    });

    test('due later today shows a warning chip', () => {
      const chip = getScheduleChip('scheduled', null, iso(2026, 6, 4, 22, 0));
      expect(chip).toEqual({ label: 'Due Today', icon: '🟠', variant: 'warning' });
    });

    test('due tomorrow shows a normal chip', () => {
      const chip = getScheduleChip('scheduled', null, iso(2026, 6, 5, 15, 0));
      expect(chip).toEqual({ label: 'Due Tomorrow', icon: '🟡', variant: 'normal' });
    });
  });

  describe('scheduled — start date drives labeling when no end urgency', () => {
    test('starting within the hour is a warning', () => {
      const chip = getScheduleChip('scheduled', iso(2026, 6, 4, 10, 30));
      expect(chip).toEqual({ label: 'Starting Soon', icon: '⚡', variant: 'warning' });
    });

    test('starting later today shows the start time', () => {
      const chip = getScheduleChip('scheduled', iso(2026, 6, 4, 14, 0));
      expect(chip).toEqual({ label: 'Starts 2 PM', icon: '⏰', variant: 'normal' });
    });

    test('starting tomorrow shows a tomorrow chip', () => {
      const chip = getScheduleChip('scheduled', iso(2026, 6, 5, 9, 0));
      expect(chip).toEqual({ label: 'Tomorrow', icon: '📅', variant: 'normal' });
    });

    test('starting later this week shows a dated chip', () => {
      const chip = getScheduleChip('scheduled', iso(2026, 6, 7, 9, 0));
      expect(chip).toEqual({ label: 'Jul 7', icon: '📅', variant: 'normal' });
    });

    test('starting beyond this week is muted', () => {
      const chip = getScheduleChip('scheduled', iso(2026, 6, 20, 9, 0));
      expect(chip).toEqual({ label: 'Jul 20', icon: '📅', variant: 'muted' });
    });
  });

  describe('scheduled — no dates', () => {
    test('uses duration as a fallback when present', () => {
      const chip = getScheduleChip('scheduled', null, null, 120);
      expect(chip).toEqual({ label: '~~2 hrs', icon: '⌛', variant: 'muted' });
    });

    test('returns null when nothing else is known', () => {
      expect(getScheduleChip('scheduled')).toBeNull();
    });
  });
});

describe('formatScheduleDescription', () => {
  test('describes ASAP schedules', () => {
    expect(formatScheduleDescription({ type: 'asap' })).toBe('Needed ASAP');
  });

  test('describes flexible schedules', () => {
    expect(formatScheduleDescription({ type: 'flexible' })).toBe('Flexible schedule');
  });

  test('describes a start time today', () => {
    const schedule: BountySchedule = { type: 'scheduled', startDate: iso(2026, 6, 4, 14, 0) };
    expect(formatScheduleDescription(schedule)).toBe('Today at 2 PM');
  });

  test('describes a start time tomorrow', () => {
    const schedule: BountySchedule = { type: 'scheduled', startDate: iso(2026, 6, 5, 8, 30) };
    expect(formatScheduleDescription(schedule)).toBe('Tomorrow at 8:30 AM');
  });

  test('describes a future start date with a full date', () => {
    const schedule: BountySchedule = { type: 'scheduled', startDate: iso(2026, 6, 10, 14, 0) };
    expect(formatScheduleDescription(schedule)).toBe('Starts Jul 10, 2 PM');
  });

  test('describes a future start date with an AM time and minutes', () => {
    const schedule: BountySchedule = { type: 'scheduled', startDate: iso(2026, 6, 10, 8, 15) };
    expect(formatScheduleDescription(schedule)).toBe('Starts Jul 10, 8:15 AM');
  });

  test('describes a future start date at noon', () => {
    const schedule: BountySchedule = { type: 'scheduled', startDate: iso(2026, 6, 10, 12, 0) };
    expect(formatScheduleDescription(schedule)).toBe('Starts Jul 10, 12 PM');
  });

  test('describes an end-only deadline today', () => {
    const schedule: BountySchedule = { type: 'scheduled', endDate: iso(2026, 6, 4, 18, 0) };
    expect(formatScheduleDescription(schedule)).toBe('Due today by 6 PM');
  });

  test('describes an end-only deadline on a future date', () => {
    const schedule: BountySchedule = { type: 'scheduled', endDate: iso(2026, 6, 6, 17, 0) };
    expect(formatScheduleDescription(schedule)).toBe('Due by Jul 6, 5 PM');
  });

  test('joins a start and end window', () => {
    const schedule: BountySchedule = {
      type: 'scheduled',
      startDate: iso(2026, 6, 4, 14, 0),
      endDate: iso(2026, 6, 4, 18, 0),
    };
    expect(formatScheduleDescription(schedule)).toBe('Today at 2 PM · until 6 PM');
  });

  test('appends conditional end, arrival and duration notes', () => {
    const schedule: BountySchedule = {
      type: 'scheduled',
      startDate: iso(2026, 6, 4, 14, 0),
      endDate: iso(2026, 6, 4, 18, 0),
      conditionalEndNote: 'until the first Associate arrives',
      latestArrivalTime: iso(2026, 6, 4, 15, 0),
      durationMinutes: 120,
    };
    expect(formatScheduleDescription(schedule)).toBe(
      'Today at 2 PM · until 6 PM · or until the first Associate arrives · Arrive by 3 PM · ~~2 hrs'
    );
  });

  test('falls back gracefully when a scheduled entry has no details', () => {
    expect(formatScheduleDescription({ type: 'scheduled' })).toBe('No schedule set');
  });
});

describe('schedulePresetToDates', () => {
  test('today spans 9 AM to end of day today', () => {
    const { startDate, endDate } = schedulePresetToDates('today');
    const start = new Date(startDate);
    const end = new Date(endDate);

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(6);
    expect(start.getDate()).toBe(4);
    expect(start.getHours()).toBe(9);
    expect(start.getMinutes()).toBe(0);

    expect(end.getDate()).toBe(4);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  test('tomorrow spans 9 AM to end of the next day', () => {
    const { startDate, endDate } = schedulePresetToDates('tomorrow');
    const start = new Date(startDate);
    const end = new Date(endDate);

    expect(start.getDate()).toBe(5);
    expect(start.getHours()).toBe(9);
    expect(end.getDate()).toBe(5);
    expect(end.getHours()).toBe(23);
  });

  test('this_week starts today at 9 AM and ends seven days out', () => {
    const { startDate, endDate } = schedulePresetToDates('this_week');
    const start = new Date(startDate);
    const end = new Date(endDate);

    expect(start.getDate()).toBe(4);
    expect(start.getHours()).toBe(9);
    expect(end.getDate()).toBe(11);
    expect(end.getHours()).toBe(23);
  });
});
