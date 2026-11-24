/**
 * Interactive "action messages" for a bounty thread (My Bounties tab).
 *
 * Each card in a bounty thread — "Application sent", "You're hired", "Work
 * submitted", "Payment released"… — is DERIVED from the backend rows that
 * already record those moments (bounty, bounty_requests, completion_submissions,
 * bounty_cancellations, bounty_disputes). Nothing is written to `messages` to
 * produce them, so:
 *   - both sides always see the same cards, in the same order;
 *   - a card can never claim a state the backend does not have;
 *   - no schema or RPC change was needed to give the inbox its chat-style UI.
 *
 * The cards alternate sides as the parties act (the hunter applies, the poster
 * hires, the hunter submits, the poster pays), which is what makes the thread
 * read as turn-taking.
 */

export type BountyThreadRole = 'hunter' | 'poster';

export type BountyThreadEventKind =
  | 'posted'
  | 'applied'
  | 'application_declined'
  | 'hired'
  | 'work_submitted'
  | 'revision_requested'
  | 'paid'
  | 'cancellation_requested'
  | 'cancellation_resolved'
  | 'cancelled'
  | 'dispute_opened'
  | 'dispute_resolved';

/** The action a card offers its viewer, when it offers one. */
export type BountyThreadAction =
  | 'accept_or_decline' // poster: ✓ / ✗ on an application
  | 'withdraw' // hunter: withdraw a pending application
  | 'dismiss' // hunter: remove a declined application from the list
  | 'submit_work' // hunter: submit work on an active bounty
  | 'resubmit_work' // hunter: resubmit after a revision request
  | 'review_and_pay' // poster: open the review / release flow
  | 'view_payout' // hunter: open the payout receipt
  | 'respond_cancellation' // other party: respond to a cancellation request
  | 'view_cancellation' // requester: check on a cancellation request
  | 'view_dispute'; // either: open the dispute

export interface BountyThreadEvent {
  id: string;
  kind: BountyThreadEventKind;
  /** ISO timestamp; strictly increasing across the lifecycle events. */
  at: string;
  /** Who "sent" the card. 'system' cards render centered. */
  actor: BountyThreadRole | 'system';
  /** The card's action for THIS viewer, or null when it is informational. */
  action: BountyThreadAction | null;
  /** True when the viewer is the one blocking progress ("Your turn"). */
  yourTurn: boolean;
  /** False once a later event has superseded the card. */
  live: boolean;
  /**
   * True when a later card replaced this one's content — "You sent the work"
   * once a change was asked for. Drawn faded (Focus-first M.3). Narrower than
   * `!live`: a card that simply happened earlier is not superseded.
   */
  superseded?: boolean;
  /** Free text carried by the card (pitch, completion note, feedback, reason). */
  note?: string | null;
  /** Kind-specific extras. */
  meta?: Record<string, unknown>;
}

export interface BountyThreadInput {
  role: BountyThreadRole;
  viewerId: string | null;
  bounty: {
    id: string | number;
    status?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    completed_at?: string | null;
    accepted_by?: string | null;
    amount?: number | null;
    is_for_honor?: boolean | null;
  };
  /** The application between this hunter and this bounty, if any. */
  request?: {
    id: string;
    status: string;
    hunter_id?: string | null;
    message?: string | null;
    rejection_source?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    accepted_at?: string | null;
    rejected_at?: string | null;
  } | null;
  /** The latest completion submission for the bounty. */
  submission?: {
    id?: string | null;
    hunter_id?: string | null;
    status: string;
    message?: string | null;
    proof_items?: unknown[] | null;
    poster_feedback?: string | null;
    revision_count?: number | null;
    submitted_at?: string | null;
    updated_at?: string | null;
    reviewed_at?: string | null;
  } | null;
  cancellation?: {
    id: string;
    status: string;
    requester_type: 'poster' | 'hunter';
    reason?: string | null;
    response_message?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  } | null;
  dispute?: {
    id: string;
    status: string;
    initiatorId?: string | null;
    reason?: string | null;
    createdAt?: string | null;
    resolvedAt?: string | null;
  } | null;
}

const ACTIVE_DISPUTE = new Set(['open', 'under_review']);

/**
 * A timestamp with no zone ("2026-11-02T22:19:57.915565") is UTC: it comes
 * from a `timestamp without time zone` column filled by now() on a UTC
 * database (bounty_requests.accepted_at / rejected_at). `new Date()` would
 * read it as the phone's local time instead, putting Hired and every later
 * card hours away from the messages around them.
 */
