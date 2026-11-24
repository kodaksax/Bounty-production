/**
 * The extra records a Focus-first job workspace reads, beside the lifecycle
 * (hooks/useBountyLifecycle): the pair's conversation on this job, the
 * pending offers with their profiles, when the helper was chosen, and the
 * pending cancellation / open dispute details. Every read goes through an
 * existing service; nothing here writes, and a failed read just leaves its
 * block out (the stage copy never depends on it to tell the money truth).
 */
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { parseServerTimestamp } from '../lib/utils/bounty-thread-events';
import { useRefreshOnReturn } from './useRouteFocus';
import { isCoordinationMessage, isHireWelcomeMessage } from '../lib/my-jobs/hire-message';
import type { BountyRequestWithDetails } from '../lib/services/bounty-request-service';
import { bountyRequestService } from '../lib/services/bounty-request-service';
import { messageService } from '../lib/services/message-service';
import { cancellationService } from '../lib/services/cancellation-service';
import { disputeService } from '../lib/services/dispute-service';
import * as supabaseMessaging from '../lib/services/supabase-messaging';
import type { BountyCancellation, BountyDispute, Message } from '../lib/types';
import { sortApplicantsLocalFirst } from '../lib/utils/applicant-distance';

export interface JobConversationState {
  conversationId: string | null;
  /** The other person's most recent readable message. */
  lastFromOther: { text: string; at: string } | null;
  /** When the viewer last wrote, if the other person hasn't answered since. */
  awaitingReplySince: string | null;
  /** When they first wrote after the hire, and who did. */
  firstTalk: { at: string; mine: boolean } | null;
  loaded: boolean;
}

const EMPTY_CONVERSATION: JobConversationState = {
  conversationId: null,
  lastFromOther: null,
  awaitingReplySince: null,
  firstTalk: null,
  loaded: false,
};

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
  /** When the helper was chosen; earlier messages were questions before hiring. */
  since?: string | null;
}): JobConversationState & { reload: () => void } {
  const { viewerId, otherId, bountyId, enabled = true, since = null } = args;
  const [state, setState] = useState<JobConversationState>(EMPTY_CONVERSATION);
  const [attempt, setAttempt] = useState(0);
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!enabled || !viewerId || !otherId || !bountyId) {
      setState({ ...EMPTY_CONVERSATION, loaded: true });
      return;
    }
    // A different job starts over; a reload of the same one keeps its answer.
    const key = `${viewerId}:${otherId}:${bountyId}`;
    if (loadedKeyRef.current !== key) {
      loadedKeyRef.current = key;
      setState(EMPTY_CONVERSATION);
    }
    (async () => {
      try {
        const conversations = await supabaseMessaging.fetchConversations(String(viewerId));
        const pair = conversations.filter((c) => {
          if (c.isGroup) return false;
          const ids = (c.participantIds || []).map(String);
          return ids.includes(String(viewerId)) && ids.includes(String(otherId));
        });
        const conv = pair.find((c) => String(c.bountyId) === String(bountyId)) ?? null;
        if (!conv) {
          if (active) setState({ ...EMPTY_CONVERSATION, loaded: true });
          return;
        }
        const messages: Message[] = await messageService.getMessages(String(conv.id));
        const talk = messages
          .filter((m) => isCoordinationMessage(m, since))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        const readable = messages.filter((m) => !m.isEncrypted && typeof m.text === 'string' && m.text.trim().length > 0 && !isHireWelcomeMessage(m.text));
        const fromOther = readable.filter((m) => String(m.senderId) === String(otherId));
        const mine = readable.filter((m) => String(m.senderId) === String(viewerId) && isCoordinationMessage(m, since));
        const lastMineAt = mine.map((m) => m.createdAt).sort().pop() ?? null;
        // Any reply counts, including one that can't be read here.
        const lastReplyAt = messages.filter((m) => String(m.senderId) === String(otherId)).map((m) => m.createdAt).sort().pop() ?? null;
        const last = fromOther.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).pop() ?? null;
        if (active) {
          setState({
            conversationId: String(conv.id),
            firstTalk: talk ? { at: talk.createdAt, mine: String(talk.senderId) === String(viewerId) } : null,
            awaitingReplySince: lastMineAt && (!lastReplyAt || lastReplyAt < lastMineAt) ? lastMineAt : null,
            lastFromOther: last ? { text: last.text.trim(), at: last.createdAt } : null,
            loaded: true,
          });
        }
      } catch {
        if (active) setState((prev) => ({ ...prev, loaded: true }));
      }
    })();
    return () => {
      active = false;
    };
  }, [viewerId, otherId, bountyId, enabled, attempt, since]);

  const reload = React.useCallback(() => setAttempt((n) => n + 1), []);
  // Messages are written in the thread: look again on the way back.
  useRefreshOnReturn(reload);
  return { ...state, reload };
}

/** Pending offers on an open job, nearest known first (the order Who offered uses). */
export function usePendingApplicants(bountyId: string | null | undefined, enabled: boolean) {
  const [applicants, setApplicants] = useState<BountyRequestWithDetails[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (!enabled || !bountyId) {
      setApplicants([]);
      setLoaded(true);
      setFailed(false);
      return;
    }
    setFailed(false);
    (async () => {
      const all: BountyRequestWithDetails[] = [];
      const pageSize = 50;
      for (let page = 1; ; page++) {
        const rows = await bountyRequestService.getAllWithDetailsBatch(
          [String(bountyId)],
          { status: 'pending', page, pageSize, throwOnError: true }
        );
        all.push(...(rows ?? []).filter((row) => row.status === 'pending'));
        if (!rows || rows.length < pageSize) break;
      }
      return all;
    })()
      .then((rows) => {
        if (!active) return;
        setApplicants(sortApplicantsLocalFirst(rows));
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [bountyId, enabled, attempt]);

  const reload = React.useCallback(() => setAttempt((n) => n + 1), []);
  return { applicants, loaded, failed, reload };
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
        const raw = (mine as any)?.accepted_at ?? (mine as any)?.updated_at ?? null;
        const ms = raw ? parseServerTimestamp(String(raw)) : NaN;
        setAt(Number.isNaN(ms) ? null : new Date(ms).toISOString());
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
