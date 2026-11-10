// app/bounty/[id]/post-again.tsx — the "Post again" deep link
// (lib/navigation/post-again-link.ts), for thank-you emails:
//   bountyexpo-workspace://bounty/<id>/post-again?source=email
//   https://bountyfinder.app/bounty/<id>/post-again?source=email
//
// Signed in: copy the bounty into the composer and open it on the last step,
// the same as tapping Post again in the app. Signed out: go through sign-in,
// which brings the user back here (redirect_to, post-login-redirect.ts).
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { ScreenLoader } from '../../../components/ui/screen-loader';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { bountyAppTabPath } from '../../../lib/navigation/bounty-app-tab';
import { postAgainRoutePath } from '../../../lib/navigation/post-again-link';
import { isPostAgainSource } from '../../../lib/post-again/sources';
import { startPostAgain } from '../../../lib/post-again/start-post-again';
import { analyticsService } from '../../../lib/services/analytics-service';
import { isUuid } from '../../../supabase/functions/_shared/web-links';

export default function PostAgainLinkRoute() {
  const { id, source: sourceParam } = useLocalSearchParams<{ id?: string; source?: string }>();
  const router = useRouter();
  const { session, isLoading } = useAuthContext();
  const userId = session?.user?.id ?? null;

  const rawId = Array.isArray(id) ? id[0] : id;
  const bountyId = isUuid(rawId) ? rawId.toLowerCase() : null;
  const rawSource = Array.isArray(sourceParam) ? sourceParam[0] : sourceParam;
  // This route exists for email links; one without a source counts as email.
  const source = isPostAgainSource(rawSource) ? rawSource : 'email';

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current || source !== 'email') return;
    tracked.current = true;
    analyticsService.trackEvent('email_link_opened', {
      destination: 'post_again',
      has_bounty: Boolean(bountyId),
    });
  }, [bountyId, source]);

  const started = useRef(false);
  useEffect(() => {
    if (isLoading || started.current) return;
    if (!bountyId) {
      started.current = true;
      router.replace(bountyAppTabPath('postings') as never);
      return;
    }
    if (!userId) {
      started.current = true;
      router.replace({ pathname: '/', params: { redirect_to: postAgainRoutePath(bountyId, source) } } as never);
      return;
    }
    started.current = true;
    void startPostAgain({ bountyId, userId, source }).then((result) => {
      // Opened: the composer has the copy. Kept their draft: the Post tab
      // shows that draft. Failed (not theirs, gone): they were told why, and
      // the feed is the neutral place to land.
      const tab = result === 'failed' ? 'bounty' : 'postings';
      router.dismissTo(bountyAppTabPath(tab) as never);
    });
  }, [isLoading, bountyId, userId, source, router]);

  return <ScreenLoader label={isLoading ? 'Loading...' : 'Getting your post ready...'} />;
}
