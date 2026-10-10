/**
 * Loads everything one bounty thread (My Bounties tab) renders: the bounty,
 * the application between this hunter and poster, the latest completion
 * submission, any cancellation / dispute, the counterpart's profile and the
 * DM conversation between the two of them.
 *
 * Read-only by design. Every action the thread offers goes through the same
 * services the old expandable cards called — this hook only keeps the derived
 * cards fresh, including via realtime so the other party's move lands in the
 * thread without a refresh (the "taking turns" feel).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service';
import { bountyRequestService } from 'lib/services/bounty-request-service';
import { bountyService } from 'lib/services/bounty-service';
import { cancellationService } from 'lib/services/cancellation-service';
import type { CompletionSubmission } from 'lib/services/completion-service';
import { completionService } from 'lib/services/completion-service';
import type { Bounty } from 'lib/services/database.types';
import { disputeService } from 'lib/services/dispute-service';
import * as supabaseMessaging from 'lib/services/supabase-messaging';
import { userProfileService } from 'lib/services/userProfile';
import { supabase } from 'lib/supabase';
import type { BountyDispute, Conversation } from 'lib/types';
import type { BountyThreadEvent, BountyThreadRole } from 'lib/utils/bounty-thread-events';
import { buildBountyThreadEvents } from 'lib/utils/bounty-thread-events';
import { uniqueRealtimeTopic } from 'lib/utils/realtime-topic';

export interface BountyThreadCounterpart {
  id: string;
  name: string;
  avatar: string | null;
}

interface UseBountyThreadArgs {
  bountyId: string;
  role: BountyThreadRole;
  viewerId: string | null;
  /** Poster side: the hunter this thread is with. Hunter side: ignored (the poster). */
  counterpartId?: string | null;
}

/**
 * Picks the DM for this pair, preferring one created for this bounty. Pairs
 * can have more than one conversation (the accept flow creates a bounty-scoped
 * one); the same precedence MyPostingExpandable used.
 */
export function findPairConversation(
  conversations: Conversation[],
  viewerId: string | null | undefined,
  counterpartId: string | null | undefined,
  bountyId: string
): Conversation | null {
  if (!viewerId || !counterpartId) return null;
  const pair = conversations.filter(c => {
    if (c.isGroup) return false;
    const parts = (c.participantIds || []).map(String);
    return parts.includes(String(viewerId)) && parts.includes(String(counterpartId));
  });
  return pair.find(c => String(c.bountyId) === String(bountyId)) ?? pair[0] ?? null;
}

