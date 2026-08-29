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
  /** May be undefined if the session isn't resolved — the lookup then simply
   * returns no requests and the operation throws "No application found". */
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

  const requests = await bountyRequestService.getAll({
    bountyId: String(bountyId),
    userId: currentUserId,
  });

  if (requests.length === 0) {
    throw new Error('No application found for this bounty');
  }

  const request = requests[0];
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
