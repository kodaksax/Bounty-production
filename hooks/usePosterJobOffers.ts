/**
 * The offers on ONE job, and choosing / passing / asking, for the poster's job
 * page.
 *
 * Before this, "Review hunters" left the job for Inbox > My Bounties (one row
 * per applicant across every job), and each person had to be opened as a
 * separate chat to see a name, a price and Pass / Hire. This loads the job's
 * own pending offers with the profile details ApplicantCard already knows how
 * to show, so three people can be compared on one screen.
 *
 * Choosing goes through exactly the hooks the chat uses: useAcceptFunding
 * (the pay sheet, when the job is pay-when-you-choose) then useAcceptRequest
 * (fn_accept_bounty_request, which accepts and takes the money in one server
 * transaction). No new payment path. The difference is that the outcome comes
 * back, so the page shows "You've chosen Ada" only after the server confirmed
 * the hire, never on a tap that might not have gone through.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useAuthContext } from './use-auth-context';
import { useAcceptFunding } from './useAcceptFunding';
import { useAcceptRequest, type AcceptRequestOutcome } from './useAcceptRequest';
import { useAskApplicant } from './useAskApplicant';
import { useRejectRequest } from './useRejectRequest';
import {
  bountyRequestService,
  type BountyRequestWithDetails,
} from '../lib/services/bounty-request-service';
import type { Bounty } from '../lib/services/database.types';
import { useWallet } from '../lib/wallet-context';

const noop = () => {};

export type OffersLoadState = 'loading' | 'ready' | 'failed';

interface Params {
  bounty: Bounty | null;
  viewerId: string | null;
  /** Only load while the job is open and the viewer is its poster. */
  enabled: boolean;
  /**
   * Pending offers the lifecycle loader counted. An empty detailed list while
   * this is above zero means the detailed read failed (the service resolves
   * failures as []), not that the offers vanished.
   */
  expectedCount: number;
  /** Re-read the job page after any change. */
  onChanged: () => void | Promise<void>;
}

export function usePosterJobOffers({ bounty, viewerId, enabled, expectedCount, onChanged }: Params) {
  const [offers, setOffers] = useState<BountyRequestWithDetails[]>([]);
  const [loadState, setLoadState] = useState<OffersLoadState>('loading');
  const bountyId = bounty ? String(bounty.id) : null;
  const expectedRef = useRef(expectedCount);
  expectedRef.current = expectedCount;

  // The job whose offers are actually on screen. Until a read for THIS job has
  // come back, the section is "loading": showing "No offers yet" under "3
  // people offered to help" while the first read was in flight is what made a
  // senior persona stop on 16 Nov ("I cannot tell which statement is correct").
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !bountyId) {
      setOffers([]);
      setLoadedFor(null);
      setLoadState('ready');
      return;
    }
    setLoadState(prev => (prev === 'failed' ? 'loading' : prev));
    try {
      const rows = await bountyRequestService.getAllWithDetails({ bountyId, status: 'pending' });
      const list = Array.isArray(rows) ? rows : [];
      if (list.length === 0 && expectedRef.current > 0) {
        setLoadedFor(bountyId);
        setLoadState('failed');
        return;
      }
      // First to offer, first shown: a predictable order with no hidden
      // ranking. The poster compares everyone on one screen anyway.
      const sorted = [...list].sort(
        (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
      );
      setOffers(sorted);
      setLoadedFor(bountyId);
      setLoadState('ready');
    } catch {
      setLoadedFor(bountyId);
      setLoadState('failed');
    }
  }, [enabled, bountyId]);

  const visibleLoadState: OffersLoadState =
    enabled && bountyId && loadedFor !== bountyId ? 'loading' : loadState;

  useEffect(() => {
    void load();
  }, [load, expectedCount]);

  const refreshAll = useCallback(async () => {
    await load();
    await onChanged();
  }, [load, onChanged]);

  // ── Shared hooks, exactly as the chat wires them ──────────────────────────
  const { refreshFromApi } = useWallet();
  const { session } = useAuthContext();
  const refreshWallet = useCallback(async () => {
    if (!session?.access_token) return;
    await refreshFromApi(session.access_token, { silent: true, force: true });
  }, [session?.access_token, refreshFromApi]);

  const [hookError, setHookError] = useState<string | null>(null);
  useEffect(() => {
    if (!hookError) return;
    Alert.alert('Something went wrong', hookError);
    setHookError(null);
  }, [hookError]);

  const { gate, ensureFunded, handleAcceptFailure } = useAcceptFunding();
  const myBounties = useMemo(() => (bounty ? [bounty] : []), [bounty]);
  const { handleAcceptRequest } = useAcceptRequest({
    currentUserId: viewerId ?? undefined,
    bountyRequests: offers,
    myBounties,
    setBountyRequests: noop as never,
    setMyBounties: noop as never,
    setInProgressBounties: noop as never,
    setIsLoading: noop as never,
    setError: setHookError,
    loadMyBounties: refreshAll,
    loadInProgress: async () => {},
    loadRequestsForMyBounties: async () => {},
    setActiveScreen: noop,
    ensureFunded,
    refreshWallet,
    handleAcceptFailure,
    // The page shows its own confirmation screen, whose "Message" button
    // also retries setting up the conversation.
    showSuccessAlert: false,
    showMessagingSetupAlert: false,
  });
  const { handleRejectRequest } = useRejectRequest({
    bountyRequests: offers,
    setBountyRequests: setOffers,
    setIsLoading: noop as never,
    setError: setHookError,
    showSuccessAlert: false,
  });
  const { handleAskApplicant, askingRequestId, isAskApplicantBusy } = useAskApplicant({
    bountyRequests: offers,
  });

  const choose = useCallback(
    async (requestId: string | number): Promise<AcceptRequestOutcome> => {
      const outcome = await handleAcceptRequest(requestId);
      if (!outcome.accepted) await load();
      return outcome;
    },
    [handleAcceptRequest, load]
  );

  const pass = useCallback(
    async (requestId: string | number): Promise<boolean> => {
      const removed = await handleRejectRequest(requestId);
      await refreshAll();
      return removed;
    },
    [handleRejectRequest, refreshAll]
  );

  return {
    offers,
    loadState: visibleLoadState,
    reload: load,
    gate,
    choose,
    pass,
    ask: handleAskApplicant,
    askingRequestId,
    isAskBusy: isAskApplicantBusy,
  };
}
