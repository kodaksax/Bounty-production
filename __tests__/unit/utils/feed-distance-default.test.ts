import {
  applyDistancePick,
  DISTANCE_OFF,
  includeOnlineFor,
  LOCAL_DEFAULT_RADIUS_MILES,
  parseDistancePreference,
  resolveDefaultDistance,
} from '../../../lib/utils/feed-distance-default';

// SBA-02: the hunter feed's default distance.
describe('resolveDefaultDistance', () => {
  it('is 25 mi for a hunter with a location', () => {
    expect(LOCAL_DEFAULT_RADIUS_MILES).toBe(25);
    expect(resolveDefaultDistance({ hasLocation: true, preference: 'local' })).toBe(25);
  });

  it('is "Any distance" for a hunter with no location', () => {
    expect(resolveDefaultDistance({ hasLocation: false, preference: 'local' })).toBe(DISTANCE_OFF);
  });

  it('is "Any distance" once the hunter chose it', () => {
    expect(resolveDefaultDistance({ hasLocation: true, preference: 'any' })).toBe(DISTANCE_OFF);
  });
});

describe('parseDistancePreference', () => {
  it('only an explicit "any" turns the local default off', () => {
    expect(parseDistancePreference('any')).toBe('any');
    expect(parseDistancePreference('local')).toBe('local');
    expect(parseDistancePreference(null)).toBe('local');
    expect(parseDistancePreference('garbage')).toBe('local');
  });
});

describe('applyDistancePick', () => {
  it('"Any distance" is remembered and becomes the default (no override)', () => {
    expect(applyDistancePick({ value: DISTANCE_OFF, hasLocation: true })).toEqual({
      preference: 'any',
      defaultDistance: DISTANCE_OFF,
      override: undefined,
    });
  });

  it('picking 25 mi is the default again (no override)', () => {
    expect(applyDistancePick({ value: 25, hasLocation: true })).toEqual({
      preference: 'local',
      defaultDistance: 25,
      override: undefined,
    });
  });

  it('another radius is an override on top of the local default', () => {
    expect(applyDistancePick({ value: 5, hasLocation: true })).toEqual({
      preference: 'local',
      defaultDistance: 25,
      override: 5,
    });
    expect(applyDistancePick({ value: null, hasLocation: true }).override).toBeNull();
  });

  it('without a location, any radius is an override on "Any distance"', () => {
    expect(applyDistancePick({ value: 10, hasLocation: false })).toEqual({
      preference: 'local',
      defaultDistance: DISTANCE_OFF,
      override: 10,
    });
  });
});

describe('includeOnlineFor', () => {
  it('keeps online jobs in every radius search', () => {
    expect(includeOnlineFor(25)).toBe(true);
    expect(includeOnlineFor(1)).toBe(true);
    expect(includeOnlineFor(null)).toBe(true);
    expect(includeOnlineFor(DISTANCE_OFF)).toBe(false);
  });
});
