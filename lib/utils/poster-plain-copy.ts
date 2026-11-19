/**
 * What the poster reads on their job page, in plain words.
 *
 * resolveBountyLifecycle (lib/utils/bounty-lifecycle.ts) still decides the
 * state; its copy is shared with the hunter side and every list card, so it
 * keeps its marketplace vocabulary. This module only rewrites the poster's
 * job page so someone who has never used a marketplace app can follow it:
 *
 *   - no "hunter", "bounty", "escrow", "payout" or "applicant"
 *   - every state says who acts next
 *   - every paid state carries one money sentence, and that sentence comes
 *     from the money state the page actually verified (PosterMoneyState),
 *     never from the job's status alone
 *
 * Nothing here moves money or reads anything; it is pure so it can be tested
 * state by state.
 */
import type { BountyDisplayStatus } from './bounty-display-status';
import { bountyHoldsUnreleasedEscrow } from './payment-architecture';

/**
 * Where the poster's money is, as far as the page has verified it.
 *
 *   none          for-honor or $0 job: no money involved
 *   checking      the server read is in flight
 *   unknown       the server read failed; claim nothing
 *   not_charged   open, nobody chosen, and the server says nothing was taken
 *   held          taken and held by Bounty, not yet released
 *   releasing     approved; the release is still settling
 *   released      released to the person who did the job
 *   cancelled     the job was cancelled
 */
export type PosterMoneyState =
  | 'none'
  | 'checking'
  | 'unknown'
  | 'not_charged'
  | 'held'
  | 'releasing'
  | 'released'
  | 'cancelled';

/** Whether a still-open, unchosen job has charged the poster, per the server. */
export type OpenJobChargeState = 'held' | 'not_charged' | 'checking' | 'unknown';

/**
 * Where the poster's money is, from what the job page verified:
 *   - open and nobody chosen: the server's funding read (openJobCharge)
 *   - after that: the job's own escrow state (bountyHoldsUnreleasedEscrow,
 *     which reads the payment row's status for Stripe-native jobs). A hire
 *     on a pay-when-you-choose job is one server transaction with the charge,
 *     so a chosen, unfinished paid job is held.
 */
export function derivePosterMoney(args: {
  bounty: {
    is_for_honor?: boolean | null;
    amount?: number | null;
    status?: string | null;
    payment_architecture_version?: number | null;
    payment_status?: string | null;
    settlement_state?: string | null;
  };
  openJobCharge: OpenJobChargeState | null;
}): PosterMoneyState {
  const { bounty, openJobCharge } = args;
  if (bounty.is_for_honor || !(Number(bounty.amount) > 0)) return 'none';
  if (bounty.status === 'cancelled') return 'cancelled';
  if (openJobCharge) return openJobCharge;
  if (bounty.status === 'archived' || bounty.status === 'deleted') return 'none';
  const held = bountyHoldsUnreleasedEscrow(bounty);
  if (bounty.status === 'completed') return held ? 'releasing' : 'released';
  return held ? 'held' : 'unknown';
}

export type PosterActionKey =
  | 'choose'
  | 'share'
  | 'message'
  | 'check_work'
  | 'see_report'
  | 'answer_cancellation'
  | 'report_unresponsive'
  | 'rate'
  | 'post_again'
  | 'payment_details'
  | 'retry_payment_check';

export type PosterWhoActs = 'you' | 'helper' | 'bounty' | 'nobody' | 'done';

export interface PosterNextStep {
  whoActs: PosterWhoActs;
  /** Short words for the pill: "Your move", "Waiting on Ada". */
  whoActsLabel: string;
  title: string;
  body: string;
  primary: { key: PosterActionKey; label: string } | null;
  secondary: { key: PosterActionKey; label: string } | null;
  /** One sentence about money. Null only when no money is involved. */
  money: string | null;
}

export interface PosterNextStepInput {
  status: BountyDisplayStatus;
  hasDispute: boolean;
  hasCancellationRequest: boolean;
  /** The other side asked to cancel and the poster must answer. */
  posterMustAnswerCancellation: boolean;
  /** Pending offers on an open job. */
  offerCount: number;
  /** The chosen person's display name, once someone is chosen. */
  helperName: string | null;
  hired: boolean;
  amount: number;
  isForHonor: boolean;
  money: PosterMoneyState;
  /** ISO time the review window closes while work waits on the poster. */
  reviewDeadline?: string | null;
  /** When the poster chose the helper (bounty_requests.accepted_at). */
  hiredAt?: string | null;
  /** Latest message from the helper, when known. */
  lastHelperMessageAt?: string | null;
  /** True when the message read succeeded (so null really means "none"). */
  messagesKnown?: boolean;
  /** The poster already rated the person for this job (finished jobs only). */
  alreadyRated?: boolean;
  now?: Date;
}

