import { analyticsService, type AnalyticsProperties } from './analytics-service';
import { logClientError, logClientInfo } from './monitoring';

export interface ApproveAndReleaseOptions {
  bountyId: string | number;
  hunterId: string;
  title: string;
  isForHonor?: boolean;
  // Analytics only: the bounty's gross amount in dollars and the approving
  // poster's user id (the PostHog distinct id), carried on escrow_released.
  amount?: number;
  posterId?: string | null;
  // releaseFn should return true on success
  releaseFn: (bountyId: string | number, hunterId: string, title: string) => Promise<boolean>;
  // approveFn should return true on success
  approveFn: (bountyId: string) => Promise<boolean>;
  // optional best-effort compensation when release fails after approve succeeds
  revertApproveFn?: (bountyId: string) => Promise<boolean>;
  // optional best-effort compensation when approve fails after release succeeds
  refundReleaseFn?: (
    bountyId: string | number,
    hunterId: string,
    title: string
  ) => Promise<boolean>;
  // optional notifyFn to inform hunter to rate poster
  notifyFn?: (userId: string, payload?: Record<string, any>) => Promise<void>;
}

export async function approveAndRelease(opts: ApproveAndReleaseOptions): Promise<boolean> {
  const {
    bountyId,
    hunterId,
    title,
    isForHonor,
    amount,
    posterId,
    releaseFn,
    approveFn,
    revertApproveFn,
    refundReleaseFn,
    notifyFn,
  } = opts;

  // Every production completion in the 30 days to 2026-09-28 came through
  // here (bounty_completed via=approve_submission), yet escrow_released only
  // fired from payout.tsx's Stripe-native branch and had never been seen.
  // payout_success is a different thing — a hunter's bank withdrawal of
  // their whole balance — and cannot carry a bounty_id.
  const releaseProps: AnalyticsProperties = {
    bounty_id: String(bountyId),
    bountyId: String(bountyId),
    ...(typeof amount === 'number' ? { amount } : {}),
    hunter_person_id: hunterId,
    poster_person_id: posterId || undefined,
    via: 'approve_submission',
  };

  // Guard against missing required identifiers
  if (!bountyId || !hunterId) {
    logClientError('approveAndRelease called with missing bountyId or hunterId', {
      bountyId,
      hunterId,
    });
    return false;
  }

  let released = false;

  try {
    // Never mark work approved before its paid settlement has succeeded.
    // A failed release must leave the submission pending for a safe retry.
    if (!isForHonor) {
      try {
        released = await releaseFn(bountyId, hunterId, title);
      } catch (releaseErr) {
        trackRelease('payment_failed', {
          ...releaseProps,
          stage: 'release',
          reason: releaseErr instanceof Error ? releaseErr.message.slice(0, 200) : 'unknown',
        });
        throw releaseErr;
      }
      if (!released) {
        logClientError('Escrow release failed before completion approval', {
          bountyId,
          hunterId,
        });
        trackRelease('payment_failed', {
          ...releaseProps,
          stage: 'release',
          reason: 'release_not_confirmed',
        });
        return false;
      }

      logClientInfo('Escrow released successfully during approveAndRelease', {
        bountyId,
        hunterId,
      });
      // releaseFn only returns true once the server has settled the release
      // (wallet credit, or a Stripe transfer for Phase 2/v3), so this is the
      // confirmed "funds dispatched to the hunter" point for this bounty.
      trackRelease('escrow_released', releaseProps);
    }

    const approved = await approveFn(String(bountyId));
    if (!approved) {
      logClientError('approveFn failed after settlement', { bountyId, hunterId });
      return false;
    }

    // Notify hunter to rate the poster if notifyFn provided
    if (notifyFn) {
      try {
        await notifyFn(hunterId, { bountyId: String(bountyId), type: 'prompt_rate_poster' });
      } catch {
        // non-fatal
        logClientInfo('Failed to notify hunter to rate poster', { bountyId, hunterId });
      }
    }

    return true;
  } catch (err) {
    logClientError('approveAndRelease unexpected error', { error: err, bountyId, hunterId });
    // Re-throw errors that carry a user-visible message (e.g. "no payout account",
    // "session expired") so the calling UI can display the specific reason rather than
    // the generic "contact support" fallback.
    if (err instanceof Error && err.message) {
      throw err;
    }
    return false;
  }
}

// Fire-and-forget: analytics must never change whether approval succeeds.
function trackRelease(
  event: 'escrow_released' | 'payment_failed',
  props: AnalyticsProperties
): void {
  try {
    void analyticsService.trackEvent(event, props).catch(() => {});
  } catch {
    /* analytics is best-effort */
  }
}

export default approveAndRelease;
