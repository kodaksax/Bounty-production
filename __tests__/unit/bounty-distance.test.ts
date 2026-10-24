import {
  bountyDistanceMiles,
  formatBountyWhere,
  formatDistanceMiles,
  haversineMiles,
} from '../../lib/utils/bounty-distance';

const austin = { latitude: 30.2672, longitude: -97.7431 };
const dallas = { latitude: 32.7767, longitude: -96.797 };

describe('haversineMiles', () => {
  it('matches the known Austin to Dallas great-circle distance', () => {
    expect(haversineMiles(austin, dallas)).toBeCloseTo(182, 0);
  });
});

describe('bountyDistanceMiles', () => {
  const bounty = { work_type: 'in_person', approx_latitude: 30.2074, approx_longitude: -97.7982 };

  it("uses the bounty's approximate point", () => {
    expect(bountyDistanceMiles(bounty, austin)).toBeCloseTo(5.5, 0);
  });

  it('prefers the server-computed distance', () => {
    expect(bountyDistanceMiles({ ...bounty, distance_miles: 3.2 }, austin)).toBe(3.2);
  });

  it('is unknown when the viewer has no location', () => {
    expect(bountyDistanceMiles(bounty, null)).toBeNull();
  });

  it('is unknown for online work, even with a server distance', () => {
    expect(bountyDistanceMiles({ work_type: 'online', distance_miles: 1 }, austin)).toBeNull();
  });

  it('is unknown when the bounty has no point and a text address', () => {
    expect(bountyDistanceMiles({ work_type: 'in_person', location: 'Zilker, Austin' }, austin)).toBeNull();
  });

  it('still reads a legacy "lat, lng" location string', () => {
    expect(bountyDistanceMiles({ location: '32.7767, -96.797' }, austin)).toBeCloseTo(182, 0);
  });
});

describe('formatDistanceMiles', () => {
  it.each([
    [0, '< 1 mi'],
    [0.94, '< 1 mi'],
    [1, '1.0 mi'],
    [2.44, '2.4 mi'],
    [9.96, '10.0 mi'],
    [12.5, '13 mi'],
    [1234.4, '1,234 mi'],
  ])('%p -> %p', (miles, label) => {
    expect(formatDistanceMiles(miles)).toBe(label);
  });

  it.each([null, undefined, NaN, -1])('%p -> null', (miles) => {
    expect(formatDistanceMiles(miles as number)).toBeNull();
  });
});

describe('formatBountyWhere', () => {
  it('puts distance before the neighborhood', () => {
    expect(formatBountyWhere(2.44, 'Zilker')).toBe('2.4 mi · Zilker');
  });

  it('shows whichever one is known', () => {
    expect(formatBountyWhere(null, 'Zilker')).toBe('Zilker');
    expect(formatBountyWhere(14, '  ')).toBe('14 mi');
  });

  it('is null when neither is known', () => {
    expect(formatBountyWhere(null, null)).toBeNull();
  });
});
