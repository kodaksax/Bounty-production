/**
 * Profile › Past jobs (Focus-first P.1): finished and cancelled jobs from both
 * sides, out of the way of active work. My Jobs drops a finished job after 7
 * days (FINISHED_FEATURE_WINDOW_DAYS); this is where it can still be found.
 *
 * Data comes from usePastJobs (existing reads only); the screen itself is
 * components/my-jobs/past-jobs-view.tsx. This route only wires navigation.
 */
import { useRouter } from 'expo-router';
import React from 'react';
import { PastJobsView } from '../../components/my-jobs/past-jobs-view';
import { usePastJobs } from '../../hooks/usePastJobs';
import { useValidUserId } from '../../hooks/useValidUserId';
import type { PastJobRow } from '../../lib/my-jobs/past-jobs';
import { bountyAppTabPath } from '../../lib/navigation/bounty-app-tab';

export default function PastJobsScreen() {
  const router = useRouter();
  const userId = useValidUserId();
  const { reload, ...state } = usePastJobs(userId);

  const openRow = (row: PastJobRow) => {
    if (row.side === 'posted') {
      router.push({ pathname: '/postings/[bountyId]', params: { bountyId: row.bountyId } } as never);
    } else {
      // The hunter hub forwards an approved job to its receipt (H.10).
      router.push({ pathname: '/in-progress/[bountyId]/hunter', params: { bountyId: row.bountyId } } as never);
    }
  };
  const goBack = () => {
    if (router.canGoBack?.()) router.back();
    else router.replace(bountyAppTabPath('profile') as never);
  };

  return (
    <PastJobsView
      {...state}
      onRetry={() => void reload()}
      onBack={goBack}
      onOpenRow={openRow}
      onOpenWallet={() => router.push(bountyAppTabPath('wallet') as never)}
    />
  );
}
