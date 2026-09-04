/**
 * app/in-progress/[bountyId]/hunter/apply — kept as a redirect only.
 *
 * This was a second "waiting room" dashboard for a hunter with a pending
 * application: its own copy of the bounty header, its own four-bubble timeline
 * driven by a `useState` that never changed, and its own dead ends (an alert
 * plus `router.back()` when the application had been rejected or did not
 * exist). It duplicated — and disagreed with — the hunter hub at
 * `/in-progress/[bountyId]/hunter`, which now resolves every hunter-side state
 * from backend data through resolveBountyLifecycle.
 *
 * The route survives as a redirect because it is a real path that shipped
 * builds, notifications and saved links may still point at. It carries the
 * bounty id straight through to the hub.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

export default function HunterApplyRedirect() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const raw = Array.isArray(bountyId) ? bountyId[0] : bountyId;
  const id = raw && String(raw).trim().length > 0 ? String(raw) : null;

  if (!id) {
    return <Redirect href="/tabs/bounty-app?screen=messages&initialTab=inProgress" />;
  }

  return (
    <Redirect
      href={{ pathname: '/in-progress/[bountyId]/hunter', params: { bountyId: id } }}
    />
  );
}