/** Hours after hiring with no word from the helper before we say so. */
export const QUIET_HELPER_HOURS = 48;

export function formatDollars(amount: number): string {
  if (!Number.isFinite(amount)) return 'the payment';
  return '$' + (Number.isInteger(amount) ? String(amount) : amount.toFixed(2));
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago". */
export function formatAgo(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.floor((now.getTime() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** "Monday, November 17". */
export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/**
 * True when the poster chose someone at least QUIET_HELPER_HOURS ago and that
 * person has not sent a single message about the job since. Needs a known
 * hire time and a successful message read: an unknown is never "quiet".
 */
export function isHelperQuiet(input: {
  hired: boolean;
  hiredAt?: string | null;
  lastHelperMessageAt?: string | null;
  messagesKnown?: boolean;
  now?: Date;
}): boolean {
  if (!input.hired || !input.messagesKnown || !input.hiredAt) return false;
  const hiredAt = new Date(input.hiredAt).getTime();
  if (Number.isNaN(hiredAt)) return false;
  const now = (input.now ?? new Date()).getTime();
  if (now - hiredAt < QUIET_HELPER_HOURS * 3600_000) return false;
  if (!input.lastHelperMessageAt) return true;
  const last = new Date(input.lastHelperMessageAt).getTime();
  // A message from before the hire (e.g. a question while they were only
  // offering) doesn't count as being in touch about the job.
  return Number.isNaN(last) || last < hiredAt;
}

/** The single money sentence for this state. */
export function describePosterMoney(input: {
  money: PosterMoneyState;
  amount: number;
  helperName: string | null;
  status: BountyDisplayStatus;
  hired: boolean;
  hasDispute: boolean;
  hasCancellationRequest: boolean;
  offerCount: number;
}): string | null {
  const { money, amount, helperName, status, hired, hasDispute, hasCancellationRequest, offerCount } = input;
  const amt = formatDollars(amount);
  const name = helperName || 'the person you chose';
  switch (money) {
    case 'none':
      return null;
    case 'checking':
      return 'Checking your payment…';
    case 'unknown':
      return "We couldn't check your payment just now. Tap Check again.";
    case 'not_charged':
      return offerCount > 0
        ? "You haven't paid anything yet. When you choose someone, you'll see the exact amount before you pay."
        : "You haven't paid anything yet. You only pay when you choose someone.";
    case 'held':
      if (hasDispute) return `Bounty is holding your ${amt} while we look into this. Nobody is paid in the meantime.`;
      if (hasCancellationRequest) return `Bounty is holding your ${amt} until the cancellation is settled.`;
      if (status === 'review_needed')
        return `Nothing is paid until you approve. Approving sends your ${amt} to ${name}, and that can't be undone.`;
      if (hired) return `Bounty is holding your ${amt}. ${helperName ? helperName : 'The person you chose'} is paid only after you approve the work.`;
      return `You've already paid ${amt}. Bounty holds it until you approve the finished work.`;
    case 'releasing':
      return `You approved the work. Your ${amt} is on its way to ${name}.`;
    case 'released':
      return `Your ${amt} was released to ${name}.`;
    case 'cancelled':
      return 'Money held for a cancelled job is returned. Your Wallet shows where it went.';
    default:
      return null;
  }
}


export function posterNextStep(input: PosterNextStepInput): PosterNextStep {
  const now = input.now ?? new Date();
  const name = input.helperName?.trim() || null;
  const them = name ?? 'them';
  const Them = name ?? 'The person you chose';
  const money = describePosterMoney({
    money: input.money,
    amount: input.amount,
    helperName: name,
    status: input.status,
    hired: input.hired,
    hasDispute: input.hasDispute,
    hasCancellationRequest: input.hasCancellationRequest,
    offerCount: input.offerCount,
  });
  const messageAction = name ? { key: 'message' as const, label: `Message ${name}` } : null;

  if (input.hasDispute) {
    return {
      whoActs: 'bounty',
      whoActsLabel: 'Bounty is looking into it',
      title: "We're looking into the problem you reported",
      body: "Our support team is reviewing this job. We'll message you here and by email when there's a decision.",
      primary: { key: 'see_report', label: 'See your report' },
      secondary: messageAction,
      money,
    };
  }

  if (input.hasCancellationRequest || input.status === 'cancellation_requested') {
    return input.posterMustAnswerCancellation
      ? {
          whoActs: 'you',
          whoActsLabel: 'Your move',
          title: `${Them} asked to cancel this job`,
          body: 'Tell us whether you agree. If you disagree, you can report a problem instead.',
          primary: { key: 'answer_cancellation', label: 'Answer the request' },
          secondary: messageAction,
          money,
        }
      : {
          whoActs: 'nobody',
          whoActsLabel: 'Waiting',
          title: 'A request to cancel this job is open',
          body: "We'll let you know as soon as it's settled.",
          primary: messageAction,
          secondary: null,
          money,
        };
  }

  switch (input.status) {
    case 'open': {
      if (input.offerCount > 0) {
        const n = input.offerCount;
        return {
          whoActs: 'you',
          whoActsLabel: 'Your move',
          title: n === 1 ? 'Someone offered to help' : `${n} people offered to help`,
          body:
            n === 1
              ? 'See who they are, then choose them or wait for more offers.'
              : "See who they are and choose one. We'll tell the others you chose someone else.",
          primary: { key: 'choose', label: n === 1 ? 'See who offered' : `Compare the ${n} offers` },
          secondary: null,
          money,
        };
      }
      return {
        whoActs: 'nobody',
        whoActsLabel: 'Nothing to do right now',
        title: 'Your job is live',
        body: "People nearby can see it now. We'll send you a notification as soon as someone offers to help.",
        primary: null,
        secondary: { key: 'share', label: 'Share your job' },
        money,
      };
    }

    case 'in_progress': {
      if (
        isHelperQuiet({
          hired: input.hired,
          hiredAt: input.hiredAt,
          lastHelperMessageAt: input.lastHelperMessageAt,
          messagesKnown: input.messagesKnown,
          now,
        })
      ) {
        const ago = formatAgo(input.hiredAt, now);
        return {
          whoActs: 'you',
          whoActsLabel: 'Your move',
          title: `Haven't heard from ${them}?`,
          body: `You chose ${them} ${ago ?? 'a while ago'} and they haven't sent a message yet. Send them a message, or tell us and we'll contact them for you.`,
          primary: messageAction,
          secondary: { key: 'report_unresponsive', label: `Tell us ${them} hasn't replied` },
          money,
        };
      }
      return {
        whoActs: 'helper',
        whoActsLabel: name ? `Waiting on ${name}` : 'Waiting',
        title: `${Them} is doing the job`,
        body: `Message ${them} to agree a day and time. When they say it's finished, you'll check it here before anyone is paid.`,
        primary: messageAction,
        secondary: null,
        money,
      };
    }

    case 'review_needed': {
      const by = formatDay(input.reviewDeadline);
      return {
        whoActs: 'you',
        whoActsLabel: 'Your move',
        title: `${Them} says the job is done`,
        body:
          "Check the work. If you're happy, approve it. If something isn't finished, ask them to finish it." +
          (by ? ` If you haven't answered by ${by}, Bounty support will look at it for you.` : ''),
        primary: { key: 'check_work', label: 'Check the work' },
        secondary: messageAction,
        money,
      };
    }

    case 'deadline_passed':
      return input.hired
        ? {
            whoActs: 'you',
            whoActsLabel: 'Your move',
            title: 'The finish date has passed',
            body: `Message ${them} to check in. If they haven't turned up, tell us and we'll sort it out.`,
            primary: messageAction,
            secondary: { key: 'report_unresponsive', label: `Tell us ${them} didn't turn up` },
            money,
          }
        : {
            whoActs: 'you',
            whoActsLabel: 'Your move',
            title: 'Nobody was chosen in time',
            body: 'The date you set has passed. You can post the job again with a new date.',
            primary: { key: 'post_again', label: 'Post it again' },
            secondary: null,
            money,
          };

    case 'completed':
      if (input.money === 'releasing') {
        return {
          whoActs: 'nobody',
          whoActsLabel: 'Nothing to do right now',
          title: name ? `Paying ${name}` : 'Payment on its way',
          body: "You approved the job. The payment usually goes through within a few minutes. You don't need to do anything.",
          primary: null,
          secondary: { key: 'payment_details', label: 'See payment details' },
          money,
        };
      }
      if (input.alreadyRated) {
        return {
          whoActs: 'done',
          whoActsLabel: 'All done',
          title: input.isForHonor || input.amount <= 0 ? 'Job finished' : 'Job finished and paid',
          body: 'Thank you for leaving a review. If you need something else done, you can post another job.',
          primary: null,
          secondary: { key: 'post_again', label: 'Post another job' },
          money,
        };
      }
      return {
        whoActs: 'done',
        whoActsLabel: 'All done',
        title: input.isForHonor || input.amount <= 0 ? 'Job finished' : 'Job finished and paid',
        body: 'Let other people know how it went. It takes a few seconds.',
        primary: { key: 'rate', label: name ? `Leave a review for ${name}` : 'Leave a review' },
        secondary: { key: 'post_again', label: 'Post another job' },
        money,
      };

    case 'cancelled':
      return {
        whoActs: 'done',
        whoActsLabel: 'Closed',
        title: 'This job was cancelled',
        body: 'If you still need it done, you can post it again.',
        primary: { key: 'post_again', label: 'Post it again' },
        secondary: null,
        money,
      };

    default:
      return {
        whoActs: 'done',
        whoActsLabel: 'Closed',
        title: 'This job is closed',
        body: 'If you still need it done, you can post it again.',
        primary: { key: 'post_again', label: 'Post it again' },
        secondary: null,
        money: null,
      };
  }
}

// ── Timeline ───────────────────────────────────────────────────────────────

export interface PosterTimelineEvent {
  key: string;
  label: string;
  /** ISO time, when known. Events without a reliable time show none. */
  at: string | null;
}

export interface PosterTimelineInput {
  postedAt: string | null | undefined;
  /** Offers made on the job (any status), oldest first. Null when unknown. */
  offers: { createdAt: string }[] | null;
  hired: boolean;
  helperName: string | null;
  hiredAt: string | null;
  fundingMode: string | null | undefined;
  amount: number;
  isForHonor: boolean;
  money: PosterMoneyState;
  submission: { status: string; submitted_at?: string | null; reviewed_at?: string | null } | null;
  hasDispute: boolean;
  status: BountyDisplayStatus;
}

/**
 * Past events only, oldest first. Every entry corresponds to a row that
 * exists (or a status the server set); nothing is inferred from "it should
 * have happened by now".
 */
export function buildPosterTimeline(input: PosterTimelineInput): PosterTimelineEvent[] {
  const events: PosterTimelineEvent[] = [];
  const name = input.helperName?.trim() || 'someone';
  const paid = !input.isForHonor && input.amount > 0;
  const amt = formatDollars(input.amount);

  events.push({ key: 'posted', label: 'You posted the job', at: input.postedAt ?? null });

  // At-post jobs are paid when posted (the reservation runs on insert).
  if (paid && input.fundingMode !== 'at_accept' && ['held', 'releasing', 'released'].includes(input.money)) {
    events.push({ key: 'paid', label: `You paid ${amt}. Bounty is holding it`, at: input.postedAt ?? null });
  }

  if (input.offers && input.offers.length > 0) {
    const n = input.offers.length;
    events.push({
      key: 'offers',
      label: n === 1 ? '1 person offered to help' : `${n} people offered to help`,
      at: input.offers[0].createdAt,
    });
  }

  if (input.hired) {
    events.push({ key: 'chosen', label: `You chose ${name}`, at: input.hiredAt });
    // Pay-when-you-choose: the acceptance and the charge are one server
    // transaction, so a confirmed hire on a held job is a confirmed payment.
    if (paid && input.fundingMode === 'at_accept' && ['held', 'releasing', 'released'].includes(input.money)) {
      events.push({ key: 'paid', label: `You paid ${amt}. Bounty is holding it`, at: input.hiredAt });
    }
  }

  const sub = input.submission;
  if (sub && sub.submitted_at) {
    events.push({ key: 'submitted', label: `${input.helperName?.trim() || 'The person you chose'} said the job is done`, at: sub.submitted_at });
    if (sub.status === 'revision_requested') {
      events.push({ key: 'changes', label: `You asked ${name} to finish something`, at: sub.reviewed_at ?? null });
    }
    if (sub.status === 'approved') {
      events.push({ key: 'approved', label: 'You approved the work', at: sub.reviewed_at ?? null });
    }
  }

  if (input.hasDispute) {
    events.push({ key: 'reported', label: 'You reported a problem', at: null });
  }

  if (paid && input.money === 'released') {
    events.push({ key: 'released', label: `Your ${amt} was released to ${name}`, at: null });
  }

  if (input.status === 'cancelled') {
    events.push({ key: 'cancelled', label: 'The job was cancelled', at: null });
  }

  return events;
}

/** Plain words for the next thing that will happen, shown greyed under the timeline. */
export function describeUpcoming(step: PosterNextStep, status: BountyDisplayStatus, hired: boolean): string | null {
  if (step.whoActs === 'done') return null;
  switch (status) {
    case 'open':
      return hired ? null : 'Next: you choose someone to do the job';
    case 'in_progress':
      return 'Next: they do the job and tell you when it’s finished';
    case 'review_needed':
      return 'Next: you check the work and approve it';
    case 'completed':
      return step.whoActs === 'nobody' ? 'Next: the payment goes through' : null;
    default:
      return null;
  }
}
