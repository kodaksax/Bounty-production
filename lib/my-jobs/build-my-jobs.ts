/**
 * Turns the records My Jobs loads into the jobs and offers it shows.
 *
 * Pure: the lifecycle resolver and the latest submission are passed in as
 * lookups, so every state the tab can show is covered by
 * __tests__/unit/my-jobs/build-my-jobs.test.ts without React or a network.
 *
 * Copy follows the design's four questions — what's happening, what it means,
 * what's next, and the money truth — and never says "paid" before the poster
 * approves. Where a state has no hand-written copy, the shared lifecycle
 * resolver's headline and explanation are used, so the tab never disagrees
 * with the job's own screen.
 */
import { calculateHunterEarnings } from '../constants/fees';
import type { BountyRequestWithDetails } from '../services/bounty-request-service';
import type { CompletionSubmission } from '../services/completion-service';
import type { Bounty } from '../services/database.types';
import type { Conversation } from '../types';
import type { BountyLifecycleState } from '../utils/bounty-lifecycle';
import { sortJobs } from './featured-job';
import {
  firstName,
  formatJobAmount,
  formatJobDay,
  getBountyCategoryIcon,
  getBountyCoverUri,
  peopleWant,
} from './format';
import { isHireWelcomeMessage } from '../messaging/hire-welcome';
import { FOCUS_POLICY } from '../constants/focus-policy';
import { resolveHiredPhase, sinceDay, type HiredPhaseResult } from '../utils/hired-phase';
import type { JobRank, JobSide, JobStatusLine, JobTarget, MyJob, MyJobsModel, MyOffer } from './types';
import { JOB_RANK } from './types';

export interface BuildMyJobsInput {
  viewerId: string;
  /** Bounties the viewer posted, already filtered for management (no archived/deleted). */
  postedBounties: readonly Bounty[];
  /** The viewer's own applications, with their bounty attached. */
  hunterRequests: readonly BountyRequestWithDetails[];
  /** Pending applications on the viewer's open bounties, keyed by bounty id. */
  pendingApplicationsByBounty: ReadonlyMap<string, readonly BountyRequestWithDetails[]>;
  conversations: readonly Conversation[];
  /** Bounty ids the viewer removed from their own list as a hunter. */
  hiddenBountyIds?: ReadonlySet<string>;
  getLifecycle: (bounty: Bounty, variant: 'owner' | 'hunter') => BountyLifecycleState;
  getSubmission: (bountyId: string) => CompletionSubmission | null | undefined;
  /** When the helper was chosen on a job the viewer posted (the accepted offer's accepted_at). */
  getHireTime?: (bountyId: string) => string | null | undefined;
  now?: Date;
}

/** The accepted offer's accepted_at (on the row, not on the declared type). */
function acceptedAtOf(request: BountyRequestWithDetails): string | null {
  return (request as { accepted_at?: string | null }).accepted_at ?? null;
}

/**
 * Hired, nothing sent yet: hired / working / silent, by the same rule as the
 * job pages (lib/utils/hired-phase.ts), from when the helper last sent a
 * message themselves in ANY conversation the pair shares: a direct message
 * can land in an older job's thread (rpc_get_or_create_dm_conversation reuses
 * the pair's existing conversation), and Chat shows them all as one. The hire
 * time bounds it, so a message before the hire never counts as work.
 *
 * Null (unknown, so no job is called quiet) when the hire time is missing, or
 * when the conversation list doesn't carry the person-message columns
 * (get_conversation_summaries' fallback path).
 */
export function hiredPhaseFromThread(
  threads: readonly Conversation[],
  helperIs: 'other' | 'me',
  hiredAt: string | null | undefined,
  now: Date
): HiredPhaseResult | null {
  if (threads.length === 0 || !hiredAt) return null;
  const values = threads.map((t) => (helperIs === 'other' ? t.otherLastMessageAt : t.myLastMessageAt));
  if (values.every((v) => v === undefined)) return null;
  return resolveHiredPhase({
    hiredAt,
    helperLastMessageAt: latest(...values),
    thresholdHours: FOCUS_POLICY.silenceThresholdHours,
    now,
  });
}

