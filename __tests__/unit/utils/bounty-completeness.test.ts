/**
 * Unit tests for bounty-completeness — the helper that decides whether a
 * listing carries the scope / where / when a hunter needs to say yes, and which
 * the feed + search use to badge and demote the ones that don't.
 *
 * Locks down the finding: cards reaching hunters as "Move a couch — $10 —
 * Location TBD" with no description and no date, which the composer allows
 * because it publishes after only title + amount.
 */

import {
  describeMissingDetails,
  getBountyCompleteness,
  getDraftCompleteness,
  summarizeMissingDetails,
} from '../../../lib/utils/bounty-completeness';

describe('getBountyCompleteness', () => {
  it('is complete when scope, an in-person location, and timing are all present', () => {
    expect(
      getBountyCompleteness({
        description: 'Carry a two-seat couch down two flights of stairs to a van.',
        location: 'Fells Point, Baltimore',
        work_type: 'in_person',
        schedule_type: 'scheduled',
        start_date: '2026-09-10T15:00:00Z',
      })
    ).toEqual({ isComplete: true, missing: [] });
  });

  it('flags a bare listing as missing all three', () => {
    const r = getBountyCompleteness({
      description: '',
      location: '',
      work_type: 'in_person',
    });
    expect(r.isComplete).toBe(false);
    expect(r.missing).toEqual(['scope', 'location', 'timing']);
  });

  it('treats a too-short description as no scope', () => {
    expect(getBountyCompleteness({ description: 'help pls' }).missing).toContain('scope');
  });

  it('does not require a location for remote work', () => {
    const r = getBountyCompleteness({
      description: 'Design a one-page logo in vector format, source file delivered.',
      work_type: 'online',
      is_time_sensitive: true,
    });
    expect(r.missing).not.toContain('location');
    expect(r.isComplete).toBe(true);
  });

  it('accepts a neighborhood in place of a full location', () => {
    expect(
      getBountyCompleteness({
        description: 'Walk a golden retriever for 45 minutes around the park.',
        neighborhood: 'Canton',
        work_type: 'in_person',
        deadline: '2026-09-09T12:00:00Z',
      }).missing
    ).not.toContain('location');
  });

  it('accepts any one timing signal', () => {
    for (const timing of [
      { schedule_type: 'asap' },
      { start_date: '2026-09-10T00:00:00Z' },
      { deadline: '2026-09-10T00:00:00Z' },
      { duration_minutes: 30 },
      { is_time_sensitive: true },
    ]) {
      expect(
        getBountyCompleteness({
          description: 'A genuinely descriptive sentence about the task at hand.',
          work_type: 'online',
          ...timing,
        }).missing
      ).not.toContain('timing');
    }
  });
});

describe('getDraftCompleteness', () => {
  it('reads the camelCase composer draft shape', () => {
    const r = getDraftCompleteness({
      description: '',
      workType: 'in_person',
      location: '',
    });
    expect(r.missing).toEqual(['scope', 'location', 'timing']);
  });

  it('clears timing from a draft scheduleType', () => {
    expect(
      getDraftCompleteness({
        description: 'Assemble a flat-pack wardrobe, tools provided on site.',
        location: 'Mount Vernon',
        workType: 'in_person',
        scheduleType: 'flexible',
      })
    ).toEqual({ isComplete: true, missing: [] });
  });
});

describe('phrasing helpers', () => {
  it('describeMissingDetails joins with commas and a trailing "and"', () => {
    expect(describeMissingDetails(['scope', 'location', 'timing'])).toBe(
      'what the job involves, where it is, and when it needs doing'
    );
    expect(describeMissingDetails(['location'])).toBe('where it is');
    expect(describeMissingDetails([])).toBe('');
  });

  it('summarizeMissingDetails is the compact badge form', () => {
    expect(summarizeMissingDetails(['location', 'timing'])).toBe('No location or timing');
    expect(summarizeMissingDetails(['scope'])).toBe('No scope');
    expect(summarizeMissingDetails([])).toBe('');
  });
});
