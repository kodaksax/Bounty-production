/**
 * Bounty ranking v2 — weighted feed formula for the `bounty-ranking-v2`
 * PostHog experiment (flag `bounty-ranking-v2`, experiment id 463516).
 *
 * Pure, framework-agnostic TypeScript (no RN/node/Deno-only APIs) so this one
 * file can be imported both by the Jest suite and, unmodified via a relative
 * path, by the `bounty-ranking` Supabase Edge Function — the only place this
 * runs. It must never be imported into client bundles: the whole point of the
 * experiment is that ranking is decided server-side, and a client that had
 * this module (plus a way to see other users' candidate pools) could infer or
 * recompute rankings client-side.
 *
 * Control-arm behavior is intentionally untouched by this module — the
 * existing client-side sort in components/bounty-feed.tsx keeps running
 * exactly as before for `control`. Everything here only ever executes for the
 * `test` arm.
 */

export const RANK_WEIGHTS = {
  pay: 0.4,
  freshness: 0.35,
  paidBoost: 0.15,
  category: 0.1,
} as const;

/** Linear freshness decay window, in days. */
export const FRESHNESS_WINDOW_DAYS = 14;

/** A bounty older than this with zero applications drops into the dormant section. */
export const STALE_CAP_DAYS = 30;

/** Below this candidate-pool size, skip scoring entirely (see RANK_EDGE_CASES). */
export const MIN_POOL_SIZE_FOR_SCORING = 5;

const SECONDS_PER_DAY = 86400;

/** Observed conversion-rate lookup. Update as more data accumulates. */
export const CATEGORY_SCORES: Record<string, number> = {
  labor: 1.0,
  other: 0.96,
  writing: 0.6,
  tech: 0.4,
  design: 0.48,
  delivery: 0.6,
};

export const DEFAULT_CATEGORY_SCORE = 0.5;

/** Neutral freshness used when `seconds_since_posted` is unknown. */
export const NEUTRAL_FRESHNESS_SCORE = 0.5;

export interface RankableBounty {
  id: string;
  amount: number | null | undefined;
  is_for_honor: boolean | null | undefined;
  /** Seconds between now and creation, as measured by the caller (the edge
   * function computes this from its own clock against `created_at`, never
   * trusting a client-supplied value). `null`/`undefined` means unknown. */
  seconds_since_posted: number | null | undefined;
  category: string | null | undefined;
}

export interface RankedBounty {
  id: string;
  /** Pre-jitter score — this is what's reported on `bounty_viewed` for
   * debugging/analysis, since jitter is per-viewer noise, not signal. */
  rank_score: number;
  /** Post-jitter score. Sort key only; not exposed to analytics. */
  final_score: number;
}

export function payScore(amount: number | null | undefined, maxAmountInPool: number): number {
  const a = isHonorAmount(amount) ? 0 : Math.max(0, amount ?? 0);
  if (!(maxAmountInPool > 0)) return 0;
  return Math.log(a + 1) / Math.log(maxAmountInPool + 1);
}

function isHonorAmount(amount: number | null | undefined): boolean {
  return amount == null || amount <= 0;
}

export function freshnessScore(secondsSincePosted: number | null | undefined): number {
  if (secondsSincePosted == null || Number.isNaN(secondsSincePosted)) return NEUTRAL_FRESHNESS_SCORE;
  const daysOld = Math.max(0, secondsSincePosted) / SECONDS_PER_DAY;
  return Math.max(0.0, 1.0 - daysOld / FRESHNESS_WINDOW_DAYS);
}

export function paidBoost(isForHonor: boolean | null | undefined): number {
  return isForHonor ? 0.0 : 1.0;
}

export function categoryScore(category: string | null | undefined): number {
  if (!category) return DEFAULT_CATEGORY_SCORE;
  return CATEGORY_SCORES[category.toLowerCase()] ?? DEFAULT_CATEGORY_SCORE;
}