const PAST_STATUSES = new Set(['completed', 'cancelled', 'archived', 'deleted']);

function pairConversations(
  conversations: readonly Conversation[],
  viewerId: string,
  counterpartId: string | null
): Conversation[] {
  if (!counterpartId) return [];
  return conversations.filter((c) => {
    if (c.isGroup) return false;
    const parts = (c.participantIds || []).map(String);
    return parts.includes(String(viewerId)) && parts.includes(String(counterpartId));
  });
}

function conversationName(conv: Conversation | null | undefined): string | null {
  const name = conv?.name?.trim();
  return name && name !== 'Unknown' ? name : null;
}

/**
 * The other person on a job: this job's own thread (the only source of its
 * unread count and coordination state — another job's conversation with the
 * same person must never mark this one as needing a reply), plus their name,
 * which any conversation with them can supply, and every conversation the
 * two share (for the hired / working / silent phase only).
 */
function findCounterpart(
  conversations: readonly Conversation[],
  viewerId: string,
  counterpartId: string | null,
  bountyId: string
): { thread: Conversation | null; pair: Conversation[]; name: string | null } {
  const pair = pairConversations(conversations, viewerId, counterpartId);
  const thread = pair.find((c) => String(c.bountyId) === bountyId) ?? null;
  return { thread, pair, name: conversationName(thread) ?? pair.map((c) => conversationName(c)).find(Boolean) ?? null };
}

/**
 * True once the two people have actually written to each other on this job.
 * The automatic "You've been selected" message opens the thread but isn't
 * coordination, so it doesn't count.
 */
function hasCoordinated(thread: Conversation | null): boolean {
  return !!thread?.lastMessage && !isHireWelcomeMessage(thread.lastMessage);
}

/**
 * Where a lifecycle action goes. "Send a message" must open the conversation
 * it names; everything else is handled on the job's own screen.
 */
function lifecycleCta(lifecycle: BountyLifecycleState, workspace: JobTarget, thread: JobTarget) {
  const action = lifecycle.primaryAction;
  if (!action) return { label: 'Open the job', target: workspace };
  return { label: action.label, target: action.key === 'message' ? thread : workspace };
}

/**
 * When a missed deadline became a problem. `end_date` is the job's deadline;
 * `deadline` is the time-sensitive variant.
 */
function deadlineAt(bounty: Bounty): string | null {
  return (bounty as Bounty & { end_date?: string | null }).end_date ?? bounty.deadline ?? updatedAt(bounty);
}

/**
 * When the bounty row last changed. `updated_at` is selected with the row but
 * isn't on the shared Bounty type, so it is read defensively.
 */
function updatedAt(bounty: Bounty): string | null {
  const value = (bounty as Bounty & { updated_at?: string | null }).updated_at;
  return value || bounty.created_at || null;
}

function latest(...isos: (string | null | undefined)[]): string | null {
  return isos.filter((v): v is string => !!v).sort().pop() ?? null;
}

function earliest(...isos: (string | null | undefined)[]): string | null {
  return isos.filter((v): v is string => !!v).sort()[0] ?? null;
}

function imageCount(submission: CompletionSubmission | null | undefined): number {
  return (submission?.proof_items ?? []).filter((p) => p?.type === 'image').length;
}

function sentAPhrase(submission: CompletionSubmission | null | undefined): string {
  const photos = imageCount(submission);
  if (photos === 0) return 'sent a note';
  return `sent a note and ${photos === 1 ? '1 photo' : `${photos} photos`}`;
}

function quote(text: string | null | undefined): string | null {
  const t = text?.trim();
  return t ? `“${t}”` : null;
}

function join(...parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(' · ');
}

