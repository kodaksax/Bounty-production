/**
 * Loads everything `resolveBountyLifecycle` needs for ONE bounty and keeps it
 * live.
 *
 * The detail screens each used to fetch some subset of this — the poster
 * dashboard fetched only the bounty, the expandable card fetched submissions
 * and disputes, the hunter flow screens fetched requests — which is why the
 * same bounty could read "in progress" on one screen and "awaiting review" on
 * another. This hook is the one loader, so every screen sees the same inputs.
 *
 * Every sub-fetch is independently guarded: a failing dispute lookup degrades
 * that one flag rather than blanking the whole screen. `error` is set only when
 * the bounty itself could not be loaded, because that is the only failure that
 * leaves nothing to render.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { bountyRequestService } from '../lib/services/bounty-request-service';
import { bountyService } from '../lib/services/bounty-service';
import { cancellationService } from '../lib/services/cancellation-service';
import type { CompletionSubmission } from '../lib/services/completion-service';
import { completionService } from '../lib/services/completion-service';
import type { Bounty } from '../lib/services/database.types';
import { disputeService } from '../lib/services/dispute-service';
import { userProfileService } from '../lib/services/userProfile';
import { bountyHoldsUnreleasedEscrow } from '../lib/utils/payment-architecture';
import type { BountyLifecycleState, BountyRole } from '../lib/utils/bounty-lifecycle';
import { resolveBountyLifecycle } from '../lib/utils/bounty-lifecycle';

export interface BountyLifecycleContext {
  bounty: Bounty | null;
  role: BountyRole;
  state: BountyLifecycleState | null;
  /** The other side of the transaction — hunter for a poster, poster for a hunter. */
  otherParty: { id: string | null; name: string | null; avatar: string | null };
  /** Unreviewed applications on this bounty (poster side only). */
  applicationCount: number;
  submission: CompletionSubmission | null;
  requestStatus: string | null;
  requestId: string | null;
  hasDispute: boolean;
  disputeId: string | null;
  hasCancellationRequest: boolean;
  isLoading: boolean;
  /** Set only when the bounty itself failed to load. */
  error: string | null;
  /** True when the bounty id resolved to nothing (deleted, or bad deep link). */
  notFound: boolean;
  refresh: () => Promise<void>;
}

const EMPTY_OTHER_PARTY = { id: null, name: null, avatar: null };

