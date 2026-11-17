/**
 * app/postings/[bountyId]/review-and-verify — kept only so old links still work.
 *
 * This used to be a second, separate review screen. Its "Approve and continue
 * to payment" released the money on one tap (later given a confirm alert),
 * and it then landed on a payout page titled "Release payment" for a payment
 * that had already gone out. Posters reached the same decision through two
 * different screens with two different safeguards.
 *
 * There is now one review: PosterReviewModal on the job page (also used by
 * the chat), with the "cannot be undone" step and slide-to-confirm. Anything
 * that still links here (manage links in emails, old deep links) is sent to
 * the job page with ?openReview=work, which opens that review when there is
 * submitted work waiting, and otherwise just shows the job.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ScreenLoader } from '../../../components/ui/screen-loader';

export default function ReviewAndVerifyRedirect() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  const id = Array.isArray(bountyId) ? bountyId[0] : bountyId;

  useEffect(() => {
    if (!id) {
      router.replace('/tabs/bounty-app' as never);
      return;
    }
    router.replace({ pathname: '/postings/[bountyId]', params: { bountyId: String(id), openReview: 'work' } } as never);
  }, [id, router]);

  return <ScreenLoader label="Opening the work to check…" />;
}
