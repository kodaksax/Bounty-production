/**
 * Single source of truth for what a bounty *means* to the person looking at it.
 *
 * `getBountyDisplayStatus` (bounty-display-status.ts) already answers "which
 * badge does this card show". That is necessary but not sufficient: every
 * management surface then re-invented, inline and inconsistently, the four
 * things a user actually needs —
 *
 *   1. what is happening,
 *   2. who it is waiting on,
 *   3. what happens next,
 *   4. what I can do about it right now.
 *
 * The poster dashboard had a locally-tracked "stage" with a "Stage Locked"
 * alert, the expandable card had a fixed four-bubble stepper, the hunter flow
 * screens each hardcoded their own copy, and the list cards showed a shouty
 * all-caps badge and nothing else. Two screens showing the same bounty could
 * therefore disagree about whose turn it was.
 *
 * `resolveBountyLifecycle` derives all of it from backend state — the bounty
 * row, the viewer's request row, the latest completion submission, and the
 * dispute/cancellation flags — and never from UI state. Every screen renders
 * the result rather than composing its own sentence, so the poster and the
 * hunter always see two consistent halves of the same story.
 *
 * This module is intentionally pure (no React, no services, no I/O) so the
 * whole lifecycle matrix is unit-testable — see
 * __tests__/unit/utils/bounty-lifecycle.test.ts.
 */
import type { BountyDisplayStatus } from './bounty-display-status';
import { getBountyDisplayStatus } from './bounty-display-status';

/** Who is looking at the bounty. */
export type BountyRole = 'poster' | 'hunter' | 'visitor';

/** Whose move it is. Drives the "waiting on" line and the attention grouping. */
export type BountyWaitingOn = 'you' | 'other' | 'support' | 'nobody';

/**
 * Visual weight of the state. Deliberately semantic rather than a color so the
 * theme (light/dark) decides the actual value at render time.
 */
export type BountyLifecycleTone =
  /** Requires the viewer to do something. */
  | 'action'
  /** Healthy, moving, nothing to do. */
  | 'progress'
  /** Finished well. */
  | 'positive'
  /** Something went wrong or needs care (dispute, deadline, cancellation). */
  | 'warning'
  /** Over, with nothing to celebrate or fix. */
  | 'neutral';

/**
 * Stable action identifiers. The lifecycle decides *which* action is primary;
 * each screen binds the key to its own handler, so this module stays free of
 * navigation and service imports.
 */
export type BountyActionKey =
  | 'review_applications'
  | 'review_submission'
  | 'submit_work'
  | 'message'
  | 'view_bounty'
  | 'view_payout'
  | 'leave_review'
  | 'apply'
  | 'find_bounties'
  | 'repost'
  | 'share'
  | 'edit'
  | 'delete'
  | 'cancel_bounty'
  | 'withdraw_application'
  | 'respond_cancellation'
  | 'open_dispute'
  | 'view_dispute'
  | 'contact_support';

export interface BountyLifecycleAction {
  key: BountyActionKey;
  /** Button copy. Written as an imperative so it reads as the thing that happens. */
  label: string;
  /** MaterialIcons glyph name. */
  icon: string;
  /** `danger` actions are always kept behind progressive disclosure. */
  tone: 'primary' | 'neutral' | 'danger';
}

/** The four stages every bounty moves through, in order. */
export type BountyStageId = 'apply_work' | 'working_progress' | 'review_verify' | 'payout';

export interface BountyStage {
  id: BountyStageId;
  label: string;
  icon: string;
}

/**
 * Stage labels are role-specific on purpose: "Review" means *you review* to a
 * poster and *they review* to a hunter, and a stepper that says the same thing
 * to both is exactly the ambiguity this module exists to remove.
 */
export function getBountyStages(role: BountyRole): BountyStage[] {
  if (role === 'hunter') {
    return [
      { id: 'apply_work', label: 'Applied', icon: 'send' },
      { id: 'working_progress', label: 'Working', icon: 'trending-up' },
      { id: 'review_verify', label: 'In review', icon: 'rate-review' },
      { id: 'payout', label: 'Paid', icon: 'account-balance-wallet' },
    ];
  }
  return [
    { id: 'apply_work', label: 'Posted', icon: 'campaign' },
    { id: 'working_progress', label: 'In progress', icon: 'trending-up' },
    { id: 'review_verify', label: 'Your review', icon: 'rate-review' },
    { id: 'payout', label: 'Paid', icon: 'account-balance-wallet' },
  ];
}