export function computeRankScore(bounty: RankableBounty, maxAmountInPool: number): number {
  return (
    payScore(bounty.amount, maxAmountInPool) * RANK_WEIGHTS.pay +
    freshnessScore(bounty.seconds_since_posted) * RANK_WEIGHTS.freshness +
    paidBoost(bounty.is_for_honor) * RANK_WEIGHTS.paidBoost +
    categoryScore(bounty.category) * RANK_WEIGHTS.category
  );
}

/**
 * Deterministic FNV-1a 32-bit hash, normalized to [0, 1). Used instead of
 * Math.random() so the same (seed, bountyId) pair always produces the same
 * jitter — the whole point of seeding is a stable order across scrolls/
 * refreshes within a day.
 */
export function seededRandom(seed: string, bountyId: string): number {
  const input = `${seed}:${bountyId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 forces the (possibly negative) int32 into an unsigned 32-bit range.
  return (hash >>> 0) / 0x100000000;
}

/** `seed` for a given viewer/day — stable across scrolls, changes daily. */
export function jitterSeed(userId: string, dateString: string): string {
  return `${userId}:${dateString}`;
}

export function jitterFor(seed: string, bountyId: string): number {
  return 0.85 + seededRandom(seed, bountyId) * 0.3;
}

/** UTC calendar-day string (YYYY-MM-DD) — deliberately UTC so the arm a user
 * sees doesn't depend on the server's local timezone. */
export function utcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function rankPool(
  bounties: RankableBounty[],
  opts: { userId: string; dateString: string }
): RankedBounty[] {
  const maxAmountInPool = bounties.reduce((max, b) => {
    const a = isHonorAmount(b.amount) ? 0 : (b.amount ?? 0);
    return a > max ? a : max;
  }, 0);
  const seed = jitterSeed(opts.userId, opts.dateString);
  return bounties
    .map(b => {
      const rank_score = computeRankScore(b, maxAmountInPool);
      const final_score = rank_score * jitterFor(seed, b.id);
      return { id: b.id, rank_score, final_score };
    })
    .sort((a, b) => b.final_score - a.final_score);
}

function sortByRecencyDesc(bounties: RankableBounty[]): RankedBounty[] {
  return [...bounties]
    .sort((a, b) => (a.seconds_since_posted ?? Infinity) - (b.seconds_since_posted ?? Infinity))
    .map(b => ({ id: b.id, rank_score: 0, final_score: 0 }));
}

export interface RankedSections {
  main: RankedBounty[];
  dormant: RankedBounty[];
  honor: RankedBounty[];
}

export interface PoolBounty extends RankableBounty {
  /** Number of applications received so far — drives the stale-cap rule. */
  application_count: number | null | undefined;
}

/**
 * Splits + scores a hard-rule-filtered candidate pool (own-bounty and
 * already-applied exclusions must already have been applied by the caller —
 * this function only implements the stale-cap / honor-section split and the
 * scoring formula, per docs "Hard rules" #3-#4 and the edge-case table.
 */
export function rankAndSectionPool(
  pool: PoolBounty[],
  opts: { userId: string; dateString: string }
): RankedSections {
  if (pool.length < MIN_POOL_SIZE_FOR_SCORING) {
    return { main: sortByRecencyDesc(pool), dormant: [], honor: [] };
  }

  const isStale = (b: PoolBounty) =>
    (b.seconds_since_posted ?? 0) > STALE_CAP_DAYS * SECONDS_PER_DAY &&
    (b.application_count ?? 0) === 0;

  const dormantPool = pool.filter(isStale);
  const activePool = pool.filter(b => !isStale(b));

  const allHonor = activePool.length > 0 && activePool.every(b => Boolean(b.is_for_honor));
  const honorPool = allHonor ? [] : activePool.filter(b => Boolean(b.is_for_honor));
  const mainPool = allHonor ? activePool : activePool.filter(b => !b.is_for_honor);

  return {
    main: rankPool(mainPool, opts),
    dormant: rankPool(dormantPool, opts),
    honor: rankPool(honorPool, opts),
  };
}
