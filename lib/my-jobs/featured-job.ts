/**
 * Which job My Jobs features, and in what order the rest are listed.
 *
 * The rule (from the design's "Which job is featured"):
 *   1. A problem or a money decision: dispute, cancellation request
 *   2. Someone is waiting on you: work to review, a change requested, you were just chosen
 *   3. New offers on a job you posted
 *   4. New messages
 *   5. Work happening
 *   6. Waiting on the other person
 *   (7. Finished, always last)
 * Ties go to whoever has waited longest. A manual pick is remembered until
 * something ranked higher happens.
 */
import type { MyJob, MyOffer } from './types';

/** A finished job may still be featured ("just finished") for this long. */
export const FINISHED_FEATURE_WINDOW_DAYS = 7;

function time(iso: string | null | undefined, fallback: number): number {
  if (!iso) return fallback;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? fallback : t;
}

/**
 * Priority order. Live jobs: lower rank first, then the one that has waited
 * longest. Finished jobs: most recently finished first, since the oldest
 * finished job is the least interesting one.
 */
export function compareJobs(a: MyJob, b: MyJob): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.finished && b.finished) {
    return time(b.attentionSince, 0) - time(a.attentionSince, 0);
  }
  const diff = time(a.attentionSince, Infinity) - time(b.attentionSince, Infinity);
  if (diff !== 0 && Number.isFinite(diff)) return diff;
  return a.key.localeCompare(b.key);
}

export function sortJobs(jobs: readonly MyJob[]): MyJob[] {
  return [...jobs].sort(compareJobs);
}

/** A finished job only competes for the featured slot while it is recent. */
export function canAutoFeature(job: MyJob, now: Date = new Date()): boolean {
  if (!job.finished) return true;
  const finishedAt = time(job.attentionSince, NaN);
  if (Number.isNaN(finishedAt)) return false;
  return now.getTime() - finishedAt <= FINISHED_FEATURE_WINDOW_DAYS * 86_400_000;
}

/**
 * A job the user chose in the switcher. `outranking` holds the jobs that
 * already outranked it at that moment (as `key:rank`), so only something
 * *new* that ranks higher takes the featured slot back.
 */
export interface ManualPick {
  key: string;
  outranking: string[];
}

function signature(job: MyJob): string {
  return `${job.key}:${job.rank}`;
}

export function createManualPick(jobs: readonly MyJob[], key: string): ManualPick | null {
  const picked = jobs.find((j) => j.key === key);
  if (!picked) return null;
  return {
    key,
    outranking: jobs.filter((j) => j.key !== key && j.rank < picked.rank).map(signature),
  };
}

export interface FeaturedSelection {
  job: MyJob;
  /** `manual` when the user's own pick is showing. */
  reason: 'auto' | 'manual';
}

/**
 * The job to feature. `jobs` must already be sorted with {@link sortJobs}.
 * Returns null when nothing qualifies (no jobs, or only old finished ones).
 */
export function pickFeaturedJob(
  jobs: readonly MyJob[],
  manualPick: ManualPick | null | undefined,
  now: Date = new Date()
): FeaturedSelection | null {
  if (manualPick) {
    const picked = jobs.find((j) => j.key === manualPick.key);
    if (picked) {
      const known = new Set(manualPick.outranking);
      const somethingNewOutranks = jobs.some(
        (j) => j.key !== picked.key && j.rank < picked.rank && !known.has(signature(j))
      );
      if (!somethingNewOutranks) return { job: picked, reason: 'manual' };
    }
  }
  const auto = jobs.find((j) => canAutoFeature(j, now));
  return auto ? { job: auto, reason: 'auto' } : null;
}

/** The best job on one side, for links that ask for a side (e.g. new-offer notifications). */
export function bestJobOnSide(jobs: readonly MyJob[], side: MyJob['side']): MyJob | null {
  return jobs.find((j) => j.side === side) ?? null;
}

/**
 * Side labels ("You posted this" / "You're doing this") appear only when the
 * account has jobs on both sides, so poster-only and hunter-only accounts see
 * an uncluttered card.
 */
export function shouldShowSideLabels(jobs: readonly MyJob[], offers: readonly MyOffer[] = []): boolean {
  const posted = jobs.some((j) => j.side === 'posted');
  const working = jobs.some((j) => j.side === 'doing') || offers.length > 0;
  return posted && working;
}
