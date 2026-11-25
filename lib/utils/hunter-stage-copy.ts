/**
 * What the hunter sees at each step of a job they offered to do (Focus-first
 * "both sides" handoff, screens H.1–H.10, X.1, X.2, X.4). Pure, like its
 * poster twin (poster-stage-copy.ts), and built on the same resolved
 * lifecycle, so the hunter's workspace, My Jobs and the job thread agree.
 *
 * Money: every take-home, fee and fee percentage comes from
 * calculateHunterEarnings (the design's $80 → $72 at 10% is sample data).
 * Before the poster approves, the copy says the money is held and the hunter
 * is not paid yet; after, that it was released to their Bounty wallet. It
 * never says a wallet credit was paid to a bank.
 *
 * Copy is the handoff's with live names and amounts. Gaps, recorded in the PR:
 *  - DESIGN-GAP: "We'll tell you either way" (H.3) is left out: no notification is sent
 *    when the poster chooses someone else. TODO(E): a declined notification;
 *    and "has seen your offer" stays hidden while application_viewed is
 *    analytics only.
 *  - DESIGN-GAP: "You're mounting Jordan's TV today" (H.7) becomes "You're doing
 *    {Poster}'s job": the verb is job-specific.
 *  - DESIGN-GAP: pronouns in sample copy become names.
 */
import { FOCUS_POLICY, REPLY_TIME_PLACEHOLDER } from '../constants/focus-policy';
import { calculateHunterEarnings, effectiveFeePercent } from '../constants/fees';
import { firstName, formatJobAmount, formatJobDay } from '../my-jobs/format';
import type { BountyLifecycleState } from './bounty-lifecycle';
import { JOB_STEP, stepDetail, stepLine } from './job-steps';
import { formatClock } from './poster-stage-copy';
import type { StageAction, StageMoney, StageViewModel } from './stage-copy-types';

export type HunterActionKey =
  | 'back_to_jobs'
  | 'withdraw'
  | 'tell_done'
  | 'message'
  | 'cant_do'
  | 'send_rating'
  | 'see_wallet'
  | 'find_work'
  | 'remove'
  | 'see_report'
  | 'add_info';

export type HunterSide = 'offered' | 'doing' | 'did';

export interface HunterStageView extends StageViewModel<HunterActionKey> {
  side: HunterSide;
  show: {
    yourNote: boolean;
    askedFor: boolean;
    lastMessage: boolean;
    receipt: boolean;
    rating: boolean;
    /** The review deadline line (only when REVIEW_WINDOW_ENABLED). */
    deadline: string | null;
    /** The change the poster asked for, quoted (M.3 in the workspace). */
    changeRequested: string | null;
  };
}

export interface HunterStageInput {
  bounty: { amount?: number | null; is_for_honor?: boolean | null; status?: string | null };
  lifecycle: Pick<BountyLifecycleState, 'status' | 'headline' | 'explanation' | 'nextStep' | 'tone' | 'waitingOn'> &
    Partial<Pick<BountyLifecycleState, 'paying'>>;
  posterName: string | null;
  /** The viewer's own application. */
  requestStatus?: string | null;
  requestRejectionSource?: string | null;
  submission?: {
    status?: string | null;
    submitted_at?: string | null;
    proof_items?: unknown[] | null;
    poster_feedback?: string | null;
  } | null;
  hasDispute: boolean;
  /** True when this hunter opened the dispute, false when the poster did. */
  disputeOpenedByViewer?: boolean | null;
  /** The review window's deadline, already gated on REVIEW_WINDOW_ENABLED. */
  reviewDeadline?: Date | null;
  /** Server-authoritative fee for a completed release, when known. */
  actualFee?: number | null;
  canRate?: boolean;
  /** The paying stage has lasted past PAYING_SLOW_AFTER_MS (see poster-stage-copy). */
  payingSlow?: boolean;
}

/** The money split, always from calculateHunterEarnings. */
export function hunterMoney(amount: number | null | undefined, actualFee?: number | null) {
  const split = calculateHunterEarnings(amount, actualFee);
  return {
    split,
    gross: formatJobAmount(split.gross),
    fee: formatJobAmount(split.fee),
    net: formatJobAmount(split.net),
    percent: `${effectiveFeePercent(split.gross, split.fee)}%`,
  };
}

function action<K extends HunterActionKey>(key: K, label: string, kind: StageAction['kind'], icon?: string): StageAction<K> {
  return icon ? { key, label, kind, icon } : { key, label, kind };
}

function photos(n: number): string {
  return n === 1 ? '1 photo' : `${n} photos`;
}

const NO_BLOCKS: HunterStageView['show'] = {
  yourNote: false,
  askedFor: false,
  lastMessage: false,
  receipt: false,
  rating: false,
  deadline: null,
  changeRequested: null,
};

