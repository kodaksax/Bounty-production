/**
 * app/support/contact — the in-app Contact Support form as its own route.
 *
 * A job's "Contact support" action (lib/utils/bounty-lifecycle.ts) used to push
 * /tabs/need-help-screen, whose default export is the Post-a-Bounty composer:
 * a poster in a dispute asking for help landed in "post a new job" with no way
 * out. This route hosts the real ContactSupportScreen (the same form Settings
 * shows) and carries the job's id and title into the message.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { ContactSupportScreen } from '../../components/settings/contact-support-screen';
import { ROUTES } from '../../lib/routes';

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim().length > 0 ? raw : null;
}

export default function ContactSupportRoute() {
  const params = useLocalSearchParams<{ bountyId?: string; bountyTitle?: string; topic?: string }>();
  const router = useRouter();

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(ROUTES.TABS.BOUNTY_APP as never);
  }, [router]);

  return (
    <ContactSupportScreen
      onBack={goBack}
      bountyId={firstParam(params.bountyId)}
      bountyTitle={firstParam(params.bountyTitle)}
      topic={firstParam(params.topic) === 'assist' ? 'assist' : undefined}
    />
  );
}