/** Where a bounty belongs when a management list is grouped by urgency. */
export type BountyAttentionGroup = 'attention' | 'active' | 'waiting' | 'past';

export const BOUNTY_ATTENTION_GROUP_LABELS: Record<BountyAttentionGroup, string> = {
  attention: 'Needs your attention',
  active: 'In progress',
  waiting: 'Waiting on them',
  past: 'Past & archived',
};

export interface BountyLifecycleInput {
  bounty: {
    id?: string | number;
    status?: string | null;
    end_date?: string | null;
    amount?: number | null;
    is_for_honor?: boolean | null;
    accepted_by?: string | null;
  };
  role: BountyRole;
  /** The viewer's own application row status, when they are a hunter. */
  requestStatus?: string | null;
  /** Status of the latest completion submission on this bounty. */
  submissionStatus?: string | null;
  /** True when the latest submission belongs to the viewing hunter. */
  submissionIsMine?: boolean;
  /** Number of unreviewed applications (poster side). */
  applicationCount?: number;
  /** An open or under-review dispute exists. */
  hasDispute?: boolean;
  /** A cancellation request is pending a response. */
  hasCancellationRequest?: boolean;
  /**
   * Which role opened the pending cancellation request, when known. The
   * *other* role is the one who must respond — a requester is waiting on the
   * other party, not on themselves. Leave unset when this isn't known yet;
   * the overlay then falls back to "support" rather than guessing.
   */
  cancellationRequestedByRole?: 'poster' | 'hunter' | null;
  /** Display name of the other party, used to make copy concrete. */
  otherPartyName?: string | null;
  /** Settlement state of the escrow, when known. */
  paymentState?: 'held' | 'released' | 'refunded' | null;
}

export interface BountyLifecycleState {
  /** The badge — identical to what every card already shows. */
  status: BountyDisplayStatus;
  /** Sentence-case title: "Awaiting your approval". Never all-caps. */
  headline: string;
  /** One sentence on what is actually happening right now. */
  explanation: string;
  /** One sentence on what happens next. Empty string when nothing follows. */
  nextStep: string;
  waitingOn: BountyWaitingOn;
  /** True when the viewer is blocking progress. Drives badges and grouping. */
  needsAttention: boolean;
  tone: BountyLifecycleTone;
  /** Index into `getBountyStages(role)`. */
  stageIndex: number;
  /** The one unmistakable thing to do. Null when there is genuinely nothing. */
  primaryAction: BountyLifecycleAction | null;
  /** Everything else, meant to live behind progressive disclosure. */
  secondaryActions: BountyLifecycleAction[];
  /** Which list section this belongs in. */
  group: BountyAttentionGroup;
}

const ACTIONS: Record<BountyActionKey, BountyLifecycleAction> = {
  review_applications: {
    key: 'review_applications',
    label: 'Review hunters',
    icon: 'people',
    tone: 'primary',
  },
  review_submission: {
    key: 'review_submission',
    label: 'Review & release payment',
    icon: 'rate-review',
    tone: 'primary',
  },
  submit_work: { key: 'submit_work', label: 'Submit for review', icon: 'task-alt', tone: 'primary' },
  message: { key: 'message', label: 'Send a message', icon: 'chat', tone: 'neutral' },
  view_bounty: { key: 'view_bounty', label: 'View bounty', icon: 'open-in-new', tone: 'neutral' },
  view_payout: {
    key: 'view_payout',
    label: 'View payment',
    icon: 'account-balance-wallet',
    tone: 'primary',
  },
  leave_review: { key: 'leave_review', label: 'Leave a review', icon: 'star', tone: 'primary' },
  apply: { key: 'apply', label: 'Apply for this bounty', icon: 'send', tone: 'primary' },
  find_bounties: { key: 'find_bounties', label: 'Find bounties', icon: 'search', tone: 'primary' },
  // Nothing in the app re-opens a closed bounty in place — this opens the
  // composer for a new one, so the label says so rather than implying the old
  // posting comes back.
  repost: { key: 'repost', label: 'Post a new bounty', icon: 'add-circle-outline', tone: 'primary' },
  share: { key: 'share', label: 'Share bounty', icon: 'share', tone: 'neutral' },
  edit: { key: 'edit', label: 'Edit details', icon: 'edit', tone: 'neutral' },
  delete: { key: 'delete', label: 'Delete posting', icon: 'delete', tone: 'danger' },
  cancel_bounty: { key: 'cancel_bounty', label: 'Cancel bounty', icon: 'cancel', tone: 'danger' },
  withdraw_application: {
    key: 'withdraw_application',
    label: 'Withdraw application',
    icon: 'undo',
    tone: 'danger',
  },
  respond_cancellation: {
    key: 'respond_cancellation',
    label: 'Respond to cancellation',
    icon: 'gavel',
    tone: 'primary',
  },
  open_dispute: { key: 'open_dispute', label: 'Open a dispute', icon: 'report-problem', tone: 'danger' },
  view_dispute: { key: 'view_dispute', label: 'View dispute', icon: 'gavel', tone: 'primary' },
  contact_support: { key: 'contact_support', label: 'Contact support', icon: 'support-agent', tone: 'neutral' },
};