/** "Jordan has until Tuesday at 12:40 pm to approve the work or raise a problem. …" */
export function reviewDeadlineLine(poster: string, deadline: Date, now: Date = new Date()): string {
  const when = [formatJobDay(deadline.toISOString(), now), formatClock(deadline.toISOString())].filter(Boolean).join(' at ');
  return `${poster} has until ${when} to approve the work or raise a problem. If they don't respond, Bounty reviews it.`;
}

export function describeHunterStage(input: HunterStageInput, now: Date = new Date()): HunterStageView {
  const honor = !!input.bounty.is_for_honor;
  const amount = formatJobAmount(input.bounty.amount, honor);
  const m = hunterMoney(input.bounty.amount, input.actualFee);
  const posterFull = input.posterName?.trim() || null;
  const Poster = firstName(posterFull) ?? 'The poster';
  const poster = firstName(posterFull) ?? 'the poster';
  const PosterS = firstName(posterFull) ? `${Poster}'s` : "The poster's";
  /** The same possessive mid-sentence. */
  const posterS = firstName(posterFull) ? `${Poster}'s` : "the poster's";
  const held: StageMoney | null = honor
    ? null
    : { kind: 'held', text: `${PosterS} ${amount} is held by Bounty. You get ${m.net} after ${poster} approves your work.` };
  const base = { secondary: [] as StageAction<HunterActionKey>[], more: [] as StageAction<HunterActionKey>[], moreOpen: false };
  const { lifecycle } = input;

  // X.4 — a dispute pauses everything.
  if (input.hasDispute) {
    const means =
      input.disputeOpenedByViewer === false
        ? `${Poster} reported a problem with the work. A person at Bounty will look at the photos and messages, and may contact you.`
        : input.disputeOpenedByViewer === true
          ? `You reported a problem. A person at Bounty will look at the photos and messages, and may contact ${poster}.`
          : 'A problem was reported with this job. A person at Bounty will look at the photos and messages.';
    return {
      ...base,
      screenId: 'X.4',
      side: 'doing',
      step: 4,
      stage: 'Paused · Bounty is reviewing',
      now: 'Bounty is looking into it.',
      means,
      // Outcome, timing and reply time are undecided (Q-PAY-1, Q-PAY-3,
      // Q-OPS-1, Q-OPS-2) and are left out rather than invented.
      money: honor ? null : { kind: 'held', text: 'Nobody is paid while Bounty looks into it.' },
      after: FOCUS_POLICY.showPlaceholders ? REPLY_TIME_PLACEHOLDER : null,
      primary: action('see_report', 'See the report', 'quiet'),
      secondary: [action('add_info', 'Add information', 'text')],
      show: NO_BLOCKS,
    };
  }

  // The poster approved; the job row hasn't read back finished yet.
  if (lifecycle.paying) {
    return {
      ...base,
      screenId: 'H.10',
      side: 'did',
      step: 5,
      stage: stepDetail(JOB_STEP.finished, honor ? 'Approved' : 'Payment on its way'),
      now: input.payingSlow ? "We're confirming the payment." : `${Poster} approved your work.`,
      means: honor
        ? 'It was for honor, so no money moves.'
        : input.payingSlow
          ? `${Poster} approved your work. It's taking a little longer than usual to show here. You don't need to do anything.`
          : `Your ${m.net} is on its way.`,
      money: honor ? null : { kind: 'held', text: `Bounty is releasing ${m.net} to your Bounty wallet.` },
      after: null,
      primary: action('back_to_jobs', 'Back to My Jobs', 'quiet'),
      show: NO_BLOCKS,
    };
  }

  switch (lifecycle.status) {
    case 'applied':
      return {
        ...base,
        more: [action('withdraw', 'Withdraw my offer', 'danger', 'undo')],
        moreOpen: true,
        screenId: 'H.3',
        side: 'offered',
        step: JOB_STEP.choosing,
        stage: stepLine(JOB_STEP.choosing),
        now: `Your offer is with ${poster}.`,
        means: `${Poster} will look at everyone who offered and choose one person.`,
        money: honor
          ? null
          : {
              kind: 'none',
              text: `Nothing is held yet. If ${poster} chooses you, ${posterS} ${amount} is held by Bounty before you start.`,
            },
        after: `If ${poster} chooses you, you start the work.`,
        primary: action('back_to_jobs', 'Back to My Jobs', 'quiet'),
        show: { ...NO_BLOCKS, yourNote: true },
      };

    case 'rejected': {
      const systemClosed = typeof input.requestRejectionSource === 'string' && input.requestRejectionSource.startsWith('system_');
      return {
        ...base,
        screenId: 'X.1',
        side: 'offered',
        step: JOB_STEP.choosing,
        stage: 'Not going ahead',
        now: systemClosed ? `${lifecycle.headline}.` : `${Poster} chose someone else.`,
        means: systemClosed ? lifecycle.explanation : "Thanks for offering. This job isn't taking offers any more.",
        money: { kind: 'none', text: 'Nothing was held, so nothing changes in your wallet.' },
        after: null,
        primary: action('find_work', 'Find more work', 'primary'),
        secondary: [action('remove', 'Remove from my list', 'text')],
        show: NO_BLOCKS,
      };
    }

    case 'submitted_for_review': {
      const n = (input.submission?.proof_items ?? []).filter((p) => (p as { type?: string } | null)?.type === 'image').length;
      const day = formatJobDay(input.submission?.submitted_at, now);
      const time = formatClock(input.submission?.submitted_at);
      const when = day ? ` ${day === 'today' || day === 'yesterday' ? day : `on ${day}`}${time ? ` at ${time}` : ''}` : '';
      return {
        ...base,
        screenId: 'H.9',
        side: 'doing',
        step: 4,
        stage: stepLine(JOB_STEP.reviewing),
        now: `${Poster} is checking your work.`,
        means: `You sent a note${n > 0 ? ` and ${photos(n)}` : ''}${when}. ${Poster} will approve it or ask for a change.`,
        money: honor
          ? null
          : { kind: 'held', text: `Not paid yet. ${PosterS} ${amount} is still held by Bounty. You get ${m.net} when ${poster} approves.` },
        // Verified: trg_completion_review_notification notifies on both outcomes.
        after: "You'll get a notification either way.",
        primary: action('message', `Message ${poster}`, 'quiet', 'chat-bubble-outline'),
        show: { ...NO_BLOCKS, deadline: input.reviewDeadline ? reviewDeadlineLine(Poster, input.reviewDeadline, now) : null },
      };
    }

    case 'in_progress': {
      if (input.submission?.status === 'revision_requested') {
        const feedback = input.submission.poster_feedback?.trim() || null;
        return {
          ...base,
          more: [action('cant_do', "I can't do this job any more", 'danger', 'event-busy')],
          screenId: 'M.3',
          side: 'doing',
          step: 3,
          stage: stepLine(JOB_STEP.working, 'doing'),
          now: `${Poster} asked for a change.`,
          means: 'Make the change, then send the work again.',
          money: honor ? null : { kind: 'held', text: `${amount} is still held. Nothing is paid until ${poster} approves.` },
          after: null,
          primary: action('tell_done', 'Send updated work', 'primary'),
          secondary: [action('message', `Message ${poster}`, 'secondary', 'chat-bubble-outline')],
          show: { ...NO_BLOCKS, changeRequested: feedback, askedFor: true },
        };
      }
      return {
        ...base,
        more: [action('cant_do', "I can't do this job any more", 'danger', 'event-busy')],
        screenId: 'H.7',
        side: 'doing',
        step: 3,
        stage: stepLine(JOB_STEP.working, 'doing'),
        now: firstName(posterFull) ? `You're doing ${posterS} job.` : "You're doing this job.",
        means: `When it's done, take a photo or two and tell ${poster} it's done.`,
        money: held,
        after: `${Poster} checks the work and approves it.`,
        primary: action('tell_done', `Tell ${poster} it's done`, 'primary'),
        secondary: [action('message', `Message ${poster}`, 'secondary', 'chat-bubble-outline')],
        show: { ...NO_BLOCKS, askedFor: true, lastMessage: true },
      };
    }

    case 'completed': {
      if (lifecycle.tone === 'progress') {
        // Approved; the release is still settling.
        return {
          ...base,
          screenId: 'H.10',
          side: 'did',
          step: 5,
          stage: stepLine(JOB_STEP.finished),
          now: `${Poster} approved your work.`,
          means: lifecycle.explanation,
          money: honor ? null : { kind: 'held', text: `Bounty is releasing ${m.net} to your Bounty wallet.` },
          after: null,
          primary: action('see_wallet', 'See my wallet', 'quiet'),
          show: NO_BLOCKS,
        };
      }
      const canRate = input.canRate !== false;
      return {
        ...base,
        screenId: 'H.10',
        side: 'did',
        step: 5,
        stage: stepLine(JOB_STEP.finished),
        now: honor ? `${Poster} approved your work.` : `${Poster} approved. You earned ${m.net}.`,
        means: honor
          ? `${Poster} said the job is done. It was for honor, so no money moved.`
          : `${Poster} said the job is done, and Bounty released the payment to you.`,
        money: honor
          ? null
          : { kind: 'released', text: `${m.net} is in your Bounty wallet. Wallet shows when you can move it to your bank.` },
        after: null,
        // DESIGN-GAP: the optional "How was {Poster}?" rating is RateCounterpartyCard,
        // which carries its own stars and Send button (it decides whether
        // this hunter can still rate), so the pinned step is the wallet.
        primary: honor ? action('find_work', 'Find more work', 'primary') : action('see_wallet', 'See my wallet', 'quiet'),
        show: { ...NO_BLOCKS, receipt: !honor, rating: canRate },
      };
    }

    default:
      // Open without a pending offer, deadline passed, cancelled, removed:
      // the resolver's own words.
      return {
        ...base,
        screenId: 'past',
        side: input.requestStatus === 'accepted' ? 'doing' : 'offered',
        step: input.requestStatus === 'accepted' ? JOB_STEP.working : JOB_STEP.posted,
        stage: lifecycle.headline,
        now: `${lifecycle.headline}.`,
        means: lifecycle.explanation,
        money: null,
        after: lifecycle.nextStep || null,
        primary:
          lifecycle.status === 'deadline_passed' && input.requestStatus === 'accepted'
            ? action('message', `Message ${poster}`, 'quiet', 'chat-bubble-outline')
            : action('find_work', 'Find more work', 'primary'),
        show: NO_BLOCKS,
      };
  }
}

