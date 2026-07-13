/**
 * @fileoverview Utilities for formatting and reasoning about bounty schedules.
 *
 * These helpers turn structured schedule data into human-readable labels and
 * chips suitable for bounty cards, detail views, and notifications.
 */

import type { BountySchedule } from '../types';

// ─── Duration helpers ────────────────────────────────────────────────────────

/** Standard duration presets (minutes → label). */
export const DURATION_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 30, label: '< 1 hr' },
  { minutes: 60, label: '1 hr' },
  { minutes: 120, label: '2 hrs' },
  { minutes: 240, label: '4 hrs' },
  { minutes: 480, label: 'Half day' },
  { minutes: 960, label: 'Full day' },
  { minutes: 1440, label: 'Multi-day' },
];

/** Returns a short human-readable duration string from minutes. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 120) return '~1 hr';
  if (minutes < 480) return `~${Math.round(minutes / 60)} hrs`;
  if (minutes < 960) return 'Half day';
  if (minutes < 1440) return 'Full day';
  return `${Math.round(minutes / 1440)}d+`;
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isTomorrow(date: Date): boolean {
  const tom = new Date();
  tom.setDate(tom.getDate() + 1);
  return (
    date.getFullYear() === tom.getFullYear() &&
    date.getMonth() === tom.getMonth() &&
    date.getDate() === tom.getDate()
  );
}

/**
 * Returns true when `date` falls within the next 7 days from now (inclusive).
 * This is an approximate "this week" check using the device's local time.
 * It does not align to calendar week boundaries (Sun–Sat or Mon–Sun).
 */
function isThisWeek(date: Date): boolean {
  const now = new Date();
  const diffDays = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 7;
}

/** Format a date as "Jul 4" or "Jul 4, 9 PM" depending on whether time matters. */
function formatDateShort(iso: string, includeTime = false): string {
  const d = new Date(iso);
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const base = `${monthNames[d.getMonth()]} ${d.getDate()}`;
  if (!includeTime) return base;
  const hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = d.getMinutes();
  const timeStr =
    minutes === 0
      ? `${displayHour} ${ampm}`
      : `${displayHour}:${String(minutes).padStart(2, '0')} ${ampm}`;
  return `${base}, ${timeStr}`;
}