/** Overrides an action's copy without losing its identity. */
function action(key: BountyActionKey, label?: string): BountyLifecycleAction {
  const base = ACTIONS[key];
  return label ? { ...base, label } : base;
}

function partyName(name: string | null | undefined, fallback: string): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function money(amount?: number | null, isForHonor?: boolean | null): string {
  if (isForHonor) return 'no payment (for honor)';
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'the reward';
  return `$${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
}

/**
 * Resolves the complete "what now?" state for one bounty and one viewer.
 *
 * Order matters. Dispute and cancellation are overlays that outrank the normal
 * flow because they freeze it: telling a poster to "review the work" while an
 * admin holds the escrow is worse than saying nothing.
 */
export function resolveBountyLifecycle(input: BountyLifecycleInput): BountyLifecycleState {
  const {
    bounty,
    role,
    requestStatus = null,
    submissionStatus = null,
    submissionIsMine = false,
    applicationCount = 0,
    hasDispute = false,
    hasCancellationRequest = false,
    cancellationRequestedByRole = null,
    otherPartyName = null,
    paymentState = null,
  } = input;

  const isPoster = role === 'poster';
  const submissionPending = submissionStatus === 'pending';
  const revisionRequested = submissionStatus === 'revision_requested';

  const status = getBountyDisplayStatus({
    bounty,
    reviewNeeded: isPoster && bounty.status === 'in_progress' && submissionPending,
    submittedForReview:
      role === 'hunter' && bounty.status === 'in_progress' && submissionPending && submissionIsMine,
    requestStatus: role === 'hunter' ? requestStatus : null,
  });

  const hunter = partyName(otherPartyName, 'the hunter');
  const poster = partyName(otherPartyName, 'the poster');
  const reward = money(bounty.amount, bounty.is_for_honor);

  // ── Overlay: an open dispute freezes everything ──────────────────────────
  if (hasDispute) {
    return finalize({
      status,
      headline: 'Dispute under review',
      explanation:
        'Support is reviewing this bounty. Payment and the completion flow are paused until it is resolved.',
      nextStep: "We'll notify both of you as soon as there's a decision.",
      waitingOn: 'support',
      needsAttention: true,
      tone: 'warning',
      stageIndex: 2,
      primaryAction: action('view_dispute'),
      secondaryActions: [action('message'), action('contact_support')],
    });
  }

  // ── Overlay: a cancellation request is waiting on someone ────────────────
  if (hasCancellationRequest || bounty.status === 'cancellation_requested') {
    // The requester is waiting on the *other* role to respond — never on
    // themselves. When the requester isn't known, don't guess: fall back to
    // "support" rather than telling both the poster and the hunter it's on
    // them, which is what happened when this overlay always said 'you'.
    const respondingRole: 'poster' | 'hunter' | null =
      cancellationRequestedByRole === 'poster'
        ? 'hunter'
        : cancellationRequestedByRole === 'hunter'
          ? 'poster'
          : null;
    const viewerMustRespond = respondingRole !== null && role === respondingRole;

    return finalize({
      status: 'cancellation_requested',
      headline: 'Cancellation requested',
      explanation: isPoster
        ? `A request to cancel this bounty is open. ${reward} stays in escrow until it's settled.`
        : 'A request to cancel this bounty is open. Nothing else can move until it is settled.',
      nextStep: viewerMustRespond
        ? 'Respond to the request, or open a dispute if you disagree.'
        : "We'll let you know as soon as it's settled.",
      waitingOn: viewerMustRespond ? 'you' : respondingRole !== null ? 'other' : 'support',
      needsAttention: viewerMustRespond,
      tone: 'warning',
      stageIndex: 1,
      primaryAction: viewerMustRespond ? action('respond_cancellation') : action('message'),
      secondaryActions: viewerMustRespond
        ? [action('message'), action('open_dispute')]
        : [action('open_dispute')],
    });
  }

  if (role === 'visitor') {
    return resolveVisitor(status, bounty, reward);
  }

  return isPoster
    ? resolvePoster({ status, bounty, applicationCount, hunter, reward, submissionStatus, paymentState, revisionRequested, submissionPending })
    : resolveHunter({ status, bounty, requestStatus, poster, reward, revisionRequested, submissionPending, submissionIsMine, paymentState });
}

