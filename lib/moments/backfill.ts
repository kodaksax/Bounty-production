/**
 * Moments Queue — one-time backfill for event-triggered moments.
 *
 * New users get `post_first_bounty` / `accept_first_bounty` enqueued
 * directly in app/onboarding/done.tsx when their role becomes known. Users
 * who completed onboarding before that wiring existed (or before
 * `primary_role` existed at all) have no user_activation_moments row for
 * either moment, so the engine would never surface — or ever retire — them.
 *
 * This does one lightweight count query per moment to resolve that: if the
 * user already has a bounty/accepted request, the moment is marked
 * completed (it doesn't apply); otherwise it's enqueued. Either outcome
 * creates a state row, so the `!states.has(...)` guard means this query
 * runs at most once per user, ever — MomentsProvider additionally gates
 * this to once per app session via a ref so it never repeats within a
 * single run even before that row exists.
 */
import { supabase } from '../supabase';
import { momentsService } from './momentsService';
import type { MomentState, MomentType } from './types';

async function backfillPostFirstBounty(userId: string): Promise<void> {
  const { count } = await supabase
    .from('bounties')
    .select('id', { count: 'exact', head: true })
    .eq('poster_id', userId);
  if (count && count > 0) {
    await momentsService.markCompleted(userId, 'post_first_bounty');
  } else {
    await momentsService.enqueue(userId, 'post_first_bounty', {});
  }
}

async function backfillAcceptFirstBounty(userId: string): Promise<void> {
  const { count } = await supabase
    .from('bounty_requests')
    .select('id', { count: 'exact', head: true })
    .eq('hunter_id', userId)
    .eq('status', 'accepted');
  if (count && count > 0) {
    await momentsService.markCompleted(userId, 'accept_first_bounty');
  } else {
    await momentsService.enqueue(userId, 'accept_first_bounty', {});
  }
}

export async function backfillEventMoments(
  userId: string,
  primaryRole: 'poster' | 'hunter' | 'both' | null | undefined,
  states: Map<MomentType, MomentState>
): Promise<void> {
  const checks: Promise<void>[] = [];

  if (!states.has('post_first_bounty') && (primaryRole === 'poster' || primaryRole === 'both')) {
    checks.push(backfillPostFirstBounty(userId));
  }

  if (!states.has('accept_first_bounty') && (primaryRole === 'hunter' || primaryRole === 'both')) {
    checks.push(backfillAcceptFirstBounty(userId));
  }

  if (checks.length > 0) {
    await Promise.all(checks);
  }
}
