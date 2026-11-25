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
 * Publish-together (E2E-01, Whole-Job Test 2026-11-24): the job row used to be
 * published the moment it arrived, before its offers, submission, dispute and
 * cancellation, so a job with three offers read "No one has offered yet" and
 * submitted work read "working". Now one load reads everything, and only then
 * publishes it as one snapshot. Until a snapshot exists for THIS job and THIS
 * viewer, `isLoading` is true. A load is numbered; only the newest one for the
 * current job and viewer may publish, so a load started before the session
 * restored (viewer unknown, role "visitor") can no longer land last.
 *
 * Refetches keep the last good snapshot on screen. A refetch may move the
 * stage forward, and backward only for the server changes named in
 * lib/utils/stage-progress.ts; any other backward read is refused (dev log).
 *
 * Every sub-fetch is independently guarded: a failing dispute lookup degrades
 * that one flag rather than blanking the whole screen. `error` is set only when
 * the bounty itself could not be loaded on the first read, because that is the
 * only failure that leaves nothing to render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bountyRequestService } from '../lib/services/bounty-request-service';
import { bountyService } from '../lib/services/bounty-service';
import { cancellationService } from '../lib/services/cancellation-service';
import type { CompletionSubmission } from '../lib/services/completion-service';
import { completionService } from '../lib/services/completion-service';
import type { Bounty } from '../lib/services/database.types';
import { disputeService } from '../lib/services/dispute-service';
import { userProfileService } from '../lib/services/userProfile';
import { supabase } from '../lib/supabase';
import type { BountyCancellation, BountyDispute } from '../lib/types';
import { deriveCoarseVerificationStatus } from '../lib/utils/normalize-profile';
import { bountyHoldsUnreleasedEscrow } from '../lib/utils/payment-architecture';
import type { BountyLifecycleState, BountyRole } from '../lib/utils/bounty-lifecycle';
import { isPayingState, resolveBountyLifecycle } from '../lib/utils/bounty-lifecycle';
import { uniqueRealtimeTopic } from '../lib/utils/realtime-topic';
import { checkStageMove, PAYING_POLL_MS, PAYING_POLL_STOP_MS, type StageFacts } from '../lib/utils/stage-progress';
import { useRequestExpiryPolicy } from './useRequestExpiryPolicy';

export interface BountyLifecycleContext {
  bounty: Bounty | null;
  role: BountyRole;
  state: BountyLifecycleState | null;
  /** The other side of the transaction — hunter for a poster, poster for a hunter. */
  otherParty: {
    id: string | null;
    name: string | null;
    avatar: string | null;
    /** Stripe checked their photo ID (public_profiles); null when the profile didn't load. */
    idVerified?: boolean | null;
  };
  /** Unreviewed applications on this bounty (poster side only). */
  applicationCount: number;
  submission: CompletionSubmission | null;
  requestStatus: string | null;
  /** bounty_requests.rejection_source for the viewer's own application. */
  requestRejectionSource: string | null;
  requestId: string | null;
  hasDispute: boolean;
  disputeId: string | null;
  /** The open dispute itself, read in the same load as the flag. */
  dispute: BountyDispute | null;
  hasCancellationRequest: boolean;
  /** Which role opened the pending cancellation request, when there is one. */
  cancellationRequestedByRole: 'poster' | 'hunter' | null;
  /** The pending cancellation request itself, read in the same load as the flag. */
  cancellation: BountyCancellation | null;
  /** True until a full read for this bounty AND this viewer has been published. */
  isLoading: boolean;
  /** Set only when the bounty itself failed to load. */
  error: string | null;
  /** True when the bounty id resolved to nothing (deleted, or bad deep link). */
  notFound: boolean;
  refresh: () => Promise<void>;
}

const EMPTY_OTHER_PARTY = { id: null, name: null, avatar: null };

/**
 * Whether Stripe checked this person's photo ID, read fresh from
 * public_profiles: userProfileService.getProfile caches other people's
 * profiles indefinitely, so its verificationStatus can be stale. Null when it
 * can't be read, so the screen says nothing rather than "hasn't verified".
 */
