// lib/services/application-withdrawal.ts
//
// Shared "hunter retracts their pending application" operation, extracted from
// the byte-identical handlers in app/tabs/postings-screen.tsx and
// app/tabs/inbox-screen.tsx so the success-only analytics contract lives in
// one place and can be unit-tested.

import { analyticsService } from './analytics-service';
import { bountyRequestService } from './bounty-request-service';

export type WithdrawApplicationSurface = 'my_postings' | 'inbox';

export interface WithdrawApplicationParams {
  bountyId: string | number;
  /** Must be resolved before we can scope the lookup to the current hunter. */
  currentUserId: string | undefined;
  surface: WithdrawApplicationSurface;
}

export interface WithdrawApplicationResult {
  applicationId: string;
}

/**
 * Delete the current user's still-pending application for `bountyId`.
 *
 * Emits the canonical `application_withdrawn` event ONLY after the delete
 * actually succeeds — a "no application found" lookup or a failed delete
 * throws instead, so the caller surfaces an error without a misleading
 * analytics event ever firing. The analytics call is fire-and-forget with an
 * explicit `.catch`, so a rejected analytics promise can never bubble.
 */
export async function withdrawApplication(
  params: WithdrawApplicationParams
): Promise<WithdrawApplicationResult> {
  const { bountyId, currentUserId, surface } = params;

  if (!currentUserId) {
    throw new Error('You must be signed in to withdraw an application.');
  }

  // Scope the lookup to pending applications so the intent matches what the
  // hunter delete policy allows (own row, still pending). A non-pending row
  // deletes zero rows under RLS and would report a false success.
  const pending = await bountyRequestService.getAll({
    bountyId: String(bountyId),
    userId: currentUserId,
    status: 'pending',
  });

  if (pending.length === 0) {
    // Distinguish "never existed" from an application that existed but is no
    // longer eligible for withdrawal so the hunter sees the right recovery.
    const all = await bountyRequestService.getAll({
      bountyId: String(bountyId),
      userId: currentUserId,
    });
    const existingNonPending = all.find((r) => r.status !== 'pending');
    if (existingNonPending?.status === 'accepted') {
      throw new Error(
        'This application has already been accepted and can no longer be withdrawn.'
      );
    }
    if (existingNonPending?.status === 'rejected') {
      throw new Error(
        'This application has already been rejected and can no longer be withdrawn.'
      );
    }
    if (existingNonPending) {
      throw new Error(
        'This application is no longer pending and can no longer be withdrawn.'
      );
    }
    throw new Error('No application found for this bounty');
  }

  const request = pending[0];
  const success = await bountyRequestService.delete(request.id);

  if (!success) {
    throw new Error('Failed to withdraw application');
  }

  void analyticsService
    .trackEvent('application_withdrawn', {
      role: 'hunter',
      bounty_id: String(bountyId),
      application_id: String(request.id),
      surface,
    })
    .catch(() => {});

  return { applicationId: String(request.id) };
}