function sentence(...parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** The problem overlay — a dispute (support is on it) or a cancellation request. */
function problemStatus(lifecycle: BountyLifecycleState): JobStatusLine | null {
  if (lifecycle.status === 'cancellation_requested') {
    return { icon: 'gavel', text: lifecycle.headline, tone: 'warning' };
  }
  if (lifecycle.waitingOn === 'support') {
    return { icon: 'support-agent', text: 'Bounty is looking into it', tone: 'warning' };
  }
  return null;
}

interface JobDraft {
  rank: JobRank;
  status: JobStatusLine;
  detail: string | null;
  cta: { label: string; target: JobTarget };
  attentionSince: string | null;
}

/** Overlays an unread message on a job whose own state is less urgent than a message. */
function withUnread(
  draft: JobDraft,
  conv: Conversation | null,
  name: string | null,
  side: JobSide,
  bountyId: string,
  withId: string | null
): JobDraft {
  if (!conv || (conv.unread ?? 0) <= 0 || draft.rank <= JOB_RANK.newMessage) return draft;
  const who = name ?? 'Someone';
  return {
    rank: JOB_RANK.newMessage,
    status: { icon: 'chat-bubble-outline', text: `${who} sent you a message`, tone: 'action' },
    detail: quote(conv.lastMessage) ?? draft.detail,
    cta: { label: name ? `Reply to ${name}` : 'Reply', target: { kind: 'thread', side, bountyId, withId } },
    attentionSince: conv.updatedAt ?? draft.attentionSince,
  };
}

// ── Jobs the viewer posted ────────────────────────────────────────────────

function buildPostedJob(bounty: Bounty, input: BuildMyJobsInput): MyJob {
  const now = input.now ?? new Date();
  const bountyId = String(bounty.id);
  const lifecycle = input.getLifecycle(bounty, 'owner');
  const offers = bounty.status === 'open' ? input.pendingApplicationsByBounty.get(bountyId) ?? [] : [];
  const helperId = bounty.accepted_by ? String(bounty.accepted_by) : null;
  const { thread: conv, pair, name: helperFull } = findCounterpart(input.conversations, input.viewerId, helperId, bountyId);
  const helper = firstName(helperFull);
  const helperLabel = helper ?? 'Your helper';
  const amount = formatJobAmount(bounty.amount, bounty.is_for_honor);
  const honor = !!bounty.is_for_honor;
  const submission = input.getSubmission(bountyId);
  // Hired, working toward a submission: hired / working / silent (null when unknown).
  const helperPhase =
    bounty.status === 'in_progress' && submission?.status !== 'revision_requested'
      ? hiredPhaseFromThread(pair, 'other', input.getHireTime?.(bountyId), now)
      : null;
  const workspace: JobTarget = { kind: 'workspace', side: 'posted', bountyId };
  const thread: JobTarget = { kind: 'thread', side: 'posted', bountyId, withId: helperId };
  const finished = PAST_STATUSES.has(String(bounty.status)) || lifecycle.group === 'past';
  const heldLine = honor ? null : `Your ${amount} is with Bounty. Nobody is paid until you approve.`;
  // The money truth depends on when this job is funded: at_accept jobs are
  // paid when the poster chooses someone, at_post jobs when they were posted.
  // An unknown mode claims neither, so it can never deny a real payment.
  const fundedAtAccept = !honor && bounty.funding_mode === 'at_accept';
  const fundedAtPost = !honor && bounty.funding_mode === 'at_post';
  const payWhenChoosing = fundedAtAccept
    ? 'You only pay when you choose.'
    : fundedAtPost
      ? `Your ${amount} is already held by Bounty.`
      : null;

  let draft: JobDraft;
  const problem = problemStatus(lifecycle);
  if (problem) {
    draft = {
      rank: JOB_RANK.problem,
      status: problem,
      detail: sentence(lifecycle.explanation, lifecycle.nextStep),
      cta: lifecycleCta(lifecycle, workspace, thread),
      attentionSince: updatedAt(bounty),
    };
  } else if (lifecycle.paying) {
    // Approved; the job row hasn't read back finished yet. Never "working".
    draft = {
      rank: JOB_RANK.waiting,
      status: {
        icon: 'payments',
        text: honor ? `You approved ${helper ? `${helper}'s` : 'the'} work` : `Paying ${helper ?? 'your helper'}`,
        tone: 'progress',
      },
      detail: honor
        ? 'It was for honor, so no money moves.'
        : `You approved the work. Bounty is sending your ${amount} to ${helper ?? 'your helper'}.`,
      cta: { label: 'See the job', target: workspace },
      attentionSince: updatedAt(bounty),
    };
  } else if (lifecycle.status === 'deadline_passed') {
    // Before offers and hired work: a missed deadline changes what to do
    // (extend, repost or report), so the ordinary copy would mislead.
    draft = {
      rank: JOB_RANK.waitingOnYou,
      status: { icon: 'schedule', text: lifecycle.headline, tone: 'warning' },
      detail: sentence(lifecycle.explanation, lifecycle.nextStep),
      cta: lifecycleCta(lifecycle, workspace, thread),
      attentionSince: deadlineAt(bounty),
    };
  } else if (lifecycle.status === 'review_needed') {
    draft = {
      rank: JOB_RANK.waitingOnYou,
      status: { icon: 'task-alt', text: `${helperLabel} says the job is done`, tone: 'action' },
      detail: sentence(
        `${helper ?? 'They'} ${sentAPhrase(submission)}.`,
        'Check the work, then decide about payment.'
      ),
      cta: { label: 'Review the completed work', target: workspace },
      attentionSince: submission?.submitted_at ?? updatedAt(bounty),
    };
  } else if (offers.length > 0) {
    const count = offers.length;
    draft = {
      rank: JOB_RANK.newOffers,
      status: { icon: 'groups', text: `${peopleWant(count)} to help`, tone: 'action' },
      detail: sentence('See who they are, then choose one person.', payWhenChoosing),
      cta: {
        label: count === 1 ? 'Review the offer' : `Review the ${count} people`,
        // F.1 → C: the workspace, then one person at a time (D).
        target: workspace,
      },
      attentionSince: earliest(...offers.map((o) => o.created_at)),
    };
  } else if (finished) {
    // `positive` = released; `progress` = approved, release still settling.
    const released = lifecycle.status === 'completed' && lifecycle.tone === 'positive';
    draft = {
      rank: JOB_RANK.finished,
      status:
        lifecycle.status === 'completed'
          ? {
              icon: 'check-circle',
              text: released && !honor ? `Released to ${helper ?? 'your helper'}` : lifecycle.headline,
              tone: 'positive',
            }
          : { icon: 'cancel', text: lifecycle.headline, tone: 'neutral' },
      detail: lifecycle.explanation,
      cta: { label: 'See the summary', target: workspace },
      attentionSince: updatedAt(bounty),
    };
  } else if (helperPhase?.phase === 'silent') {
    // E2E-04: quiet past the threshold. Featured: it needs the poster.
    const silent = helperPhase;
    const day = sinceDay(silent.silentSince, now);
    draft = {
      rank: JOB_RANK.waitingOnYou,
      status: {
        icon: 'hourglass-empty',
        text: day ? `You haven't heard from ${helper ?? 'your helper'} since ${day}` : `You haven't heard from ${helper ?? 'your helper'}`,
        tone: 'warning',
      },
      detail: sentence(`People are sometimes just busy. Message ${helper ?? 'them'}, or tell us and we'll help.`, heldLine),
      cta: { label: helper ? `Message ${helper}` : 'Message your helper', target: thread },
      attentionSince: silent.silentSince ?? updatedAt(bounty),
    };
  } else if (helperPhase?.phase === 'hired') {
    // E2E-05: just chosen, not a word yet: agree a day and time.
    draft = {
      rank: JOB_RANK.waiting,
      status: { icon: 'handshake', text: `${helperLabel} is your helper`, tone: 'progress' },
      detail: sentence(`Agree a day and time with ${helper ?? 'them'}.`, heldLine),
      cta: { label: helper ? `Message ${helper}` : 'Message your helper', target: thread },
      attentionSince: updatedAt(bounty),
    };
  } else if (bounty.status === 'in_progress') {
    const changeAsked = submission?.status === 'revision_requested';
    draft = {
      rank: JOB_RANK.waiting,
      status: changeAsked
        ? { icon: 'edit-note', text: `You asked ${helper ?? 'your helper'} for a change`, tone: 'progress' }
        : { icon: 'construction', text: `${helperLabel} is working on it`, tone: 'progress' },
      detail: sentence(
        changeAsked
          ? `${helper ?? 'They'} will send the work again when it's done.`
          : `${helper ?? 'They'}'ll let you know when it's done. You don't need to do anything until then.`,
        heldLine
      ),
      cta: { label: helper ? `Message ${helper}` : 'Message your helper', target: thread },
      attentionSince: updatedAt(bounty),
    };
  } else if (lifecycle.needsAttention) {
    draft = {
      rank: JOB_RANK.waitingOnYou,
      status: { icon: 'schedule', text: lifecycle.headline, tone: 'warning' },
      detail: sentence(lifecycle.explanation, lifecycle.nextStep),
      cta: lifecycleCta(lifecycle, workspace, thread),
      attentionSince: updatedAt(bounty),
    };
  } else {
    draft = {
      rank: JOB_RANK.waiting,
      status: { icon: 'hourglass-empty', text: 'Waiting for offers', tone: 'progress' },
      detail: sentence(
        "People nearby can see it now. We'll tell you as soon as someone offers.",
        fundedAtAccept ? "You haven't paid anything yet." : null
      ),
      cta: { label: 'Open the job', target: workspace },
      attentionSince: bounty.created_at,
    };
  }

  if (!finished) draft = withUnread(draft, conv, helper, 'posted', bountyId, helperId);

  const posted = formatJobDay(bounty.created_at, now);
  const newestOffer = formatJobDay(latest(...offers.map((o) => o.created_at)), now);
  return {
    key: `posted:${bountyId}`,
    bountyId,
    side: 'posted',
    bounty,
    lifecycle,
    rank: draft.rank,
    needsYou: draft.rank <= JOB_RANK.newMessage && !finished,
    finished,
    title: bounty.title,
    contextLine: helperId && !finished
      ? join(helper ? `${helper} is your helper` : 'You chose a helper', amount)
      : join(posted ? `Posted ${posted}` : null, amount),
    status: draft.status,
    detail: draft.detail,
    historyLine: offers.length > 0 && newestOffer ? join(posted && `Posted ${posted}`, `newest offer ${newestOffer}`) : null,
    cta: draft.cta,
    counterpartName: helperFull,
    unread: conv?.unread ?? 0,
    coverUri: getBountyCoverUri(bounty.attachments_json),
    icon: getBountyCategoryIcon(bounty.category),
    attentionSince: draft.attentionSince,
    pendingOfferCount: offers.length,
  };
}

// ── Work the viewer is doing ─────────────────────────────────────────────

function buildDoingJob(request: BountyRequestWithDetails, input: BuildMyJobsInput): MyJob {
  const now = input.now ?? new Date();
  const bounty = request.bounty;
  const bountyId = String(bounty.id);
  const lifecycle = input.getLifecycle(bounty, 'hunter');
  const posterId = String(bounty.poster_id || bounty.user_id || '') || null;
  const { thread: conv, pair, name: threadName } = findCounterpart(input.conversations, input.viewerId, posterId, bountyId);
  const posterFull = bounty.username?.trim() || threadName;
  const poster = firstName(posterFull);
  const posterLabel = poster ?? 'The poster';
  const honor = !!bounty.is_for_honor;
  const amount = formatJobAmount(bounty.amount, honor);
  const takeHome = formatJobAmount(calculateHunterEarnings(bounty.amount).net);
  const submission = input.getSubmission(bountyId);
  // Chosen, nothing sent yet: hired / working / silent from this helper's own messages.
  const myPhase = hiredPhaseFromThread(pair, 'me', acceptedAtOf(request), now);
  const workspace: JobTarget = { kind: 'workspace', side: 'doing', bountyId };
  const thread: JobTarget = { kind: 'thread', side: 'doing', bountyId };
  const finished = PAST_STATUSES.has(String(bounty.status)) || lifecycle.group === 'past';
  const possessive = poster ? `${poster}'s` : 'The';
  const approves = poster ? `${poster} approves` : 'they approve';
  const heldLine = honor
    ? null
    : `${possessive} ${amount} is held by Bounty. You get ${takeHome} after ${approves} your work.`;

  let draft: JobDraft;
  const problem = problemStatus(lifecycle);
  if (problem) {
    draft = {
      rank: JOB_RANK.problem,
      status: problem,
      detail: sentence(lifecycle.explanation, lifecycle.nextStep),
      cta: lifecycleCta(lifecycle, workspace, thread),
      attentionSince: updatedAt(bounty),
    };
  } else if (finished) {
    // `positive` = paid to the balance; `progress` = approved, still settling.
    const paid = lifecycle.status === 'completed' && lifecycle.tone === 'positive';
    draft = {
      rank: JOB_RANK.finished,
      status:
        lifecycle.status === 'completed'
          ? { icon: 'task-alt', text: paid && !honor ? `You earned ${takeHome}` : lifecycle.headline, tone: 'positive' }
          : { icon: 'cancel', text: lifecycle.headline, tone: 'neutral' },
      // The resolver describes the gross reward; a paid hunter's balance got
      // the take-home, which is what the status line says too.
      detail: paid && !honor ? `Your work was approved and ${takeHome} was added to your balance.` : lifecycle.explanation,
      cta: { label: lifecycle.status === 'completed' && !honor ? 'See the payment' : 'See the summary', target: workspace },
      attentionSince: updatedAt(bounty),
    };
  } else if (lifecycle.paying) {
    // The poster approved; the job row hasn't read back finished yet.
    draft = {
      rank: JOB_RANK.waiting,
      status: { icon: 'payments', text: `${posterLabel} approved your work`, tone: 'progress' },
      detail: honor ? 'It was for honor, so no money moves.' : `Your ${takeHome} is on its way.`,
      cta: { label: 'See the job', target: workspace },
      attentionSince: updatedAt(bounty),
    };
  } else if (submission?.status === 'revision_requested') {
    draft = {
      rank: JOB_RANK.waitingOnYou,
      status: { icon: 'edit-note', text: `${posterLabel} asked for a change`, tone: 'action' },
      detail: sentence(
        quote(submission.poster_feedback) ?? 'Make the change, then send the work again.',
        honor ? null : `${amount} is still held. Nothing is paid until ${approves}.`
      ),
      cta: { label: 'Send updated work', target: workspace },
      attentionSince: updatedAt(bounty),
    };
  } else if (lifecycle.status === 'deadline_passed') {
    draft = {
      rank: JOB_RANK.waitingOnYou,
      status: { icon: 'schedule', text: lifecycle.headline, tone: 'warning' },
      detail: sentence(lifecycle.explanation, lifecycle.nextStep),
      cta: lifecycleCta(lifecycle, workspace, thread),
      attentionSince: deadlineAt(bounty),
    };
  } else if (lifecycle.status === 'submitted_for_review') {
    draft = {
      rank: JOB_RANK.waiting,
      status: { icon: 'hourglass-empty', text: `${posterLabel} is checking your work`, tone: 'progress' },
      detail: honor
        ? `${poster ?? 'They'} will approve it or ask for a change.`
        : `Not paid yet. ${possessive} ${amount} is still held by Bounty. You get ${takeHome} when ${approves}.`,
      cta: { label: poster ? `Message ${poster}` : 'Message the poster', target: thread },
      attentionSince: submission?.submitted_at ?? updatedAt(bounty),
    };
  } else if (myPhase?.phase === 'silent') {
    // E2E-04: the poster hasn't heard from this helper past the threshold.
    const silent = myPhase;
    const day = sinceDay(silent.silentSince, now);
    draft = {
      rank: JOB_RANK.waitingOnYou,
      status: {
        icon: 'hourglass-empty',
        text: day ? `${posterLabel} hasn't heard from you since ${day}` : `${posterLabel} hasn't heard from you`,
        tone: 'warning',
      },
      detail: sentence(`Send ${poster ?? 'them'} a message to say how the job is going.`, heldLine),
      cta: { label: poster ? `Message ${poster}` : 'Message the poster', target: thread },
      attentionSince: silent.silentSince ?? request.updated_at ?? updatedAt(bounty),
    };
  } else if (myPhase ? myPhase.phase === 'hired' : !hasCoordinated(conv)) {
    // Chosen, and nothing said yet: agreeing a time comes first. (On the
    // fallback conversation list, "nothing said" is the older last-message test.)
    draft = {
      rank: JOB_RANK.waitingOnYou,
      status: { icon: 'handshake', text: `${posterLabel} chose you`, tone: 'action' },
      detail: sentence(
        `Agree a time with ${poster ?? 'them'}.`,
        honor ? null : `${possessive} ${amount} is already held by Bounty.`
      ),
      cta: { label: 'Agree a time', target: thread },
      attentionSince: request.updated_at ?? updatedAt(bounty),
    };
  } else {
    draft = {
      rank: JOB_RANK.working,
      status: { icon: 'construction', text: "You're doing this job", tone: 'progress' },
      detail: sentence(
        `When it's done, tell ${poster ?? 'them'} and send a photo or two.`,
        heldLine
      ),
      cta: { label: poster ? `Tell ${poster} it's done` : "Tell them it's done", target: workspace },
      attentionSince: request.updated_at ?? updatedAt(bounty),
    };
  }

  if (!finished) draft = withUnread(draft, conv, poster, 'doing', bountyId, null);

  const offered = formatJobDay(request.created_at, now);
  const chosen = formatJobDay(request.updated_at, now);
  return {
    key: `doing:${bountyId}`,
    bountyId,
    side: 'doing',
    bounty,
    lifecycle,
    rank: draft.rank,
    needsYou: draft.rank <= JOB_RANK.newMessage && !finished,
    finished,
    title: bounty.title,
    contextLine: join(posterFull, honor ? 'for honor' : `you get ${takeHome}`),
    status: draft.status,
    detail: draft.detail,
    historyLine: offered ? join(`You offered ${offered}`, chosen && `chosen ${chosen}`) : null,
    cta: draft.cta,
    counterpartName: posterFull,
    unread: conv?.unread ?? 0,
    coverUri: getBountyCoverUri(bounty.attachments_json),
    icon: getBountyCategoryIcon(bounty.category),
    attentionSince: draft.attentionSince,
    pendingOfferCount: 0,
  };
}

// ── Offers the viewer sent ────────────────────────────────────────────────

function buildOffer(request: BountyRequestWithDetails, lifecycle: BountyLifecycleState, input: BuildMyJobsInput): MyOffer {
  const now = input.now ?? new Date();
  const bounty = request.bounty;
  const posterFull = bounty.username?.trim() || null;
  const poster = firstName(posterFull);
  const sent = formatJobDay(request.created_at, now);
  const base = {
    key: `offer:${request.id ?? bounty.id}`,
    bountyId: String(bounty.id),
    bounty,
    request,
    title: bounty.title,
    posterName: posterFull,
    amountLabel: formatJobAmount(bounty.amount, bounty.is_for_honor),
    icon: getBountyCategoryIcon(bounty.category),
    coverUri: getBountyCoverUri(bounty.attachments_json),
  };

  if (lifecycle.status === 'applied') {
    return {
      ...base,
      status: 'waiting',
      statusText: `${poster ?? 'The poster'} hasn't chosen yet`,
      statusIcon: 'hourglass-empty',
      detail: sentence('Nothing is held.', lifecycle.timingNote ?? null),
      subtitle: join(posterFull, sent && `sent ${sent}`),
    };
  }
  const expired =
    request.rejection_source === 'system_expiry' || request.rejection_source === 'system_poster_absent';
  const someoneElseChosen =
    !!bounty.accepted_by && String(bounty.accepted_by) !== String(input.viewerId);
  return {
    ...base,
    status: 'not_going_ahead',
    statusText: expired
      ? 'Closed: no answer in time'
      : someoneElseChosen
        ? `${poster ?? 'The poster'} chose someone else`
        : request.status === 'rejected' && request.rejection_source === 'poster'
          ? `${poster ?? 'The poster'} didn't go ahead with your offer`
          : bounty.status === 'cancelled'
          ? 'This job was cancelled'
          : 'This job closed',
    statusIcon: expired ? 'schedule' : 'block',
    detail: null,
    subtitle: posterFull ?? '',
  };
}

function chosenOffer(job: MyJob): MyOffer {
  const request = { bounty: job.bounty } as BountyRequestWithDetails;
  const poster = firstName(job.counterpartName);
  return {
    key: `offer:chosen:${job.bountyId}`,
    bountyId: job.bountyId,
    bounty: job.bounty,
    request,
    status: 'chosen',
    title: job.title,
    posterName: job.counterpartName,
    amountLabel: formatJobAmount(job.bounty.amount, job.bounty.is_for_honor),
    statusText: `${poster ?? 'The poster'} chose you`,
    statusIcon: 'check-circle',
    detail: null,
    subtitle: job.counterpartName ?? '',
    icon: job.icon,
    coverUri: job.coverUri,
  };
}

/**
 * Every job and offer, jobs sorted by featured priority.
 *
 * A request becomes a job the viewer is doing only when they are the chosen
 * hunter (`accepted_by`); a pending application stays an offer, and anything
 * that didn't go ahead lists under "Not going ahead". Offers never compete for
 * the featured slot — they sit behind one "Your offers" row.
 */
export function buildMyJobs(input: BuildMyJobsInput): MyJobsModel {
  const hidden = input.hiddenBountyIds ?? new Set<string>();
  const jobs: MyJob[] = input.postedBounties.map((b) => buildPostedJob(b, input));
  const offers: MyOffer[] = [];
  const postedIds = new Set(jobs.map((j) => j.bountyId));
  const seen = new Set<string>();

  for (const request of input.hunterRequests) {
    const bounty = request?.bounty;
    if (!bounty) continue;
    const bountyId = String(bounty.id);
    // One entry per bounty, never the viewer's own posting, never a hidden one.
    if (seen.has(bountyId) || postedIds.has(bountyId) || hidden.has(bountyId)) continue;
    seen.add(bountyId);

    const isChosen = !!bounty.accepted_by && String(bounty.accepted_by) === String(input.viewerId);
    if (isChosen && request.status === 'accepted') {
      jobs.push(buildDoingJob(request, input));
      continue;
    }
    offers.push(buildOffer(request, input.getLifecycle(bounty, 'hunter'), input));
  }

  const sorted = sortJobs(jobs);
  // Live work also lists under "Chosen" in Your offers, so a hunter can find
  // an offer that turned into a job from the same place they sent it.
  const chosen = sorted.filter((j) => j.side === 'doing' && !j.finished).map(chosenOffer);
  return { jobs: sorted, offers: [...offers, ...chosen] };
}

/** Offers grouped as the "Your offers" list shows them. */
export function groupOffers(offers: readonly MyOffer[]): Record<MyOffer['status'], MyOffer[]> {
  return {
    waiting: offers.filter((o) => o.status === 'waiting'),
    chosen: offers.filter((o) => o.status === 'chosen'),
    not_going_ahead: offers.filter((o) => o.status === 'not_going_ahead'),
  };
}
