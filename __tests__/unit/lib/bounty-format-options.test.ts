/**
 * Regression coverage for the onboarding-style / Settings "Bounty Display"
 * index<->format mapping. Written after a reported bug where selecting
 * "Compact" (the middle option) in onboarding was applied as "Grid"
 * instead — see app/onboarding/style.tsx for the fix (a race between the
 * chip-tap handler and the swipeable pager's onMomentumScrollEnd handler,
 * both of which independently wrote to the same selection state).
 */
import {
  BOUNTY_FORMAT_OPTIONS,
  formatForIndex,
  formatForScrollOffset,
  indexForFormat,
} from '../../../lib/bounty-format-options';
import type { BountyFormat } from '../../../lib/bounty-format-context';

describe('BOUNTY_FORMAT_OPTIONS', () => {
  it('declares exactly card, compact, grid in that order', () => {
    expect(BOUNTY_FORMAT_OPTIONS.map((o) => o.value)).toEqual(['card', 'compact', 'grid']);
  });

  it('every option has a non-empty label, icon, and description', () => {
    for (const option of BOUNTY_FORMAT_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.icon.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });
});

describe('formatForIndex', () => {
  it('maps index 0 to card', () => {
    expect(formatForIndex(0)).toBe('card');
  });

  it('maps index 1 to compact (the option previously skipped)', () => {
    expect(formatForIndex(1)).toBe('compact');
  });

  it('maps index 2 to grid', () => {
    expect(formatForIndex(2)).toBe('grid');
  });

  it('returns undefined for an out-of-range index', () => {
    expect(formatForIndex(3)).toBeUndefined();
    expect(formatForIndex(-1)).toBeUndefined();
  });
});

describe('indexForFormat', () => {
  it.each<[BountyFormat, number]>([
    ['card', 0],
    ['compact', 1],
    ['grid', 2],
  ])('maps %s back to index %i (round-trips with formatForIndex)', (format, expectedIndex) => {
    const index = indexForFormat(format);
    expect(index).toBe(expectedIndex);
    expect(formatForIndex(index)).toBe(format);
  });
});

describe('formatForScrollOffset', () => {
  const pageWidth = 342; // representative measured page width (non-round number in practice)

  it('resolves the exact-multiple offsets for each page, including compact', () => {
    expect(formatForScrollOffset(0, pageWidth)).toBe('card');
    expect(formatForScrollOffset(pageWidth, pageWidth)).toBe('compact');
    expect(formatForScrollOffset(pageWidth * 2, pageWidth)).toBe('grid');
  });

  it('rounds sub-pixel settle positions to the nearest page rather than off by one', () => {
    // Settled a fraction short of / past the exact compact boundary — both
    // should still resolve to 'compact', not overshoot to 'grid' or
    // undershoot back to 'card'.
    expect(formatForScrollOffset(pageWidth - 2, pageWidth)).toBe('compact');
    expect(formatForScrollOffset(pageWidth + 2, pageWidth)).toBe('compact');
  });

  it('does not resolve to grid for any offset nearer to the compact page', () => {
    // Regression check for the reported bug: nothing short of ~1.5 page
    // widths should ever resolve to 'grid'.
    const justBelowGridBoundary = pageWidth * 1.49;
    expect(formatForScrollOffset(justBelowGridBoundary, pageWidth)).toBe('compact');
  });

  it('returns undefined when pageWidth is not yet known (0 or negative)', () => {
    expect(formatForScrollOffset(100, 0)).toBeUndefined();
    expect(formatForScrollOffset(100, -10)).toBeUndefined();
  });
});