function resolveVisitor(
  status: BountyDisplayStatus,
  bounty: BountyLifecycleInput['bounty'],
  reward: string
): BountyLifecycleState {
  switch (status) {
    case 'open':
      return finalize({
        status,
        headline: 'Open for applications',
        explanation: `This bounty is live and paying ${reward}. Nobody has been selected yet.`,
        nextStep: 'Apply, and the poster will pick a hunter from the applications.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'progress',
        stageIndex: 0,
        primaryAction: action('apply'),
        secondaryActions: [action('share')],
      });
    case 'deadline_passed':
      return finalize({
        status,
        headline: 'Deadline passed',
        explanation: 'This bounty is past the deadline the poster set, so it is no longer taking applications.',
        nextStep: 'Browse other bounties nearby.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'neutral',
        stageIndex: 0,
        primaryAction: action('find_bounties'),
        secondaryActions: [],
      });
    case 'in_progress':
      return finalize({
        status,
        headline: 'Already claimed',
        explanation: 'Another hunter is working on this bounty.',
        nextStep: 'Browse other bounties that are still open.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'neutral',
        stageIndex: 1,
        primaryAction: action('find_bounties'),
        secondaryActions: [],
      });
    case 'completed':
      return finalize({
        status,
        headline: 'Completed',
        explanation: 'This bounty was finished and paid out.',
        nextStep: 'Browse other bounties that are still open.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'neutral',
        stageIndex: 3,
        primaryAction: action('find_bounties'),
        secondaryActions: [],
      });
    default:
      return finalize({
        status,
        headline: 'No longer available',
        explanation: 'This bounty is no longer open to new hunters.',
        nextStep: 'Browse other bounties that are still open.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'neutral',
        stageIndex: 0,
        primaryAction: action('find_bounties'),
        secondaryActions: [],
      });
  }
}

