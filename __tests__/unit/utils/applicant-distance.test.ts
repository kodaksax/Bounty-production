import {
  buildApplicantListRows,
  countNearbyApplicants,
  formatApplicantDistance,
  partitionApplicantsByDistance,
  sortApplicantsLocalFirst,
} from '../../../lib/utils/applicant-distance';

// SBA-02: distance_mi / is_far are stamped by the server (20261019200000).
type App = { id: string; distance_mi?: number | null; is_far?: boolean; created_at: string };
const app = (id: string, distance_mi: number | null | undefined, created_at: string, is_far = false): App => ({
  id,
  distance_mi,
  is_far,
  created_at,
});
const ids = (list: { id: string }[]) => list.map(a => a.id);

describe('formatApplicantDistance', () => {
  it('says "Under 1 mi away" for 0', () => {
    expect(formatApplicantDistance(0)).toBe('Under 1 mi away');
  });

  it('says "About N mi away" for whole miles', () => {
    expect(formatApplicantDistance(1)).toBe('About 1 mi away');
    expect(formatApplicantDistance(12)).toBe('About 12 mi away');
    expect(formatApplicantDistance(1504)).toBe('About 1504 mi away');
  });

  it('shows nothing when the distance is unknown', () => {
    expect(formatApplicantDistance(null)).toBeNull();
    expect(formatApplicantDistance(undefined)).toBeNull();
    expect(formatApplicantDistance(NaN)).toBeNull();
    expect(formatApplicantDistance(-1)).toBeNull();
  });
});

describe('sortApplicantsLocalFirst', () => {
  it('puts the nearest known applicants first, then the rest newest first', () => {
    const sorted = sortApplicantsLocalFirst([
      app('unknown-old', null, '2026-10-10T00:00:00Z'),
      app('far-12', 12, '2026-10-12T00:00:00Z'),
      app('unknown-new', undefined, '2026-10-15T00:00:00Z'),
      app('near-0', 0, '2026-10-01T00:00:00Z'),
      app('mid-4', 4, '2026-10-14T00:00:00Z'),
    ]);
    expect(ids(sorted)).toEqual(['near-0', 'mid-4', 'far-12', 'unknown-new', 'unknown-old']);
  });

  it('breaks distance ties by recency', () => {
    const sorted = sortApplicantsLocalFirst([
      app('older', 3, '2026-10-01T00:00:00Z'),
      app('newer', 3, '2026-10-05T00:00:00Z'),
    ]);
    expect(ids(sorted)).toEqual(['newer', 'older']);
  });

  it('keeps newest-first order when no distance is known (online jobs)', () => {
    const input = [
      app('c', null, '2026-10-03T00:00:00Z'),
      app('a', null, '2026-10-01T00:00:00Z'),
      app('b', null, '2026-10-02T00:00:00Z'),
    ];
    expect(ids(sortApplicantsLocalFirst(input))).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate its input', () => {
    const input = [app('b', 9, '2026-10-01T00:00:00Z'), app('a', 1, '2026-10-01T00:00:00Z')];
    sortApplicantsLocalFirst(input);
    expect(ids(input)).toEqual(['b', 'a']);
  });
});

describe('partitionApplicantsByDistance / buildApplicantListRows (Not nearby collapse)', () => {
  const list = [
    app('far-90', 90, '2026-10-15T00:00:00Z', true),
    app('near-3', 3, '2026-10-01T00:00:00Z'),
    app('unknown', null, '2026-10-14T00:00:00Z'),
    app('far-1500', 1500, '2026-10-16T00:00:00Z', true),
    app('near-0', 0, '2026-10-02T00:00:00Z'),
  ];

  it('moves is_far applications out of the main list, each part local first', () => {
    const { nearby, notNearby } = partitionApplicantsByDistance(list);
    expect(ids(nearby)).toEqual(['near-0', 'near-3', 'unknown']);
    expect(ids(notNearby)).toEqual(['far-90', 'far-1500']);
  });

  it('is closed by default: a "Not nearby (N)" row and no far applicants', () => {
    const rows = buildApplicantListRows(list, false);
    expect(rows.map(r => (r.kind === 'applicant' ? r.item.id : `toggle:${r.count}:${r.expanded}`))).toEqual([
      'near-0',
      'near-3',
      'unknown',
      'toggle:2:false',
    ]);
  });

  it('lists the far applicants under the toggle when expanded', () => {
    const rows = buildApplicantListRows(list, true);
    expect(rows.map(r => (r.kind === 'applicant' ? r.item.id : `toggle:${r.count}:${r.expanded}`))).toEqual([
      'near-0',
      'near-3',
      'unknown',
      'toggle:2:true',
      'far-90',
      'far-1500',
    ]);
  });

  it('adds no toggle when nobody is far', () => {
    const rows = buildApplicantListRows([app('a', 2, '2026-10-01T00:00:00Z')], false);
    expect(rows).toEqual([{ kind: 'applicant', item: expect.objectContaining({ id: 'a' }) }]);
  });

  it('shows only the toggle when every applicant is far', () => {
    const rows = buildApplicantListRows([app('x', 200, '2026-10-01T00:00:00Z', true)], false);
    expect(rows).toEqual([{ kind: 'notNearby', count: 1, expanded: false }]);
  });
});

describe('countNearbyApplicants', () => {
  it('counts known, not-far distances only', () => {
    expect(
      countNearbyApplicants([
        app('a', 0, '2026-10-01T00:00:00Z'),
        app('b', 50, '2026-10-01T00:00:00Z'),
        app('c', 51, '2026-10-01T00:00:00Z', true),
        app('d', null, '2026-10-01T00:00:00Z'),
      ])
    ).toBe(2);
  });
});
