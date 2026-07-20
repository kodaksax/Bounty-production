/**
 * Moments Queue — enqueue resolution for post_first_bounty / accept_first_bounty.
 *
 * This is the sole place either moment gets enqueued — deliberately not
 * app/onboarding/done.tsx, since enqueuing there (status: 'pending' the
 * instant onboarding finishes) is exactly what used to make the "post a
 * bounty" / "hunt a bounty" prompts appear the moment a user landed in the
 * app. Enqueuing here instead just creates the row; registry.ts's
 * isEligible for both moments additionally requires a later session and a
 * relevant screen before either is actually shown (see its comments).
 *
 * This does one lightweight count query per moment to resolve enqueue vs.
 * complete: if the user already has a bounty/accepted request, the moment
 * is marked completed (it doesn't apply); otherwise it's enqueued. Either
 * outcome creates a state row, so the `!states.has(...)` guard means this
 * query runs at most once per user, ever — MomentsProvider additionally
 * gates this to once per app session via a ref so it never repeats within a
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
