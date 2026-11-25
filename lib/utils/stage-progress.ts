/**
 * Which way a job moved between two reads of it, and whether the screen may
 * follow (E2E-01, Whole-Job Test 2026-11-24).
 *
 * A job page refetches all the time: on focus, after an action, on a live
 * update. Each refetch is read in full before it is shown (useBountyLifecycle),
 * but a read can still be older than the one already on screen (a replica that
 * hasn't caught up, a slower request finishing last). So a refetch may move the
 * stage FORWARD freely, and BACKWARD only for one of the real server changes
 * named in BACKWARD_MOVES. Anything else is refused: the last good stage stays
 * on screen, and in development the refusal is logged.
 *
 * Pure, so every allowed and refused move is unit-tested without React
 * (__tests__/unit/utils/stage-progress.test.ts).
 */
import { isPayingState } from './bounty-lifecycle';

/** The paying stage says "We're confirming the payment" after this long. */
export const PAYING_SLOW_AFTER_MS = 10_000;
/** While paying, re-read the job this often... */
export const PAYING_POLL_MS = 3_000;
/** ...and stop polling after this long (the confirming message stays). */
export const PAYING_POLL_STOP_MS = 60_000;

/** The parts of one full read of a job that decide its stage. */
export interface StageFacts {
  bountyStatus: string | null | undefined;
  acceptedBy?: string | null;
  /** Pending offers (poster side; 0 for anyone else). */
  applicationCount: number;
  submissionStatus: string | null | undefined;
  hasDispute: boolean;
  hasCancellationRequest: boolean;
}

/** Statuses a job does not come back from. */
const ENDED = new Set(['cancelled', 'archived', 'deleted', 'removed']);

/**
 * How far along the job is, by the server's own data. Higher is later.
 * `ended` is reached from anywhere; null means "not on the line" (a status this
 * guard doesn't know), which is never refused.
 */
export function stageRank(f: StageFacts): number | 'ended' | null {
  const status = String(f.bountyStatus ?? '');
  if (ENDED.has(status)) return 'ended';
  if (status === 'completed') return 50;
  if (isPayingState({ status }, f.submissionStatus)) return 45;
  if (status === 'in_progress' || status === 'cancellation_requested') {
    return f.submissionStatus === 'pending' ? 40 : 30;
  }
  if (status === 'open') {
    if (f.acceptedBy) return 30;
    return f.applicationCount > 0 ? 20 : 10;
  }
  return null;
}

export type BackwardMove =
  | 'ended'
  | 'work_sent_back'
  | 'report_opened'
  | 'offers_gone'
  | 'cancellation_requested'
  | 'report_or_request_closed';

/**
 * The backward moves a screen may follow, each a real server change:
 *   ended                    cancelled, taken down or removed
 *   work_sent_back           the poster asked for a change (review → working)
 *   report_opened            a problem was reported (the job pauses)
 *   offers_gone              every offer was withdrawn or expired (choosing → posted)
 *   cancellation_requested   the helper asked to stop, even during review; the
 *                            screen lands on the cancellation-request stage
 *   report_or_request_closed an open report or cancellation request closed,
 *                            so the job's own stage shows again
 */
export function backwardMoveReason(prev: StageFacts, next: StageFacts): BackwardMove | null {
  if (stageRank(next) === 'ended') return 'ended';
  if (prev.submissionStatus === 'pending' && next.submissionStatus === 'revision_requested') {
    return 'work_sent_back';
  }
  if (next.hasDispute && !prev.hasDispute) return 'report_opened';
  if (next.hasCancellationRequest && !prev.hasCancellationRequest) return 'cancellation_requested';
  if ((prev.hasDispute && !next.hasDispute) || (prev.hasCancellationRequest && !next.hasCancellationRequest)) {
    return 'report_or_request_closed';
  }
  if (
    prev.bountyStatus === 'open' &&
    next.bountyStatus === 'open' &&
    prev.applicationCount > 0 &&
    next.applicationCount === 0 &&
    !next.acceptedBy
  ) {
    return 'offers_gone';
  }
  return null;
}

export type StageMoveVerdict =
  | { allowed: true; direction: 'forward' | 'same' | 'unranked' }
  | { allowed: true; direction: 'backward'; reason: BackwardMove }
  | { allowed: false; direction: 'backward'; from: number | 'ended'; to: number | 'ended' };

/** May the screen move from what it shows (`prev`) to a newer read (`next`)? */
export function checkStageMove(prev: StageFacts, next: StageFacts): StageMoveVerdict {
  const from = stageRank(prev);
  const to = stageRank(next);
  if (from === null || to === null) return { allowed: true, direction: 'unranked' };
  if (to === 'ended') return from === 'ended' ? { allowed: true, direction: 'same' } : { allowed: true, direction: 'backward', reason: 'ended' };
  if (from === 'ended') return { allowed: false, direction: 'backward', from, to };
  const reason = backwardMoveReason(prev, next);
  // Dropping in rank is backward.
  const backward = to < from;
  if (!backward) {
    return { allowed: true, direction: to === from ? 'same' : 'forward' };
  }
  if (reason && reason !== 'ended') return { allowed: true, direction: 'backward', reason };
  return { allowed: false, direction: 'backward', from, to };
}