/** Format a time-only portion of an ISO date string (e.g. "7 PM", "9:30 AM"). */
export function formatTimeOnly(iso: string): string {
  const d = new Date(iso);
  const hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = d.getMinutes();
  return minutes === 0
    ? `${displayHour} ${ampm}`
    : `${displayHour}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

// ─── Deadline helpers ────────────────────────────────────────────────────────

/**
 * True when a bounty's hard deadline (`end_date`) has passed while it's still
 * in an active status (open/in_progress) — i.e. it expired without being
 * completed or cancelled.
 */
export function isBountyDeadlinePassed(bounty: {
  status?: string | null;
  end_date?: string | null;
}): boolean {
  return (
    (bounty.status === 'open' || bounty.status === 'in_progress') &&
    !!bounty.end_date &&
    new Date(bounty.end_date).getTime() <= Date.now()
  );
}

// ─── Chip / badge helpers ────────────────────────────────────────────────────

export type ScheduleChipVariant = 'urgent' | 'warning' | 'normal' | 'muted';

export interface ScheduleChip {
  /** Short label shown on the card chip (e.g. "ASAP", "Due Today", "Jul 4"). */
  label: string;
  /** Emoji/icon prefix suitable for display before the label. */
  icon: string;
  /** Color variant driving the chip's background and text color. */
  variant: ScheduleChipVariant;
}

/**
 * Returns a chip descriptor for the time information on a bounty card.
 * Falls back gracefully when schedule data is partial or absent.
 */
export function getScheduleChip(
  scheduleType?: 'asap' | 'scheduled' | 'flexible' | null,
  startDate?: string | null,
  endDate?: string | null,
  durationMinutes?: number | null
): ScheduleChip | null {
  // ASAP — highest urgency
  if (scheduleType === 'asap') {
    return { label: 'ASAP', icon: '🔴', variant: 'urgent' };
  }

  // Flexible — lowest urgency
  if (scheduleType === 'flexible') {
    if (durationMinutes) {
      return { label: `~${formatDuration(durationMinutes)}`, icon: '⏱', variant: 'muted' };
    }
    return { label: 'Flexible', icon: '📅', variant: 'muted' };
  }

  // Scheduled — use start/end dates to derive urgency
  if (scheduleType === 'scheduled') {
    // End date drives urgency
    if (endDate) {
      const end = new Date(endDate);
      const now = new Date();
      const minsUntilEnd = (end.getTime() - now.getTime()) / 60000;

      if (minsUntilEnd < 0) {
        // Already expired — shouldn't appear in feed but handle gracefully
        return { label: 'Expired', icon: '⌛', variant: 'muted' };
      }
      if (minsUntilEnd < 120) {
        // Under 2 hours remaining
        const hrs = Math.round(minsUntilEnd / 60);
        const mins = Math.round(minsUntilEnd);
        const timeLeft = hrs >= 1 ? `${hrs}h left` : `${mins}m left`;
        return { label: timeLeft, icon: '⏳', variant: 'urgent' };
      }
      if (isToday(end)) {
        return { label: 'Due Today', icon: '🟠', variant: 'warning' };
      }
      if (isTomorrow(end)) {
        return { label: 'Due Tomorrow', icon: '🟡', variant: 'normal' };
      }
    }

    // Start date
    if (startDate) {
      const start = new Date(startDate);
      const now = new Date();
      const minsUntilStart = (start.getTime() - now.getTime()) / 60000;

      if (minsUntilStart > 0 && minsUntilStart < 60) {
        return { label: 'Starting Soon', icon: '⚡', variant: 'warning' };
      }
      if (minsUntilStart >= 0) {
        if (isToday(start)) {
          return { label: `Starts ${formatTimeOnly(startDate)}`, icon: '⏰', variant: 'normal' };
        }
        if (isTomorrow(start)) {
          return { label: 'Tomorrow', icon: '📅', variant: 'normal' };
        }
        if (isThisWeek(start)) {
          return { label: formatDateShort(startDate, false), icon: '📅', variant: 'normal' };
        }
        return { label: formatDateShort(startDate, false), icon: '📅', variant: 'muted' };
      }
    }

    // Only have schedule_type=scheduled but no dates — show duration if available
    if (durationMinutes) {
      return { label: `~${formatDuration(durationMinutes)}`, icon: '⌛', variant: 'muted' };
    }
  }

  // Legacy: is_time_sensitive only (no schedule_type yet)
  // Caller should handle this separately via the existing `is_time_sensitive` prop.

  return null;
}

/**
 * Returns a full human-readable schedule description for detail views.
 * More verbose than getScheduleChip.
 */
export function formatScheduleDescription(schedule: BountySchedule): string {
  const parts: string[] = [];

  switch (schedule.type) {
    case 'asap':
      parts.push('Needed ASAP');
      break;
    case 'flexible':
      parts.push('Flexible schedule');
      break;
    case 'scheduled': {
      if (schedule.startDate) {
        const start = new Date(schedule.startDate);
        if (isToday(start)) {
          parts.push(`Today at ${formatTimeOnly(schedule.startDate)}`);
        } else if (isTomorrow(start)) {
          parts.push(`Tomorrow at ${formatTimeOnly(schedule.startDate)}`);
        } else {
          parts.push(`Starts ${formatDateShort(schedule.startDate, true)}`);
        }
      }

      if (schedule.endDate) {
        const end = new Date(schedule.endDate);
        if (isToday(end) && !schedule.startDate) {
          parts.push(`Due today by ${formatTimeOnly(schedule.endDate)}`);
        } else if (schedule.startDate) {
          parts.push(`until ${formatTimeOnly(schedule.endDate)}`);
        } else {
          parts.push(`Due by ${formatDateShort(schedule.endDate, true)}`);
        }
      }

      if (schedule.conditionalEndNote) {
        parts.push(`or ${schedule.conditionalEndNote}`);
      }
      break;
    }
  }

  if (schedule.latestArrivalTime) {
    parts.push(`Arrive by ${formatTimeOnly(schedule.latestArrivalTime)}`);
  }

  if (schedule.durationMinutes) {
    parts.push(`~${formatDuration(schedule.durationMinutes)}`);
  }

  return parts.join(' · ') || 'No schedule set';
}

/**
 * Converts a `BountyDraft`-level schedule preset key into an ISO start/end pair.
 * Used when the poster selects "Today", "Tomorrow", or "This Week".
 *
 * NOTE: Dates are computed in the device's local timezone (consistent with the
 * poster's intent — "Today" should mean today in their location). The resulting
 * ISO strings are serialized as UTC (via Date#toISOString) and do not include a
 * local timezone offset; downstream consumers should treat them as UTC.
 */
export function schedulePresetToDates(preset: 'today' | 'tomorrow' | 'this_week'): {
  startDate: string;
  endDate: string;
} {
  const now = new Date();

  if (preset === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }

  if (preset === 'tomorrow') {
    const day = new Date(now);
    day.setDate(day.getDate() + 1);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0);
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }

  // this_week: normalize start to 9 AM today for consistency with other presets
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  end.setHours(23, 59, 59, 0);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}