export function useBountyLifecycle(
  bountyId: string | null,
  currentUserId: string | null | undefined
): BountyLifecycleContext {
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [role, setRole] = useState<BountyRole>('visitor');
  const [otherParty, setOtherParty] =
    useState<BountyLifecycleContext['otherParty']>(EMPTY_OTHER_PARTY);
  const [applicationCount, setApplicationCount] = useState(0);
  const [submission, setSubmission] = useState<CompletionSubmission | null>(null);
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [hasDispute, setHasDispute] = useState(false);
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [hasCancellationRequest, setHasCancellationRequest] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Guards against a slower response for a previously-requested bounty landing
  // after the user has already navigated to a different one.
  const latestIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (id: string, opts: { showSpinner?: boolean } = {}) => {
      const { showSpinner = true } = opts;
      latestIdRef.current = id;
      const isStale = () => !mountedRef.current || latestIdRef.current !== id;

      if (showSpinner) setIsLoading(true);
      setError(null);
      setNotFound(false);

      let loaded: Bounty | null = null;
      try {
        loaded = await bountyService.getById(id);
      } catch (err) {
        if (isStale()) return;
        setError(err instanceof Error ? err.message : 'Failed to load bounty');
        setIsLoading(false);
        return;
      }
      if (isStale()) return;

      if (!loaded) {
        setBounty(null);
        setNotFound(true);
        setIsLoading(false);
        return;
      }
      setBounty(loaded);

      const posterId = (loaded.poster_id as string | undefined) || (loaded.user_id as string | undefined) || null;
      const viewerIsPoster = !!currentUserId && !!posterId && String(posterId) === String(currentUserId);

      // The viewer's own application decides hunter vs visitor. A hunter who
      // withdrew has no row and is correctly treated as a visitor again.
      let myRequestStatus: string | null = null;
      let myRequestId: string | null = null;
      if (!viewerIsPoster && currentUserId) {
        try {
          const reqs = await bountyRequestService.getAll({ bountyId: id, userId: String(currentUserId) });
          if (Array.isArray(reqs) && reqs.length > 0) {
            myRequestStatus = reqs[0].status ?? null;
            myRequestId = reqs[0].id != null ? String(reqs[0].id) : null;
          }
        } catch {
          // A failed lookup must not demote a real hunter to a visitor with an
          // "Apply" button, so fall back to the bounty's accepted hunter.
          if (currentUserId && String(loaded.accepted_by ?? '') === String(currentUserId)) {
            myRequestStatus = 'accepted';
          }
        }
      }
      if (isStale()) return;
      setRequestStatus(myRequestStatus);
      setRequestId(myRequestId);

      const resolvedRole: BountyRole = viewerIsPoster
        ? 'poster'
        : myRequestStatus || (currentUserId && String(loaded.accepted_by ?? '') === String(currentUserId))
          ? 'hunter'
          : 'visitor';
      setRole(resolvedRole);

      // ── Everything below is supplementary: failures degrade one field ────
      const otherPartyId = viewerIsPoster
        ? ((loaded.accepted_by as string | undefined) ?? null)
        : posterId;

      await Promise.all([
        (async () => {
          if (!otherPartyId) {
            if (!isStale()) setOtherParty(EMPTY_OTHER_PARTY);
            return;
          }
          try {
            const profile = await userProfileService.getProfile(String(otherPartyId));
            if (isStale()) return;
            setOtherParty({
              id: String(otherPartyId),
              name: profile?.username ?? null,
              avatar: profile?.avatar ?? null,
            });
          } catch {
            if (!isStale()) setOtherParty({ id: String(otherPartyId), name: null, avatar: null });
          }
        })(),

        (async () => {
          // Only a poster needs the applicant count, and only while the bounty
          // can still take applications.
          if (!viewerIsPoster || loaded?.status !== 'open') {
            if (!isStale()) setApplicationCount(0);
            return;
          }
          try {
            const pending = await bountyRequestService.getAll({ bountyId: id, status: 'pending' });
            if (!isStale()) setApplicationCount(Array.isArray(pending) ? pending.length : 0);
          } catch {
            if (!isStale()) setApplicationCount(0);
          }
        })(),

        (async () => {
          try {
            const latest = await completionService.getSubmission(id);
            if (!isStale()) setSubmission(latest ?? null);
          } catch {
            if (!isStale()) setSubmission(null);
          }
        })(),

        (async () => {
          try {
            const dispute = await disputeService.getDisputeByBountyId(id);
            if (isStale()) return;
            const open = !!dispute && (dispute.status === 'open' || dispute.status === 'under_review');
            setHasDispute(open);
            setDisputeId(open ? String(dispute!.id) : null);
          } catch {
            if (!isStale()) {
              setHasDispute(false);
              setDisputeId(null);
            }
          }
        })(),

        (async () => {
          try {
            const cancellation = await cancellationService.getCancellationByBountyId(id);
            if (!isStale()) setHasCancellationRequest(cancellation?.status === 'pending');
          } catch {
            if (!isStale()) setHasCancellationRequest(false);
          }
        })(),
      ]);

      if (isStale()) return;
      setIsLoading(false);
    },
    [currentUserId]
  );

  useEffect(() => {
    if (!bountyId) {
      setIsLoading(false);
      setNotFound(true);
      return;
    }
    load(bountyId);
  }, [bountyId, load]);

  // Live submission updates: the poster's "Awaiting your approval" must appear
  // without a manual refresh the moment the hunter submits, and the hunter's
  // "Changes requested" the moment the poster sends it back.
  useEffect(() => {
    if (!bountyId || bounty?.status !== 'in_progress') return;
    let unsub: (() => void) | undefined;
    try {
      unsub = completionService.subscribeSubmission(bountyId, next => {
        if (mountedRef.current && latestIdRef.current === bountyId) setSubmission(next ?? null);
      });
    } catch {
      // Realtime unavailable — pull-to-refresh still updates the screen.
    }
    return () => {
      try {
        unsub?.();
      } catch {
        /* best-effort cleanup */
      }
    };
  }, [bountyId, bounty?.status]);

  const refresh = useCallback(async () => {
    if (bountyId) await load(bountyId, { showSpinner: false });
  }, [bountyId, load]);

  const state = bounty
    ? resolveBountyLifecycle({
        bounty: bounty as any,
        role,
        requestStatus,
        submissionStatus: submission?.status ?? null,
        submissionIsMine:
          !!currentUserId && !!submission && String(submission.hunter_id) === String(currentUserId),
        applicationCount,
        hasDispute,
        hasCancellationRequest,
        otherPartyName: otherParty.name,
        paymentState: bountyHoldsUnreleasedEscrow(bounty as any) ? 'held' : 'released',
      })
    : null;

  return {
    bounty,
    role,
    state,
    otherParty,
    applicationCount,
    submission,
    requestStatus,
    requestId,
    hasDispute,
    disputeId,
    hasCancellationRequest,
    isLoading,
    error,
    notFound,
    refresh,
  };
}

export default useBountyLifecycle;