function resolvePoster(args: {
  status: BountyDisplayStatus;
  bounty: BountyLifecycleInput['bounty'];
  applicationCount: number;
  hunter: string;
  reward: string;
  submissionStatus: string | null;
  paymentState: BountyLifecycleInput['paymentState'];
  revisionRequested: boolean;
  submissionPending: boolean;
}): BountyLifecycleState {
  const { status, bounty, applicationCount, hunter, reward, paymentState, revisionRequested } = args;
  const hasApplicants = applicationCount > 0;

  switch (status) {
    case 'review_needed':
      return finalize({
        status,
        headline: 'Awaiting your approval',
        explanation: `${hunter} submitted the work for this bounty.`,
        nextStep: `Approve it to release ${reward}, or request changes and send it back.`,
        waitingOn: 'you',
        needsAttention: true,
        tone: 'action',
        stageIndex: 2,
        primaryAction: action('review_submission'),
        secondaryActions: [action('message'), action('open_dispute')],
      });

    case 'open':
      if (hasApplicants) {
        return finalize({
          status,
          headline:
            applicationCount === 1
              ? '1 hunter applied'
              : `${applicationCount} hunters applied`,
          explanation: 'Applications are in and nobody has been selected yet.',
          nextStep: `Pick a hunter to start the work — ${reward} is held in escrow the moment you accept.`,
          waitingOn: 'you',
          needsAttention: true,
          tone: 'action',
          stageIndex: 0,
          primaryAction: action('review_applications'),
          secondaryActions: [action('edit'), action('share'), action('delete')],
        });
      }
      return finalize({
        status,
        headline: 'Live — waiting for hunters',
        explanation: 'Your bounty is visible in the feed. No one has applied yet.',
        nextStep: "You'll be notified the moment a hunter applies.",
        waitingOn: 'other',
        needsAttention: false,
        tone: 'progress',
        stageIndex: 0,
        primaryAction: action('share', 'Share to reach more hunters'),
        secondaryActions: [action('edit'), action('delete')],
      });

    case 'in_progress':
      if (revisionRequested) {
        return finalize({
          status,
          headline: 'Changes requested',
          explanation: `You sent the work back to ${hunter} with feedback.`,
          nextStep: "They'll resubmit, and you'll approve it from here.",
          waitingOn: 'other',
          needsAttention: false,
          tone: 'progress',
          stageIndex: 1,
          primaryAction: action('message', `Message ${hunter}`),
          secondaryActions: [action('cancel_bounty'), action('open_dispute')],
        });
      }
      return finalize({
        status,
        headline: 'Hunter is working on it',
        explanation: `${hunter} accepted this bounty and is working on it now. ${reward} is held in escrow.`,
        nextStep: "When they submit the work you'll review it here and release payment.",
        waitingOn: 'other',
        needsAttention: false,
        tone: 'progress',
        stageIndex: 1,
        primaryAction: action('message', `Message ${hunter}`),
        secondaryActions: [action('cancel_bounty'), action('open_dispute')],
      });

    case 'deadline_passed':
      return finalize({
        status,
        headline: 'Deadline passed',
        explanation: bounty.accepted_by
          ? `The deadline passed and ${hunter} hasn't submitted the work.`
          : 'The deadline you set passed without a hunter being selected.',
        nextStep: bounty.accepted_by
          ? 'Message the hunter, or cancel to get your escrow back.'
          : 'Post it again with a new deadline, or delete it and your funds return to your balance.',
        waitingOn: 'you',
        needsAttention: true,
        tone: 'warning',
        stageIndex: bounty.accepted_by ? 1 : 0,
        primaryAction: bounty.accepted_by
          ? action('message', `Message ${hunter}`)
          : action('repost'),
        secondaryActions: bounty.accepted_by
          ? [action('cancel_bounty'), action('open_dispute')]
          : [action('edit'), action('delete')],
      });

    case 'completed':
      if (paymentState === 'held') {
        return finalize({
          status,
          headline: 'Payment processing',
          explanation: `You approved the work. ${reward} is on its way to ${hunter}.`,
          nextStep: 'This usually settles within a few minutes.',
          waitingOn: 'nobody',
          needsAttention: false,
          tone: 'progress',
          stageIndex: 3,
          primaryAction: action('view_payout'),
          secondaryActions: [action('message')],
        });
      }
      return finalize({
        status,
        headline: 'Completed — payment released',
        explanation: `The work was approved and ${reward} was released to ${hunter}.`,
        nextStep: 'Leave a review so other posters know what to expect.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'positive',
        stageIndex: 3,
        primaryAction: action('leave_review'),
        secondaryActions: [action('view_payout'), action('repost', 'Post another bounty')],
      });

    case 'cancelled':
      return finalize({
        status,
        headline: 'Cancelled',
        explanation: 'This bounty was cancelled. Any escrowed funds were returned to your balance.',
        nextStep: 'You can post it again as a new bounty if you still need it done.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'neutral',
        stageIndex: 0,
        primaryAction: action('repost'),
        secondaryActions: [],
      });

    case 'archived':
      return finalize({
        status,
        headline: 'Archived',
        explanation: 'This posting is archived and no longer visible to hunters.',
        nextStep: 'Post it again as a new bounty to put the job back in front of hunters.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'neutral',
        stageIndex: 0,
        primaryAction: action('repost'),
        secondaryActions: [],
      });

    default:
      return finalize({
        status,
        headline: 'Posted',
        explanation: 'This bounty is in your postings.',
        nextStep: '',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'neutral',
        stageIndex: 0,
        primaryAction: action('view_bounty'),
        secondaryActions: [],
      });
  }
}

