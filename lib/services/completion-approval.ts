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
    releaseFn,
    approveFn,
    revertApproveFn,
    refundReleaseFn,
    notifyFn,
  } = opts;

  // Guard against missing required identifiers
  if (!bountyId || !hunterId) {
    logClientError('approveAndRelease called with missing bountyId or hunterId', {
      bountyId,
      hunterId,
    });
    return false;
  }

  let approved = false;
  let released = false;

  try {
    // Do the status write first because it is easier to compensate than a money movement.
    approved = await approveFn(String(bountyId));
    if (!approved) {
      logClientError('approveFn failed in approveAndRelease', { bountyId, hunterId });
      return false;
    }

    // For honor bounties, skip release step
    if (!isForHonor) {
      released = await releaseFn(bountyId, hunterId, title);
      if (!released) {
        logClientError('Escrow release failed after approve in approveAndRelease', {
          bountyId,
          hunterId,
        });

        if (revertApproveFn) {
          try {
            const reverted = await revertApproveFn(String(bountyId));
            if (!reverted) {
              logClientError('revertApproveFn returned false after release failure', {
                bountyId,
                hunterId,
              });
            } else {
              logClientInfo('revertApproveFn succeeded after release failure', {
                bountyId,
                hunterId,
              });
            }
          } catch (revertErr) {
            logClientError('revertApproveFn threw after release failure', {
              bountyId,
              hunterId,
              error: revertErr,
            });
          }
        }

        return false;
      }

      logClientInfo('Escrow released successfully during approveAndRelease', {
        bountyId,
        hunterId,
      });
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
    // If any error happens after approval in the paid flow, attempt a best-effort
    // refund when a compensating handler is provided.
    if (approved && !isForHonor && refundReleaseFn) {
      try {
        await refundReleaseFn(bountyId, hunterId, title);
      } catch (refundErr) {
        logClientError('refundReleaseFn threw during approveAndRelease catch path', {
          bountyId,
          hunterId,
          error: refundErr,
        });
      }
    }

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
