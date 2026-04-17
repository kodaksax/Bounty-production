import { logClientError, logClientInfo } from './monitoring';

export interface ApproveAndReleaseOptions {
  bountyId: string | number;
  hunterId: string;
  title: string;
  isForHonor?: boolean;
  // releaseFn should return true on success
  releaseFn: (bountyId: string | number, hunterId: string, title: string) => Promise<boolean>;
  // approveFn should return true on success
  approveFn: (bountyId: string) => Promise<boolean>;
  // optional notifyFn to inform hunter to rate poster
  notifyFn?: (userId: string, payload?: Record<string, any>) => Promise<void>;
}

export async function approveAndRelease(opts: ApproveAndReleaseOptions): Promise<boolean> {
  const { bountyId, hunterId, title, isForHonor, releaseFn, approveFn, notifyFn } = opts;

  // Guard against missing required identifiers
  if (!bountyId || !hunterId) {
    logClientError('approveAndRelease called with missing bountyId or hunterId', {
      bountyId,
      hunterId,
    });
    return false;
  }

  try {
    // For honor bounties, skip release step
    if (!isForHonor) {
      const released = await releaseFn(bountyId, hunterId, title);
      if (!released) {
        logClientError('Escrow release failed during approveAndRelease', { bountyId, hunterId });
        return false;
      }
      logClientInfo('Escrow released successfully during approveAndRelease', {
        bountyId,
        hunterId,
      });
    }

    // Approve submission and mark bounty complete
    const approved = await approveFn(String(bountyId));
    if (!approved) {
      logClientError('approveFn failed after release in approveAndRelease', { bountyId, hunterId });
      return false;
    }

    // Notify hunter to rate the poster if notifyFn provided
    if (notifyFn) {
      try {
        await notifyFn(hunterId, { bountyId: String(bountyId), type: 'prompt_rate_poster' });
      } catch (e) {
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

export default approveAndRelease;
