import {
  getPitchPrompt,
  getPitchRequirement,
  PITCH_ENCOURAGED_MIN_AMOUNT,
  PITCH_REQUIRED_MIN_AMOUNT,
} from '../../../lib/utils/pitch-requirement';

describe('getPitchRequirement', () => {
  test('low-amount bounty is optional', () => {
    expect(getPitchRequirement({ amount: 10 })).toBe('optional');
    expect(getPitchRequirement({ amount: PITCH_ENCOURAGED_MIN_AMOUNT - 1 })).toBe('optional');
  });

  test('mid-amount bounty is encouraged, not blocking', () => {
    expect(getPitchRequirement({ amount: PITCH_ENCOURAGED_MIN_AMOUNT })).toBe('encouraged');
    expect(getPitchRequirement({ amount: PITCH_REQUIRED_MIN_AMOUNT - 1 })).toBe('encouraged');
  });

  test('high-amount bounty requires a pitch', () => {
    expect(getPitchRequirement({ amount: PITCH_REQUIRED_MIN_AMOUNT })).toBe('required');
    expect(getPitchRequirement({ amount: 500 })).toBe('required');
  });

  test('honor bounties are always optional regardless of amount', () => {
    expect(getPitchRequirement({ amount: 500, is_for_honor: true })).toBe('optional');
  });

  test('missing/invalid amount defaults to optional rather than throwing', () => {
    expect(getPitchRequirement({})).toBe('optional');
    expect(getPitchRequirement({ amount: null })).toBe('optional');
    expect(getPitchRequirement({ amount: NaN })).toBe('optional');
  });
});

describe('getPitchPrompt', () => {
  test('returns category-specific copy for known categories', () => {
    expect(getPitchPrompt('labor')).toMatch(/similar work/i);
    expect(getPitchPrompt('delivery')).toMatch(/moving|heavy lifting/i);
    expect(getPitchPrompt('tech')).toMatch(/relevant experience/i);
  });

  test('is case-insensitive', () => {
    expect(getPitchPrompt('LABOR')).toBe(getPitchPrompt('labor'));
  });

  test('falls back to the generic prompt for unknown/missing categories', () => {
    const fallback = getPitchPrompt('other');
    expect(getPitchPrompt(undefined)).toBe(fallback);
    expect(getPitchPrompt(null)).toBe(fallback);
    expect(getPitchPrompt('not-a-real-category')).toBe(fallback);
  });
});