/** The receipt on H.10: "{Poster} paid $X · Service fee (N%) −$F · You get $Y". */
export function hunterReceiptRows(posterName: string | null, amount: number | null | undefined, actualFee?: number | null) {
  const m = hunterMoney(amount, actualFee);
  const Poster = firstName(posterName) ?? 'The poster';
  return [
    { label: `${Poster} paid`, value: m.gross },
    { label: `Service fee (${m.percent})`, value: `−${m.fee}` },
    { label: 'You get', value: m.net, strong: true },
  ];
}

/** The header line: "$80 · Posted by Jordan K.". */
export function hunterHeaderMeta(amount: number | null | undefined, isForHonor: boolean | null | undefined, posterName: string | null): string {
  const a = formatJobAmount(amount, isForHonor);
  return posterName?.trim() ? `${a} · Posted by ${posterName.trim()}` : a;
}

// ── H.1 / H.2 / X.2 — the public job page and the offer sheet ────────────

export function describeOfferSheet(args: {
  title: string | null | undefined;
  posterName: string | null;
  amount: number | null | undefined;
  isForHonor?: boolean | null;
}) {
  const Poster = firstName(args.posterName) ?? 'The poster';
  const poster = firstName(args.posterName) ?? 'the poster';
  const POSTER = poster.toUpperCase();
  const m = hunterMoney(args.amount);
  const title = args.title?.trim();
  const honor = !!args.isForHonor;
  const PosterS = firstName(args.posterName) ? `${Poster}'s` : "The poster's";
  return {
    // DESIGN-GAP: the handoff's "Offer to mount Jordan's TV" needs a verb phrase
    // the app doesn't have; the job's own title stands in.
    title: title ? `Offer to do “${title}”` : 'Offer to do this job',
    label: `IF ${POSTER} CHOOSES YOU`,
    items: honor
      ? [{ icon: 'undo', title: 'You can withdraw', detail: `Any time before ${poster} chooses.` }]
      : [
          { icon: 'lock', title: `${PosterS} ${m.gross} is held by Bounty`, detail: 'Before you start, so you know the money is there.' },
          {
            icon: 'account-balance-wallet',
            title: `You get ${m.net} when ${poster} approves`,
            detail: `${m.gross} minus the ${m.percent} service fee.`,
          },
          { icon: 'undo', title: 'You can withdraw', detail: `Any time before ${poster} chooses.` },
        ],
    field: 'Why you? (optional)',
    send: 'Send offer',
    cancel: 'Cancel',
  };
}

/** H.1's facts rows. Distance only when known; "Online" for online jobs. */
export function describeJobFacts(args: {
  posterName: string | null;
  amount: number | null | undefined;
  isForHonor?: boolean | null;
  online?: boolean;
  distanceText?: string | null;
  dueText?: string | null;
}) {
  const Poster = firstName(args.posterName) ?? 'The poster';
  const rows: { icon: string; label: string; value: string }[] = [];
  if (args.isForHonor) {
    rows.push({ icon: 'favorite', label: 'Reward', value: 'For honor' });
  } else {
    const m = hunterMoney(args.amount);
    rows.push({ icon: 'payments', label: `${Poster} pays`, value: m.gross });
    rows.push({ icon: 'account-balance-wallet', label: 'You get', value: `${m.net} after the ${m.percent} fee` });
  }
  if (args.online) rows.push({ icon: 'computer', label: 'Where', value: 'Online' });
  else if (args.distanceText) rows.push({ icon: 'place', label: 'Where', value: args.distanceText });
  if (args.dueText) rows.push({ icon: 'event', label: 'When', value: args.dueText });
  return rows;
}