function resolveHunter(args: {
  status: BountyDisplayStatus;
  bounty: BountyLifecycleInput['bounty'];
  requestStatus: string | null;
  poster: string;
  reward: string;
  revisionRequested: boolean;
  submissionPending: boolean;
  submissionIsMine: boolean;
  paymentState: BountyLifecycleInput['paymentState'];
}): BountyLifecycleState {
  const { status, bounty, requestStatus, poster, reward, revisionRequested, paymentState } = args;

  // A hunter whose application is still `pending` on a bounty that has already
  // moved on was passed over — the poster accepted someone else and the row was
  // never rejected explicitly. Without this guard the in_progress/completed
  // branches below would tell them they are "on the clock" for work that is not
  // theirs, or that they were paid for a bounty they never worked.
  const isSelected = requestStatus === 'accepted';
  if (!isSelected && (bounty.status === 'in_progress' || bounty.status === 'completed')) {
    return finalize({
      status: 'rejected',
      headline: 'Another hunter was selected',
      explanation: `${poster} chose someone else for this bounty, so your application is closed.`,
      nextStep: 'Nothing is owed either way — there are other bounties open now.',
      waitingOn: 'nobody',
      needsAttention: false,
      tone: 'neutral',
      stageIndex: 0,
      primaryAction: action('find_bounties'),
      secondaryActions: [],
    });
  }

  switch (status) {
    case 'submitted_for_review':
      return finalize({
        status,
        headline: 'Submitted — awaiting approval',
        explanation: `${poster} is reviewing the work you submitted.`,
        nextStep: `${reward} is released to your balance as soon as they approve it.`,
        waitingOn: 'other',
        needsAttention: false,
        tone: 'progress',
        stageIndex: 2,
        primaryAction: action('message', `Message ${poster}`),
        secondaryActions: [action('view_bounty'), action('open_dispute')],
      });

    case 'applied':
      return finalize({
        status,
        headline: 'Application sent',
        explanation: `${poster} hasn't chosen a hunter yet.`,
        nextStep: "If they pick you, this bounty moves to your active work and you can start.",
        waitingOn: 'other',
        needsAttention: false,
        tone: 'progress',
        stageIndex: 0,
        primaryAction: action('message', `Message ${poster}`),
        secondaryActions: [action('view_bounty'), action('withdraw_application')],
      });

    case 'rejected':
      return finalize({
        status,
        headline: 'Not selected',
        explanation: `${poster} went with another hunter for this one.`,
        nextStep: 'Nothing is owed either way — there are other bounties open now.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'neutral',
        stageIndex: 0,
        primaryAction: action('find_bounties'),
        secondaryActions: [],
      });

    case 'in_progress':
      if (revisionRequested) {
        return finalize({
          status,
          headline: 'Changes requested',
          explanation: `${poster} sent the work back with feedback before approving.`,
          nextStep: `Make the changes and resubmit — ${reward} is released once they approve.`,
          waitingOn: 'you',
          needsAttention: true,
          tone: 'action',
          stageIndex: 1,
          primaryAction: action('submit_work', 'Resubmit work'),
          secondaryActions: [action('message', `Message ${poster}`), action('open_dispute')],
        });
      }
      return finalize({
        status,
        headline: "You're on the clock",
        explanation: `You were selected for this bounty. ${reward} is held in escrow while you work.`,
        nextStep: 'Submit proof of the finished work to send it for approval and get paid.',
        waitingOn: 'you',
        needsAttention: true,
        tone: 'action',
        stageIndex: 1,
        primaryAction: action('submit_work'),
        secondaryActions: [action('message', `Message ${poster}`), action('open_dispute')],
      });

    case 'deadline_passed':
      return finalize({
        status,
        headline: 'Deadline passed',
        explanation:
          requestStatus === 'accepted'
            ? 'The deadline on this bounty has passed and the work is not approved yet.'
            : 'This bounty passed its deadline before a hunter was chosen.',
        nextStep:
          requestStatus === 'accepted'
            ? 'Message the poster to agree on a new time, or submit what you have.'
            : 'Nothing further is expected from you here.',
        waitingOn: requestStatus === 'accepted' ? 'you' : 'nobody',
        needsAttention: requestStatus === 'accepted',
        tone: 'warning',
        stageIndex: 1,
        primaryAction:
          requestStatus === 'accepted'
            ? action('message', `Message ${poster}`)
            : action('find_bounties'),
        secondaryActions: requestStatus === 'accepted' ? [action('submit_work')] : [],
      });

    case 'completed':
      if (paymentState === 'held') {
        return finalize({
          status,
          headline: 'Approved — payment on the way',
          explanation: `${poster} approved your work and ${reward} is being released.`,
          nextStep: 'It lands in your Bounty balance, usually within a few minutes.',
          waitingOn: 'nobody',
          needsAttention: false,
          tone: 'progress',
          stageIndex: 3,
          primaryAction: action('view_payout'),
          secondaryActions: [action('leave_review')],
        });
      }
      return finalize({
        status,
        headline: 'Paid',
        explanation: `Your work was approved and ${reward} was added to your balance.`,
        nextStep: 'Withdraw it any time from your wallet.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'positive',
        stageIndex: 3,
        primaryAction: action('view_payout'),
        secondaryActions: [action('leave_review'), action('find_bounties')],
      });

    case 'cancelled':
      return finalize({
        status,
        headline: 'Cancelled',
        explanation: 'The poster cancelled this bounty, so no work is expected.',
        nextStep: 'There are other bounties open right now.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'neutral',
        stageIndex: 0,
        primaryAction: action('find_bounties'),
        secondaryActions: [],
      });

    case 'archived':
      return finalize({
        status,
        headline: 'No longer available',
        explanation: 'This bounty was archived by the poster.',
        nextStep: 'There are other bounties open right now.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'neutral',
        stageIndex: 0,
        primaryAction: action('find_bounties'),
        secondaryActions: [],
      });

    case 'open':
    default:
      // An open bounty the hunter has no pending request on — they withdrew, or
      // are looking at work they never applied to.
      return finalize({
        status,
        headline: 'Open for applications',
        explanation: `This bounty is still open and paying ${reward}.`,
        nextStep: 'Apply to be considered by the poster.',
        waitingOn: 'nobody',
        needsAttention: false,
        tone: 'progress',
        stageIndex: 0,
        primaryAction: action('apply'),
        secondaryActions: [action('view_bounty')],
      });
  }
}

