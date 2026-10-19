/**
 * How a poster sees applicant distance (SBA-02, docs/audits/shoal-behavioral-audit.md).
 *
 * The server stamps bounty_requests.distance_mi / is_far at application time
 * (20261019200000): whole miles from the hunter's ~1 km grid cell to the job's
 * approximate point, 0 = under a mile, null = online job or a side had no
 * location; is_far = over 50 miles. These helpers only read those values.
 */

export interface ApplicantDistanceFields {
  distance_mi?: number | null;
  is_far?: boolean | null;
  created_at?: string | null;
}

/** "Under 1 mi away" / "About N mi away", or null when the distance isn't known. */
export function formatApplicantDistance(distanceMi: number | null | undefined): string | null {
  if (typeof distanceMi !== 'number' || !Number.isFinite(distanceMi) || distanceMi < 0) return null;
  const miles = Math.round(distanceMi);
  if (miles < 1) return 'Under 1 mi away';
  return `About ${miles} mi away`;
}

function knownDistance(r: ApplicantDistanceFields): number | null {
  return typeof r.distance_mi === 'number' && Number.isFinite(r.distance_mi) ? r.distance_mi : null;
}

function createdAtMs(r: ApplicantDistanceFields): number {
  const t = r.created_at ? Date.parse(r.created_at) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Nearest known applicants first (ties: newest first), then those with no
 * known distance, newest first. Stable for equal keys; never mutates input.
 */
export function sortApplicantsLocalFirst<T extends ApplicantDistanceFields>(requests: readonly T[]): T[] {
  return requests
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const da = knownDistance(a.r);
      const db = knownDistance(b.r);
      if (da != null && db != null && da !== db) return da - db;
      if (da != null && db == null) return -1;
      if (da == null && db != null) return 1;
      const byRecency = createdAtMs(b.r) - createdAtMs(a.r);
      return byRecency !== 0 ? byRecency : a.i - b.i;
    })
    .map(x => x.r);
}

/**
 * Splits applicants into those shown normally and those collapsed under
 * "Not nearby (N)" (is_far), each in local-first order.
 */
export function partitionApplicantsByDistance<T extends ApplicantDistanceFields>(
  requests: readonly T[]
): { nearby: T[]; notNearby: T[] } {
  const sorted = sortApplicantsLocalFirst(requests);
  return {
    nearby: sorted.filter(r => r.is_far !== true),
    notNearby: sorted.filter(r => r.is_far === true),
  };
}

/** Applicants with a known distance that isn't flagged far. */
export function countNearbyApplicants(requests: readonly ApplicantDistanceFields[]): number {
  return requests.filter(r => knownDistance(r) != null && r.is_far !== true).length;
}

export const NOT_NEARBY_LABEL = 'Not nearby';

/** A row in an applicant list: an applicant, or the "Not nearby (N)" toggle. */
export type ApplicantListRow<T> =
  | { kind: 'applicant'; item: T }
  | { kind: 'notNearby'; count: number; expanded: boolean };

/**
 * Nearby applicants (local first), then — only if any are far — one
 * "Not nearby (N)" toggle row, followed by the far applicants when expanded.
 */
export function buildApplicantListRows<T extends ApplicantDistanceFields>(
  requests: readonly T[],
  notNearbyExpanded: boolean
): ApplicantListRow<T>[] {
  const { nearby, notNearby } = partitionApplicantsByDistance(requests);
  const rows: ApplicantListRow<T>[] = nearby.map(item => ({ kind: 'applicant' as const, item }));
  if (notNearby.length > 0) {
    rows.push({ kind: 'notNearby', count: notNearby.length, expanded: notNearbyExpanded });
    if (notNearbyExpanded) rows.push(...notNearby.map(item => ({ kind: 'applicant' as const, item })));
  }
  return rows;
}
