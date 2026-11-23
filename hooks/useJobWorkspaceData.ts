/**
 * The extra records a Focus-first job workspace reads, beside the lifecycle
 * (hooks/useBountyLifecycle): the pair's conversation on this job, the
 * pending offers with their profiles, when the helper was chosen, and the
 * pending cancellation / open dispute details. Every read goes through an
 * existing service; nothing here writes, and a failed read just leaves its
 * block out (the stage copy never depends on it to tell the money truth).
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
import type { BountyRequestWithDetails } from '../lib/services/bounty-request-service';
import { bountyRequestService } from '../lib/services/bounty-request-service';
import { cancellationService } from '../lib/services/cancellation-service';
import { disputeService } from '../lib/services/dispute-service';
import * as supabaseMessaging from '../lib/services/supabase-messaging';
import type { BountyCancellation, BountyDispute, Message } from '../lib/types';
import { sortApplicantsLocalFirst } from '../lib/utils/applicant-distance';

export interface JobConversationState {
  conversationId: string | null;
  /** The two of them have exchanged at least one message on this job. */
  hasMessages: boolean;
  /** The other person's most recent readable message. */
  lastFromOther: { text: string; at: string } | null;
  loaded: boolean;
}

const EMPTY_CONVERSATION: JobConversationState = { conversationId: null, hasMessages: false, lastFromOther: null, loaded: false };

/**
 * The viewer's 1:1 conversation with `otherId`, preferring this job's own
 * thread (the same match My Jobs uses). Reads only: it never creates a
 * conversation. Encrypted message bodies are skipped rather than shown.
 */
export function useJobConversation(args: {
  viewerId: string | null | undefined;
  otherId: string | null | undefined;
  bountyId: string | null | undefined;
  enabled?: boolean;
}): JobConversationState & { reload: () => void } {
  const { viewerId, otherId, bountyId, enabled = true } = args;
  const [state, setState] = useState<JobConversationState>(EMPTY_CONVERSATION);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (!enabled || !viewerId || !otherId || !bountyId) {
      setState({ ...EMPTY_CONVERSATION, loaded: true });
      return;
    }
    (async () => {
      try {
        const conversations = await supabaseMessaging.fetchConversations(String(viewerId));
        const pair = conversations.filter((c) => {
          if (c.isGroup) return false;
          const ids = (c.participantIds || []).map(String);
          return ids.includes(String(viewerId)) && ids.includes(String(otherId));
        });
        const conv = pair.find((c) => String(c.bountyId) === String(bountyId)) ?? pair[0] ?? null;
        if (!conv) {
          if (active) setState({ ...EMPTY_CONVERSATION, loaded: true });
          return;
        }
        const messages: Message[] = await supabaseMessaging.fetchMessages(String(conv.id));
        const readable = messages.filter((m) => !m.isEncrypted && typeof m.text === 'string' && m.text.trim().length > 0);
        const fromOther = readable.filter((m) => String(m.senderId) === String(otherId));
        const last = fromOther.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).pop() ?? null;
        if (active) {
          setState({
            conversationId: String(conv.id),
            hasMessages: messages.length > 0,
            lastFromOther: last ? { text: last.text.trim(), at: last.createdAt } : null,
            loaded: true,
          });
        }
      } catch {
        if (active) setState({ ...EMPTY_CONVERSATION, loaded: true });
      }
    })();
    return () => {
      active = false;
    };
  }, [viewerId, otherId, bountyId, enabled, attempt]);

  const reload = React.useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}

/** Pending offers on an open job, nearest known first (the order Who offered uses). */
export function usePendingApplicants(bountyId: string | null | undefined, enabled: boolean) {
  const [applicants, setApplicants] = useState<BountyRequestWithDetails[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (!enabled || !bountyId) {
      setApplicants([]);
      setLoaded(true);
      return;
    }
    bountyRequestService
      .getAllWithDetailsBatch([String(bountyId)], { status: 'pending', page: 1, pageSize: 50 })
      .then((rows) => {
        if (!active) return;
        setApplicants(sortApplicantsLocalFirst((rows ?? []).filter((r) => r.status === 'pending')));
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setApplicants([]);
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [bountyId, enabled, attempt]);

  const reload = React.useCallback(() => setAttempt((n) => n + 1), []);
  return { applicants, loaded, reload };
}

/** When the helper was chosen: the accepted request's accepted_at (or its last update). */
export function useHireTime(bountyId: string | null | undefined, hunterId: string | null | undefined): string | null {
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!bountyId || !hunterId) {
      setAt(null);
      return;
    }
    bountyRequestService
      .getAll({ bountyId: String(bountyId), status: 'accepted' })
      .then((rows) => {
        if (!active) return;
        const mine = (rows ?? []).find((r: any) => String(r.hunter_id ?? r.user_id) === String(hunterId));
        setAt((mine as any)?.accepted_at ?? (mine as any)?.updated_at ?? null);
      })
      .catch(() => active && setAt(null));
    return () => {
      active = false;
    };
  }, [bountyId, hunterId]);
  return at;
}

/** The pending cancellation request and the open dispute, when the lifecycle says there is one. */
export function useJobProblemRecords(
  bountyId: string | null | undefined,
  flags: { cancellation: boolean; dispute: boolean }
): { cancellation: BountyCancellation | null; dispute: BountyDispute | null } {
  const [cancellation, setCancellation] = useState<BountyCancellation | null>(null);
  const [dispute, setDispute] = useState<BountyDispute | null>(null);

  useEffect(() => {
    let active = true;
    if (!bountyId || !flags.cancellation) {
      setCancellation(null);
    } else {
      cancellationService
        .getCancellationByBountyId(bountyId)
        .then((c) => active && setCancellation(c && c.status === 'pending' ? c : null))
        .catch(() => active && setCancellation(null));
    }
    return () => {
      active = false;
    };
  }, [bountyId, flags.cancellation]);

  useEffect(() => {
    let active = true;
    if (!bountyId || !flags.dispute) {
      setDispute(null);
    } else {
      disputeService
        .getDisputeByBountyId(String(bountyId))
        .then((d) => active && setDispute(d ?? null))
        .catch(() => active && setDispute(null));
    }
    return () => {
      active = false;
    };
  }, [bountyId, flags.dispute]);

  return { cancellation, dispute };
}