/**
 * Which detail surface a viewer belongs on.
 *
 * The `/bounty/[id]` deep-link router used to send everyone who was neither the
 * poster nor an applicant to the poster's dashboard, which greeted them with an
 * "Access Denied" alert and bounced them backwards — a dead end reachable from
 * any shared link, push notification or search result. There are three real
 * surfaces and this is the only place that decides between them.
 */
export type BountyDetailSurface = 'poster' | 'hunter' | 'public';

export function getBountyDetailSurface(input: {
  isPoster: boolean;
  /** The viewer's own application status on this bounty, if any. */
  requestStatus?: string | null;
  /** True when the bounty's accepted hunter is the viewer. */
  isAcceptedHunter?: boolean;
}): BountyDetailSurface {
  if (input.isPoster) return 'poster';
  // Any application at all — including a rejected one — belongs on the hunter
  // hub, which is the screen that can explain what happened to it.
  if (input.isAcceptedHunter) return 'hunter';
  if (input.requestStatus) return 'hunter';
  return 'public';
}

/** Derives the list grouping from the resolved state so the two can't drift. */
export function getBountyAttentionGroup(
  state: Pick<BountyLifecycleState, 'needsAttention' | 'waitingOn' | 'status'>
): BountyAttentionGroup {
  if (state.needsAttention) return 'attention';
  const terminal: BountyDisplayStatus[] = ['completed', 'cancelled', 'archived', 'rejected'];
  if (terminal.includes(state.status)) return 'past';
  if (state.waitingOn === 'other' || state.waitingOn === 'support') return 'waiting';
  return 'active';
}

/** Short line under the headline: "Waiting on you" / "Waiting on the hunter". */
export function getWaitingOnLabel(
  waitingOn: BountyWaitingOn,
  role: BountyRole,
  otherPartyName?: string | null
): string | null {
  switch (waitingOn) {
    case 'you':
      return 'Waiting on you';
    case 'other':
      return `Waiting on ${partyName(otherPartyName, role === 'poster' ? 'the hunter' : 'the poster')}`;
    case 'support':
      return 'Waiting on Bounty support';
    default:
      return null;
  }
}

function finalize(
  state: Omit<BountyLifecycleState, 'group'>
): BountyLifecycleState {
  return { ...state, group: getBountyAttentionGroup(state) };
}