const ZONELESS_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
export function parseServerTimestamp(value: string): number {
  const v = value.trim();
  return new Date(ZONELESS_TIMESTAMP.test(v) ? `${v.replace(' ', 'T')}Z` : v).getTime();
}

function ts(...candidates: (string | null | undefined)[]): number | null {
  for (const c of candidates) {
    if (!c) continue;
    const n = parseServerTimestamp(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Builds the ordered card list for one bounty thread, as seen by `role`.
 *
 * Timestamps come from the rows themselves, but several are nullable on older
 * data (accepted_at was not written before B-06, completed_at is newer still).
 * Rather than let a missing value sort "Payment released" above "You're hired",
 * each lifecycle card is clamped to land after the one before it.
 */
export function buildBountyThreadEvents(input: BountyThreadInput): BountyThreadEvent[] {
  const { role, bounty, request, submission, cancellation, dispute, viewerId } = input;
  const events: BountyThreadEvent[] = [];
  const status = String(bounty.status ?? '');
  const bountyId = String(bounty.id);

  const hasActiveDispute = !!dispute && ACTIVE_DISPUTE.has(dispute.status);
  // The bounty is assigned to someone other than this thread's hunter (a
  // poster thread is always about its own hunter, so this is hunter-side only).
  const hiredSomeoneElse =
    role === 'hunter' &&
    !!bounty.accepted_by &&
    !!viewerId &&
    String(bounty.accepted_by) !== String(viewerId);
  const isHiredThread =
    !!bounty.accepted_by &&
    (role === 'poster'
      ? !request || String(request.hunter_id ?? bounty.accepted_by) === String(bounty.accepted_by)
      : !hiredSomeoneElse);
  const isWorking = isHiredThread && (status === 'in_progress' || status === 'cancellation_requested');

  let cursor = ts(bounty.created_at) ?? 0;
  const at = (...candidates: (string | null | undefined)[]) => {
    const t = ts(...candidates);
    cursor = t !== null && t > cursor ? t : cursor + 1;
    return new Date(cursor).toISOString();
  };

  const push = (e: Omit<BountyThreadEvent, 'yourTurn'> & { yourTurn?: boolean }) =>
    events.push({ yourTurn: false, ...e });

  // 1. The bounty itself — the context card at the top of every thread.
  push({
    id: `${bountyId}:posted`,
    kind: 'posted',
    at: at(bounty.created_at),
    actor: 'poster',
    action: null,
    live: false,
  });

  // 2. The application.
  if (request) {
    const pending = request.status === 'pending' && status === 'open';
    push({
      id: `${bountyId}:applied:${request.id}`,
      kind: 'applied',
      at: at(request.created_at),
      actor: 'hunter',
      action: pending ? (role === 'poster' ? 'accept_or_decline' : 'withdraw') : null,
      yourTurn: pending && role === 'poster',
      live: pending,
      note: request.message ?? null,
    });

    const passedOver = request.status === 'rejected' || hiredSomeoneElse;
    if (passedOver) {
      const systemClosed = !!request.rejection_source && request.rejection_source.startsWith('system_');
      push({
        id: `${bountyId}:declined:${request.id}`,
        kind: 'application_declined',
        at: at(request.rejected_at, request.updated_at),
        actor: systemClosed ? 'system' : 'poster',
        action: role === 'hunter' ? 'dismiss' : null,
        live: true,
        meta: { systemClosed, hiredSomeoneElse },
      });
    }
  }

  // Everything below belongs to the hired hunter's thread only.
  if (!isHiredThread) return events;

  // 3. Hired.
  const hasPendingSubmission = submission?.status === 'pending';
  const hasRevision = submission?.status === 'revision_requested';
  const hiredLive = isWorking && !hasPendingSubmission && !hasRevision;
  push({
    id: `${bountyId}:hired`,
    kind: 'hired',
    at: at(request?.accepted_at, request?.status === 'accepted' ? request?.updated_at : null),
    actor: 'poster',
    action: hiredLive && role === 'hunter' && !hasActiveDispute ? 'submit_work' : null,
    yourTurn: hiredLive && role === 'hunter' && !hasActiveDispute,
    live: hiredLive,
  });

  // 4. Work submitted (latest submission) and any revision request on it.
  if (submission && submission.status !== 'rejected') {
    const proofCount = Array.isArray(submission.proof_items) ? submission.proof_items.length : 0;
    const awaitingReview = hasPendingSubmission && isWorking;
    push({
      id: `${bountyId}:submitted:${submission.id ?? 'latest'}`,
      kind: 'work_submitted',
      at: at(submission.submitted_at),
      actor: 'hunter',
      action: awaitingReview && role === 'poster' && !hasActiveDispute ? 'review_and_pay' : null,
      yourTurn: awaitingReview && role === 'poster' && !hasActiveDispute,
      live: awaitingReview,
      note: submission.message ?? null,
      meta: { proofCount, revisionCount: submission.revision_count ?? 0 },
      superseded: hasRevision,
    });

    if (hasRevision) {
      push({
        id: `${bountyId}:revision:${submission.id ?? 'latest'}`,
        kind: 'revision_requested',
        at: at(submission.reviewed_at, submission.updated_at),
        actor: 'poster',
        action: isWorking && role === 'hunter' && !hasActiveDispute ? 'resubmit_work' : null,
        yourTurn: isWorking && role === 'hunter' && !hasActiveDispute,
        live: isWorking,
        note: submission.poster_feedback ?? null,
      });
    }
  }

  // 5. Cancellation request and its outcome.
  if (cancellation) {
    const pending = cancellation.status === 'pending';
    const requester = cancellation.requester_type;
    const viewerIsRequester = requester === role;
    push({
      id: `${bountyId}:cancel-req:${cancellation.id}`,
      kind: 'cancellation_requested',
      at: at(cancellation.created_at),
      actor: requester,
      action: pending ? (viewerIsRequester ? 'view_cancellation' : 'respond_cancellation') : null,
      yourTurn: pending && !viewerIsRequester,
      live: pending,
      note: cancellation.reason ?? null,
    });
    if (!pending) {
      push({
        id: `${bountyId}:cancel-res:${cancellation.id}`,
        kind: 'cancellation_resolved',
        at: at(cancellation.updated_at),
        actor: requester === 'hunter' ? 'poster' : 'hunter',
        action: null,
        live: false,
        note: cancellation.response_message ?? null,
        meta: { outcome: cancellation.status },
      });
    }
  }

  // 6. Dispute.
  if (dispute) {
    const initiatorIsViewer = !!viewerId && String(dispute.initiatorId) === String(viewerId);
    const initiatorRole: BountyThreadRole = initiatorIsViewer ? role : role === 'poster' ? 'hunter' : 'poster';
    push({
      id: `${bountyId}:dispute:${dispute.id}`,
      kind: 'dispute_opened',
      at: at(dispute.createdAt),
      actor: initiatorRole,
      action: 'view_dispute',
      live: hasActiveDispute,
      note: dispute.reason ?? null,
    });
    if (!hasActiveDispute && dispute.resolvedAt) {
      push({
        id: `${bountyId}:dispute-res:${dispute.id}`,
        kind: 'dispute_resolved',
        at: at(dispute.resolvedAt),
        actor: 'system',
        action: 'view_dispute',
        live: false,
        meta: { outcome: dispute.status },
      });
    }
  }

  // 7. Terminal states.
  if (status === 'completed' || (status === 'archived' && !!bounty.completed_at)) {
    push({
      id: `${bountyId}:paid`,
      kind: 'paid',
      at: at(bounty.completed_at, submission?.reviewed_at, submission?.updated_at, bounty.updated_at),
      actor: 'poster',
      action: role === 'hunter' && !bounty.is_for_honor ? 'view_payout' : null,
      live: true,
      meta: { amount: bounty.amount ?? 0, isForHonor: !!bounty.is_for_honor },
    });
  } else if (status === 'cancelled') {
    push({
      id: `${bountyId}:cancelled`,
      kind: 'cancelled',
      at: at(bounty.updated_at),
      actor: 'system',
      action: null,
      live: true,
    });
  }

  return events;
}

/** True when any card in the thread is waiting on the viewer. */
export function threadNeedsViewer(events: BountyThreadEvent[]): boolean {
  return events.some(e => e.yourTurn);
}

// ── The pinned "next step" card (Focus-first M.1–M.3, H.6) ────────────────

/** Actions the thread pins above the message box. Accept/decline keeps its two buttons on the card. */
const PINNABLE: ReadonlySet<BountyThreadAction> = new Set(['submit_work', 'resubmit_work', 'review_and_pay', 'respond_cancellation']);

export interface PinnedThreadCard {
  event: BountyThreadEvent;
  /** The viewer acts (YOUR NEXT STEP, with a button) or waits (WAITING FOR …, no button). */
  mode: 'your_turn' | 'waiting';
}

/**
 * The one card pinned above the message box: the viewer's own next step when
 * there is one, otherwise the latest live card that is waiting on the other
 * person. Null when nothing is open (or when the only step is accepting or
 * passing on an application, which keeps its buttons on the card).
 */
export function selectPinnedThreadCard(events: readonly BountyThreadEvent[], role: BountyThreadRole): PinnedThreadCard | null {
  if (events.some((e) => e.kind === 'dispute_opened' && e.live)) return null;

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== 'cancellation_requested' || !e.live) continue;
    return { event: e, mode: e.yourTurn ? 'your_turn' : 'waiting' };
  }

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.yourTurn && e.action && PINNABLE.has(e.action)) return { event: e, mode: 'your_turn' };
  }
  // DESIGN-GAP: an application waiting on the poster keeps its own Accept / Pass
  // buttons on its card (existing, tested behaviour) and is not pinned.
  if (events.some((e) => e.yourTurn && e.action === 'accept_or_decline')) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e.live || e.yourTurn) continue;
    const waits =
      (e.kind === 'work_submitted' && role === 'hunter') ||
      (e.kind === 'applied' && role === 'hunter') ||
      (e.kind === 'hired' && role === 'poster') ||
      (e.kind === 'revision_requested' && role === 'poster') ||
      (e.kind === 'cancellation_requested' && e.action === 'view_cancellation');
    if (waits) return { event: e, mode: 'waiting' };
  }
  return null;
}