async function readIdVerified(userId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.from('public_profiles').select('stripe_identity_status').eq('id', userId).maybeSingle();
    if (error || !data) return null;
    return deriveCoarseVerificationStatus((data as { stripe_identity_status?: string }).stripe_identity_status) === 'verified';
  } catch {
    return null;
  }
}

/** One full, consistent read of a job for one viewer. */
interface Snapshot {
  /** `${bountyId}|${viewerId}`: a snapshot is only ever shown for its own key. */
  key: string;
  bounty: Bounty | null;
  notFound: boolean;
  error: string | null;
  role: BountyRole;
  otherParty: BountyLifecycleContext['otherParty'];
  applicationCount: number;
  submission: CompletionSubmission | null;
  requestStatus: string | null;
  requestRejectionSource: string | null;
  requestId: string | null;
  requestPosterInteracted: boolean | null;
  dispute: BountyDispute | null;
  cancellation: BountyCancellation | null;
}

function snapshotKey(bountyId: string | null, viewerId: string | null | undefined): string {
  return `${bountyId ?? ''}|${viewerId ?? ''}`;
}

function factsOf(s: Snapshot): StageFacts {
  return {
    bountyStatus: s.bounty?.status ?? null,
    acceptedBy: (s.bounty?.accepted_by as string | null | undefined) ?? null,
    applicationCount: s.applicationCount,
    submissionStatus: s.submission?.status ?? null,
    hasDispute: !!s.dispute,
    hasCancellationRequest: !!s.cancellation,
  };
}

/**
 * The snapshot to show after `next` arrives: `next`, unless it would move a
 * job that is already on screen backward without a real server change.
 */
export function acceptSnapshot<T extends Snapshot>(prev: T | null, next: T): T {
  if (!prev || prev.key !== next.key || !prev.bounty || !next.bounty) return next;
  const verdict = checkStageMove(factsOf(prev), factsOf(next));
  if (verdict.allowed) return next;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[useBountyLifecycle] refused a backward stage move', {
      bountyId: String(next.bounty.id),
      from: verdict.from,
      to: verdict.to,
      prev: factsOf(prev),
      next: factsOf(next),
    });
  }
  return prev;
}

async function readSnapshot(id: string, viewerId: string | null | undefined): Promise<Snapshot> {
  const key = snapshotKey(id, viewerId);
  const loaded = await bountyService.getById(id);
  const empty: Snapshot = {
    key,
    bounty: null,
    notFound: true,
    error: null,
    role: 'visitor',
    otherParty: EMPTY_OTHER_PARTY,
    applicationCount: 0,
    submission: null,
    requestStatus: null,
    requestRejectionSource: null,
    requestId: null,
    requestPosterInteracted: null,
    dispute: null,
    cancellation: null,
  };
  if (!loaded) return empty;

  const posterId = (loaded.poster_id as string | undefined) || (loaded.user_id as string | undefined) || null;
  const viewerIsPoster = !!viewerId && !!posterId && String(posterId) === String(viewerId);
  const otherPartyId = viewerIsPoster ? ((loaded.accepted_by as string | undefined) ?? null) : posterId;

  const [mine, otherParty, applicationCount, submission, dispute, cancellation] = await Promise.all([
    // The viewer's own application decides hunter vs visitor. A hunter who
    // withdrew has no row and is correctly treated as a visitor again.
    (async () => {
      if (viewerIsPoster || !viewerId) return null;
      try {
        const reqs = await bountyRequestService.getAll({ bountyId: id, userId: String(viewerId) });
        if (!Array.isArray(reqs) || reqs.length === 0) return null;
        return {
          status: reqs[0].status ?? null,
          rejectionSource: reqs[0].rejection_source ?? null,
          posterInteracted: !!(reqs[0] as { poster_interacted_at?: string | null }).poster_interacted_at,
          id: reqs[0].id != null ? String(reqs[0].id) : null,
        };
      } catch {
        // A failed lookup must not demote a real hunter to a visitor with an
        // "Apply" button, so fall back to the bounty's accepted hunter.
        return String(loaded.accepted_by ?? '') === String(viewerId)
          ? { status: 'accepted', rejectionSource: null, posterInteracted: null, id: null }
          : null;
      }
    })(),
    (async () => {
      if (!otherPartyId) return EMPTY_OTHER_PARTY;
      try {
        const [profile, idVerified] = await Promise.all([
          userProfileService.getProfile(String(otherPartyId)),
          viewerIsPoster ? readIdVerified(String(otherPartyId)) : Promise.resolve(null),
        ]);
        return { id: String(otherPartyId), name: profile?.username ?? null, avatar: profile?.avatar ?? null, idVerified };
      } catch {
        return { id: String(otherPartyId), name: null, avatar: null, idVerified: null };
      }
    })(),
    // Only a poster needs the applicant count, and only while the bounty can
    // still take applications.
    (async () => {
      if (!viewerIsPoster || loaded.status !== 'open') return 0;
      try {
        const pending = await bountyRequestService.getAll({ bountyId: id, status: 'pending' });
        return Array.isArray(pending) ? pending.length : 0;
      } catch {
        return 0;
      }
    })(),
    (async () => {
      try {
        return (await completionService.getSubmission(id)) ?? null;
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const d = await disputeService.getDisputeByBountyId(id);
        return d && (d.status === 'open' || d.status === 'under_review') ? d : null;
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const c = await cancellationService.getCancellationByBountyId(id);
        return c?.status === 'pending' ? c : null;
      } catch {
        return null;
      }
    })(),
  ]);

  const role: BountyRole = viewerIsPoster
    ? 'poster'
    : mine?.status || (viewerId && String(loaded.accepted_by ?? '') === String(viewerId))
      ? 'hunter'
      : 'visitor';

  return {
    key,
    bounty: loaded,
    notFound: false,
    error: null,
    role,
    otherParty,
    applicationCount,
    submission,
    requestStatus: mine?.status ?? null,
    requestRejectionSource: mine?.rejectionSource ?? null,
    requestId: mine?.id ?? null,
    requestPosterInteracted: mine?.posterInteracted ?? null,
    dispute,
    cancellation,
  };
}

