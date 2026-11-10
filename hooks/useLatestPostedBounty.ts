import { useCallback, useEffect, useRef, useState } from 'react';
import { API_TIMEOUTS } from '../lib/config/network';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/utils/error-logger';
import { withTimeout } from '../lib/utils/withTimeout';

export type LatestPostedBounty = { id: string; title: string };

export type LatestPostedBountyState =
  | { status: 'loading' }
  | { status: 'loaded'; bounty: LatestPostedBounty | null }
  // The lookup failed before anything was ever loaded for this user.
  | { status: 'error' };

/**
 * The viewer's most recent bounty, or null when they have never posted.
 *
 * One row, two answers: whether the viewer has posted at all (the home post
 * card's audience) and which bounty "Post again" should start from. Admin-
 * removed bounties (status 'deleted') don't count for either. Throws on
 * failure so the caller can keep what it last knew.
 */
export async function fetchLatestPostedBounty(userId: string): Promise<LatestPostedBounty | null> {
  const { data, error } = await supabase
    .from('bounties')
    .select('id, title')
    .eq('poster_id', userId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = (data as { id: string | number; title?: string | null }[] | null)?.[0];
  if (!row) return null;
  return { id: String(row.id), title: (row.title ?? '').trim() };
}

/**
 * Loads fetchLatestPostedBounty for `userId`. A failed reload keeps the last
 * loaded value, so a flaky network never makes the card flicker away.
 */
export function useLatestPostedBounty(userId: string | null | undefined): {
  state: LatestPostedBountyState;
  reload: () => Promise<void>;
} {
  const [state, setState] = useState<LatestPostedBountyState>({ status: 'loading' });
  // Only the newest request may write, so a slow answer for a previous user
  // (or an older reload) can't overwrite a newer one.
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    if (!userId) {
      setState({ status: 'loaded', bounty: null });
      return;
    }
    try {
      const bounty = await withTimeout(fetchLatestPostedBounty(userId), API_TIMEOUTS.DEFAULT);
      if (request === requestRef.current) setState({ status: 'loaded', bounty });
    } catch (error) {
      logger.warning('feed.home_post_card.latest_bounty_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (request === requestRef.current) {
        setState(prev => (prev.status === 'loaded' ? prev : { status: 'error' }));
      }
    }
  }, [userId]);

  useEffect(() => {
    setState({ status: 'loading' });
    void reload();
  }, [reload]);

  return { state, reload };
}