export function useBountyThread({ bountyId, role, viewerId, counterpartId }: UseBountyThreadArgs) {
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [request, setRequest] = useState<BountyRequestWithDetails | null>(null);
  const [submission, setSubmission] = useState<CompletionSubmission | null>(null);
  const [readyAt, setReadyAt] = useState<string | null>(null);
  const [cancellation, setCancellation] = useState<Awaited<
    ReturnType<typeof cancellationService.getCancellationByBountyId>
  > | null>(null);
  const [dispute, setDispute] = useState<BountyDispute | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [counterpart, setCounterpart] = useState<BountyThreadCounterpart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!bountyId) return;
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;
    try {
      setError(null);
      const b = await bountyService.getById(bountyId);
      if (stale()) return;
      if (!b) {
        setError('This bounty is no longer available.');
        return;
      }
      setBounty(b);

      const posterId = String(b.poster_id || b.user_id || '');
      const otherId =
        role === 'poster' ? String(counterpartId || b.accepted_by || '') : posterId;

      // The application between this hunter and this bounty.
      const hunterId = role === 'poster' ? otherId : String(viewerId || '');
      const [reqs, sub, cancel, disp, convs, profile] = await Promise.all([
        hunterId
          ? bountyRequestService
              .getAllWithDetails({ bountyId: String(b.id), userId: hunterId })
              .catch(() => [] as BountyRequestWithDetails[])
          : Promise.resolve([] as BountyRequestWithDetails[]),
        b.accepted_by ? completionService.getSubmission(String(b.id)) : Promise.resolve(null),
        cancellationService.getCancellationByBountyId(String(b.id)).catch(() => null),
        disputeService.getDisputeByBountyId(String(b.id)).catch(() => null),
        viewerId
          ? supabaseMessaging.fetchConversations(String(viewerId)).catch(() => [] as Conversation[])
          : Promise.resolve([] as Conversation[]),
        otherId ? userProfileService.getProfile(otherId).catch(() => null) : Promise.resolve(null),
      ]);
      if (stale()) return;

      const mine = (reqs || []).find(
        r => String((r as any).hunter_id ?? (r as any).user_id) === hunterId
      );
      setRequest(mine ?? null);
      setSubmission(sub);
      setCancellation(cancel);
      setDispute(disp);
      setConversation(findPairConversation(convs, viewerId, otherId, String(b.id)));
      if (otherId) {
        setCounterpart({
          id: otherId,
          name:
            (profile as any)?.username ||
            (mine as any)?.profile?.username ||
            (role === 'poster' ? 'Hunter' : (b as any).username || 'Poster'),
          avatar: (profile as any)?.avatar || (mine as any)?.profile?.avatar || null,
        });
      } else {
        setCounterpart(null);
      }

      if (b.accepted_by) {
        const ready = await completionService.getReady(String(b.id)).catch(() => null);
        if (!stale()) setReadyAt(ready?.ready_at ?? null);
      }
    } catch (e) {
      if (!stale()) setError(e instanceof Error ? e.message : 'Failed to load this bounty');
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [bountyId, role, viewerId, counterpartId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Coming back from a dispute / cancellation / payout screen — reload so the
  // card for whatever just happened is there.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      load();
    }, [load])
  );

  // Live turn-taking: the other party's move (apply, hire, submit, review,
  // pay, cancel) re-derives the thread immediately.
  useEffect(() => {
    if (!bountyId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(uniqueRealtimeTopic(`bounty-thread:${bountyId}`))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bounties', filter: `id=eq.${bountyId}` }, () => load())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bounty_requests', filter: `bounty_id=eq.${bountyId}` }, () => load())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bounty_cancellations', filter: `bounty_id=eq.${bountyId}` }, () => load())
        .subscribe();
    } catch {
      channel = null; // realtime unavailable — focus reloads still apply
    }
    let unsubSubmission: (() => void) | undefined;
    try {
      unsubSubmission = completionService.subscribeSubmission(bountyId, next => setSubmission(next));
    } catch {
      unsubSubmission = undefined;
    }
    return () => {
      try {
        if (channel) supabase.removeChannel(channel);
      } catch {
        /* best-effort */
      }
      try {
        unsubSubmission?.();
      } catch {
        /* best-effort */
      }
    };
  }, [bountyId, load]);

  const events: BountyThreadEvent[] = useMemo(() => {
    if (!bounty) return [];
    return buildBountyThreadEvents({
      role,
      viewerId,
      bounty: bounty as any,
      request: request
        ? {
            id: String(request.id),
            status: request.status,
            hunter_id: (request as any).hunter_id ?? (request as any).user_id ?? null,
            message: request.message ?? null,
            rejection_source: (request as any).rejection_source ?? null,
            created_at: request.created_at,
            updated_at: request.updated_at ?? null,
            accepted_at: (request as any).accepted_at ?? null,
            rejected_at: (request as any).rejected_at ?? null,
          }
        : null,
      submission: submission
        ? {
            ...(submission as any),
            proof_items: Array.isArray(submission.proof_items) ? submission.proof_items : [],
          }
        : null,
      // cancellationService returns the camelCase domain shape.
      cancellation: cancellation
        ? {
            id: cancellation.id,
            status: cancellation.status,
            requester_type: cancellation.requesterType,
            reason: cancellation.reason ?? null,
            response_message: cancellation.responseMessage ?? null,
            created_at: cancellation.createdAt,
            updated_at: cancellation.resolvedAt ?? cancellation.updatedAt ?? null,
          }
        : null,
      dispute: dispute
        ? {
            id: dispute.id,
            status: dispute.status,
            initiatorId: dispute.initiatorId,
            reason: dispute.reason,
            createdAt: dispute.createdAt,
            resolvedAt: dispute.resolvedAt ?? null,
          }
        : null,
    });
  }, [bounty, request, submission, cancellation, dispute, role, viewerId]);

  const hasActiveDispute = !!dispute && (dispute.status === 'open' || dispute.status === 'under_review');

  return {
    bounty,
    request,
    submission,
    readyAt,
    cancellation,
    dispute,
    hasActiveDispute,
    conversation,
    setConversation,
    counterpart,
    events,
    loading,
    error,
    refresh: load,
  };
}