export function useBountyLifecycle(
  bountyId: string | null,
  currentUserId: string | null | undefined
): BountyLifecycleContext {
  const requestExpiryPolicy = useRequestExpiryPolicy();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const currentKey = snapshotKey(bountyId, currentUserId);
  const currentKeyRef = useRef(currentKey);
  currentKeyRef.current = currentKey;

  // Each load is numbered. Only the newest load for the current job and viewer
  // may publish; anything else finished too late to matter.
  const loadSeqRef = useRef(0);
  // Reads in flight, so the paying poll never supersedes a slow read with
  // another one (each newer load makes the older one stale).
  const inFlightRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (id: string, viewerId: string | null | undefined) => {
    const seq = ++loadSeqRef.current;
    const key = snapshotKey(id, viewerId);
    const isStale = () => !mountedRef.current || seq !== loadSeqRef.current || currentKeyRef.current !== key;
    let next: Snapshot;
    inFlightRef.current += 1;
    try {
      next = await readSnapshot(id, viewerId);
    } catch (err) {
      if (isStale()) return;
      const message = err instanceof Error ? err.message : 'Failed to load bounty';
      // A failed refetch keeps the last good read on screen; only a job that
      // never loaded shows the error.
      setSnapshot((prev) =>
        prev && prev.key === key && prev.bounty
          ? prev
          : {
              key,
              bounty: null,
              notFound: false,
              error: message,
              role: 'visitor',
              otherParty: EMPTY_OTHER_PARTY,
              applicationCount: 0,
              submission: null,
              requestStatus: null,
              requestRejectionSource: null,
              requestId: null,
              requestPosterInteracted: null,
              dispute: null,
              cancellation: null,
            }
      );
      return;
    } finally {
      inFlightRef.current -= 1;
    }
    if (isStale()) return;
    setSnapshot((prev) => acceptSnapshot(prev, next));
  }, []);

  useEffect(() => {
    if (!bountyId) return;
    void load(bountyId, currentUserId);
  }, [bountyId, currentUserId, load]);

  const refresh = useCallback(async () => {
    if (bountyId) await load(bountyId, currentUserId);
  }, [bountyId, currentUserId, load]);

  const shown = snapshot && snapshot.key === currentKey ? snapshot : null;
  const bounty = shown?.bounty ?? null;

  // Live submission updates: the poster's "Awaiting your approval" must appear
  // without a manual refresh the moment the hunter submits, and the hunter's
  // "Changes requested" the moment the poster sends it back. The update joins
  // the snapshot on screen and goes through the same backward-move check.
  const liveStatus = bounty?.status;
  useEffect(() => {
    if (!bountyId || liveStatus !== 'in_progress') return;
    const key = currentKey;
    let unsub: (() => void) | undefined;
    try {
      unsub = completionService.subscribeSubmission(bountyId, (nextSubmission) => {
        if (!mountedRef.current || currentKeyRef.current !== key) return;
        setSnapshot((prev) =>
          prev && prev.key === key ? acceptSnapshot(prev, { ...prev, submission: nextSubmission ?? null }) : prev
        );
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
  }, [bountyId, liveStatus, currentKey]);

  // Paying: the work is approved but the job row hasn't read back finished.
  // Watch the job row (the same live subscription the job thread uses) and
  // poll for a bounded time; after PAYING_POLL_STOP_MS the screen keeps saying
  // it's confirming, never an error. Keyed on the server state, so the rating
  // sheet opening or closing (which refreshes) can't restart or reset it.
  const paying = !!bounty && isPayingState(bounty, shown?.submission?.status);
  useEffect(() => {
    if (!paying || !bountyId) return;
    const startedAt = Date.now();
    const reread = () => {
      if (mountedRef.current) void load(bountyId, currentUserId);
    };
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(uniqueRealtimeTopic(`bounty-lifecycle-paying:${bountyId}`))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bounties', filter: `id=eq.${bountyId}` }, reread)
        .subscribe();
    } catch {
      channel = null; // realtime unavailable — the poll still runs
    }
    const timer = setInterval(() => {
      if (Date.now() - startedAt >= PAYING_POLL_STOP_MS) {
        clearInterval(timer);
        return;
      }
      if (inFlightRef.current === 0) reread();
    }, PAYING_POLL_MS);
    return () => {
      clearInterval(timer);
      try {
        if (channel) supabase.removeChannel(channel);
      } catch {
        /* best-effort */
      }
    };
  }, [paying, bountyId, currentUserId, load]);

  const state = useMemo(
    () =>
      shown?.bounty
        ? resolveBountyLifecycle({
            bounty: shown.bounty,
            role: shown.role,
            viewerId: currentUserId ?? null,
            requestStatus: shown.requestStatus,
            requestRejectionSource: shown.requestRejectionSource,
            requestExpiryPolicy,
            requestPosterInteracted: shown.requestPosterInteracted,
            submissionStatus: shown.submission?.status ?? null,
            submittedAt: shown.submission?.submitted_at ?? null,
            submissionIsMine:
              !!currentUserId && !!shown.submission && String(shown.submission.hunter_id) === String(currentUserId),
            applicationCount: shown.applicationCount,
            hasDispute: !!shown.dispute,
            hasCancellationRequest: !!shown.cancellation,
            cancellationRequestedByRole: shown.cancellation?.requesterType ?? null,
            otherPartyName: shown.otherParty.name,
            paymentState: bountyHoldsUnreleasedEscrow(shown.bounty) ? 'held' : 'released',
          })
        : null,
    [shown, currentUserId, requestExpiryPolicy]
  );

  return {
    bounty,
    role: shown?.role ?? 'visitor',
    state,
    otherParty: shown?.otherParty ?? EMPTY_OTHER_PARTY,
    applicationCount: shown?.applicationCount ?? 0,
    submission: shown?.submission ?? null,
    requestStatus: shown?.requestStatus ?? null,
    requestRejectionSource: shown?.requestRejectionSource ?? null,
    requestId: shown?.requestId ?? null,
    hasDispute: !!shown?.dispute,
    disputeId: shown?.dispute ? String(shown.dispute.id) : null,
    dispute: shown?.dispute ?? null,
    hasCancellationRequest: !!shown?.cancellation,
    cancellationRequestedByRole: shown?.cancellation?.requesterType ?? null,
    cancellation: shown?.cancellation ?? null,
    isLoading: !!bountyId && !shown,
    error: shown?.error ?? null,
    notFound: !bountyId || !!shown?.notFound,
    refresh,
  };
}

export default useBountyLifecycle;