export interface PinnedCardCopy {
  label: string;
  title: string;
  text: string | null;
  /** Only when it is the viewer's turn. */
  button: string | null;
}

/**
 * The pinned card's words, in the handoff's copy with live names and money.
 * `amount` is the reward ("$80"), `takeHome` the hunter's net ("$76"), both
 * null for a for-honor job, which then has no money sentence.
 */
export function describePinnedCard(
  pinned: PinnedThreadCard,
  role: BountyThreadRole,
  otherName: string,
  money: { amount: string | null; takeHome: string | null }
): PinnedCardCopy {
  const named = !!otherName.trim();
  const other = named ? otherName.trim() : role === 'poster' ? 'your helper' : 'the poster';
  // At the start of a sentence. Only the fallback is capitalised: a username is shown as written.
  const Other = named ? other : other.charAt(0).toUpperCase() + other.slice(1);
  const OTHER = other.toUpperCase();
  const { amount, takeHome } = money;
  const e = pinned.event;
  if (pinned.mode === 'your_turn') {
    switch (e.action) {
      case 'review_and_pay':
        return { label: 'YOUR NEXT STEP', title: 'Check the work, then decide about payment', text: null, button: 'Review the completed work' };
      case 'resubmit_work':
        return {
          label: 'YOUR NEXT STEP',
          title: 'Make the change, then send the work again',
          text: amount ? `${amount} is still held. Nothing is paid until ${other} approves.` : null,
          button: 'Send updated work',
        };
      case 'respond_cancellation':
        return { label: 'YOUR NEXT STEP', title: `${Other} asked to cancel`, text: null, button: 'Respond to the request' };
      case 'submit_work':
      default:
        return {
          label: 'YOUR NEXT STEP',
          // DESIGN-GAP: the handoff's "When the TV is up" is job-specific; "the job" stands in.
          title: `When the job is done, tell ${other} it's done`,
          text: null,
          button: `Tell ${other} it's done`,
        };
    }
  }
  switch (e.kind) {
    case 'work_submitted':
      return {
        label: `WAITING FOR ${OTHER}`,
        title: `${Other} is checking your work`,
        text: amount && takeHome ? `${amount} is still held. You get ${takeHome} when ${other} approves.` : null,
        button: null,
      };
    case 'applied':
      return { label: `WAITING FOR ${OTHER}`, title: `${Other} hasn't chosen yet`, text: amount ? 'Nothing is held yet.' : null, button: null };
    case 'hired':
      return {
        label: `WAITING FOR ${OTHER}`,
        title: `${Other} is working on it`,
        text: amount ? `Your ${amount} is held by Bounty. Nobody is paid until you approve.` : null,
        button: null,
      };
    case 'revision_requested':
      return { label: `WAITING FOR ${OTHER}`, title: `${Other} is making the change you asked for`, text: null, button: null };
    default:
      return { label: `WAITING FOR ${OTHER}`, title: `${Other} is looking at your request`, text: null, button: null };
  }
}
