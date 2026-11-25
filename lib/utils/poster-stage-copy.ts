/**
 * What the poster's job workspace (/postings/[bountyId]) shows at each stage,
 * in the Focus-first handoff's words (docs/design/focus-first-poster/, screen
 * ids A–J.4). Pure: the screen resolves the lifecycle and reads the records;
 * this turns them into the four questions, the money line and the one next
 * step, so every stage is unit-tested without React
 * (__tests__/unit/utils/poster-stage-copy.test.ts).
 *
 * Copy is the handoff's, with live names, amounts, counts and days put in.
 * Two systematic substitutions, both recorded as design gaps in the PR:
 *  - DESIGN-GAP: the handoff's sample copy says "she/her" for Ada; the app has no pronoun
 *    data, so the person's name is used instead;
 *  - DESIGN-GAP: job-specific nouns in the samples ("check the garage") become
 *    "the work".
 *
 * Money vocabulary: "held" while Bounty holds the poster's money, "released"
 * once it goes to the helper's Bounty balance. Nothing here says the helper
 * was paid to a bank, and nothing says money is held unless it is.
 */
import { FOCUS_POLICY, J2_MONEY_PLACEHOLDER, NUDGE_AFTER_HOURS, REPLY_TIME_PLACEHOLDER } from '../constants/focus-policy';
import { firstName, formatJobAmount, formatJobDay } from '../my-jobs/format';
import type { BountyLifecycleState } from './bounty-lifecycle';
import { JOB_STEP, stepDetail, stepLine } from './job-steps';
import { DEFAULT_REQUEST_EXPIRY_HOURS, formatExpiryWindow } from './request-expiry';
import type { StageAction, StageMoney, StageViewModel } from './stage-copy-types';
import { MIN_RATING_SAMPLE } from './trust-summary';

export type PosterActionKey =
  | 'done'
  | 'add_details'
  | 'keep_waiting'
  | 'see_people'
  | 'message'
  | 'report_no_reply'
  | 'review_work'
  | 'send_rating'
  | 'skip_rating'
  | 'respond_cancellation'
  | 'see_report'
  | 'back_to_jobs'
  | 'repost';

/** Whether a still-open, unhired job has charged the poster (the server's answer). */
export type OpenJobCharge = 'held' | 'not_charged' | 'checking' | 'unknown';

export interface PosterStageInput {
  bounty: {
    status?: string | null;
    amount?: number | null;
    is_for_honor?: boolean | null;
    accepted_by?: string | null;
    created_at?: string | null;
    completed_at?: string | null;
    updated_at?: string | null;
    funding_mode?: string | null;
  };
  lifecycle: Pick<BountyLifecycleState, 'status' | 'headline' | 'explanation' | 'nextStep' | 'tone'> & Partial<Pick<BountyLifecycleState, 'paying'>>;
  /** The hired helper's display name, when there is one. */
  helperName: string | null;
  /** Pending offers. */
  applicantCount: number;
  submission?: { status?: string | null; proof_items?: unknown[] | null; submitted_at?: string | null } | null;
  hasDispute: boolean;
  /** True when this poster opened the dispute, false when the helper did, null when unknown. */
  disputeOpenedByViewer?: boolean | null;
  /** The pending cancellation request, when there is one. */
  cancellation?: {
    requesterType: 'poster' | 'hunter';
    reason?: string | null;
    refundAmount?: number | null;
    refundPercentage?: number | null;
  } | null;
  /** Only for an open, unhired job; null otherwise. */
  openJobCharge: OpenJobCharge | null;
  /** When the poster last wrote, if the helper hasn't answered since. */
  awaitingReplySince?: string | null;
  /** A payment to hire this person is still confirming (E.3). */
  paymentConfirmingFor?: string | null;
  /** The poster arrived straight from publishing it. */
  justPosted?: boolean;
  /** The live offer-expiry window (hooks/useRequestExpiryPolicy). */
  expiryHours?: number | null;
  /** False once the poster has already rated this helper (or can't). */
  canRate?: boolean;
  /**
   * The paying stage has lasted longer than PAYING_SLOW_AFTER_MS without the
   * job reading back as finished: say we're confirming, never an error.
   */
  payingSlow?: boolean;
  now?: Date;
}

export interface PosterStageView extends StageViewModel<PosterActionKey> {
  show: {
    peopleStrip: boolean;
    /** "Offers close after 3 days if you don't answer." */
    offersCloseNote: string | null;
    lastMessage: boolean;
    story: boolean;
    proofPhotos: boolean;
    rating: boolean;
    /** The charge read failed: offer to check again. */
    checkPaymentAgain: boolean;
  };
}

// ── Shared wording ───────────────────────────────────────────────────────

export const POSTER_UNPAID = "You haven't paid anything yet. You only pay when you choose someone.";

export function posterHeldLine(amount: string): string {
  return `Your ${amount} is with Bounty. Nobody is paid until you approve.`;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "today", "yesterday", "on Saturday", "on Mar 4" — for "Released to Ada …". */
export function onDay(iso: string | null | undefined, now: Date = new Date()): string | null {
  const day = formatJobDay(iso, now);
  if (!day) return null;
  return day === 'today' || day === 'yesterday' ? day : `on ${day}`;
}

/** "6:40 pm" in the phone's own time. */
export function formatClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

function imageCount(proofItems: unknown[] | null | undefined): number {
  return (proofItems ?? []).filter((p) => (p as { type?: string } | null)?.type === 'image').length;
}

function photos(n: number): string {
  return n === 1 ? '1 photo' : `${n} photos`;
}

function hoursSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, (now.getTime() - t) / 3_600_000);
}

const POSTER_MORE: StageAction<PosterActionKey>[] = [];

function action<K extends PosterActionKey>(key: K, label: string, kind: StageAction['kind'], icon?: string): StageAction<K> {
  return icon ? { key, label, kind, icon } : { key, label, kind };
}

/** The money line for an open job nobody has been chosen for, by what the server said. */
function openJobMoney(input: PosterStageInput, amount: string): { money: StageMoney | null; checkAgain: boolean } {
  if (input.bounty.is_for_honor) return { money: null, checkAgain: false };
  switch (input.openJobCharge) {
    case 'not_charged':
      return { money: { kind: 'none', text: POSTER_UNPAID }, checkAgain: false };
    case 'held':
      return { money: { kind: 'held', text: posterHeldLine(amount) }, checkAgain: false };
    case 'checking':
      return { money: { kind: 'none', text: 'Checking your payment…' }, checkAgain: false };
    case 'unknown':
      return {
        money: { kind: 'warn', text: "We couldn't check your payment just now. Tap Check again, or pull down to refresh." },
        checkAgain: true,
      };
    default:
      // Not read (e.g. nothing to charge): pay-when-you-choose unless it was paid at posting.
      return {
        money:
          input.bounty.funding_mode === 'at_post'
            ? { kind: 'held', text: posterHeldLine(amount) }
            : { kind: 'none', text: POSTER_UNPAID },
        checkAgain: false,
      };
  }
}

const NO_BLOCKS: PosterStageView['show'] = {
  peopleStrip: false,
  offersCloseNote: null,
  lastMessage: false,
  story: false,
  proofPhotos: false,
  rating: false,
  checkPaymentAgain: false,
};

/**
 * The poster workspace for one job. Order matters: a dispute or a helper's
 * cancellation request freezes the normal flow, exactly as in
 * resolveBountyLifecycle.
 */
export function describePosterStage(input: PosterStageInput): PosterStageView {
  const now = input.now ?? new Date();
  const { bounty, lifecycle } = input;
  const honor = !!bounty.is_for_honor;
  const amount = formatJobAmount(bounty.amount, honor);
  const helperFull = input.helperName?.trim() || null;
  const helper = firstName(helperFull) ?? 'your helper';
  // A real name is never re-cased (usernames like "ana_hunts" stay as they are);
  // only the fallback is capitalised at the start of a sentence.
  const Helper = helperFull ? helper : capitalize(helper);
  const held: StageMoney | null = honor ? null : { kind: 'held', text: posterHeldLine(amount) };
  const base = { secondary: [] as StageAction<PosterActionKey>[], more: POSTER_MORE, moreOpen: false };

  // J.2 — a dispute pauses everything.
  if (input.hasDispute) {
    const placeholders = FOCUS_POLICY.showPlaceholders;
    const means =
      input.disputeOpenedByViewer === true
        ? `You reported a problem. A person at Bounty is reviewing it and may contact ${helper}.`
        : input.disputeOpenedByViewer === false
          ? `${Helper} reported a problem. A person at Bounty is reviewing it and may contact you.`
          : 'A problem was reported with this job. A person at Bounty is reviewing it.';
    return {
      ...base,
      screenId: 'J.2',
      step: 4,
      stage: 'Paused · Bounty is reviewing',
      now: 'Bounty is looking into it.',
      means,
      money: honor
        ? null
        : placeholders
          ? { kind: 'ph', text: `Nobody is paid while Bounty looks into it. ${J2_MONEY_PLACEHOLDER}` }
          : { kind: 'held', text: 'Nobody is paid while Bounty looks into it.' },
      after: placeholders ? REPLY_TIME_PLACEHOLDER : null,
      primary: action('see_report', 'See your report', 'quiet'),
      show: NO_BLOCKS,
    };
  }

  // J.3 — the helper asked to cancel; only they can (the poster's way out is Help).
  if (input.cancellation && input.cancellation.requesterType === 'hunter') {
    const refund =
      typeof input.cancellation.refundAmount === 'number' && Number.isFinite(input.cancellation.refundAmount)
        ? input.cancellation.refundAmount
        : null;
    const full = refund !== null && Number(bounty.amount) > 0 && refund >= Number(bounty.amount);
    const refundText = refund === null ? null : full ? `all ${amount}` : formatJobAmount(refund);
    const reason = input.cancellation.reason?.trim();
    const offer = refundText
      ? `${Helper} offers to return ${refundText} to your Bounty balance. If you accept, the job ends.`
      : 'If you accept, the job ends.';
    return {
      ...base,
      screenId: 'J.3',
      step: JOB_STEP.working,
      stage: stepDetail(JOB_STEP.working, `${Helper} asked to cancel`),
      now: `${Helper} asked to cancel.`,
      means: reason ? `“${reason}” ${offer}` : offer,
      money:
        honor || refund === null
          ? held
          : { kind: 'held', text: `If you accept: ${formatJobAmount(refund)} back to your Bounty balance.` },
      after: 'You can post the job again.',
      primary: action('respond_cancellation', `Respond to ${helper}'s request`, 'primary'),
      show: NO_BLOCKS,
    };
  }

  // I.2 — approved, the payment is finishing. The submission says approved but
  // the job row doesn't say completed yet (lifecycle.paying). Never "working".
  if (lifecycle.paying) {
    return {
      ...base,
      screenId: 'I.2',
      step: JOB_STEP.finished,
      stage: stepDetail(JOB_STEP.finished, honor ? 'Finishing up' : `Paying ${helper}`),
      now: input.payingSlow ? "We're confirming the payment." : honor ? `You approved ${helper}'s work.` : `Paying ${helper}…`,
      means: input.payingSlow
        ? "You approved the work. It's taking a little longer than usual to show here. You don't need to do anything."
        : honor
          ? 'It was for honor, so no money moves. This page updates by itself in a moment.'
          : `You approved the work. Bounty is sending your ${amount} to ${helper}. This page updates by itself.`,
      money: honor ? null : { kind: 'held', text: `Bounty is releasing your ${amount} to ${helper}.` },
      after: null,
      primary: action('back_to_jobs', 'Back to My Jobs', 'quiet'),
      show: NO_BLOCKS,
    };
  }

  switch (lifecycle.status) {
    case 'review_needed': {
      const n = imageCount(input.submission?.proof_items);
      return {
        ...base,
        screenId: 'H',
        step: JOB_STEP.reviewing,
        stage: stepLine(JOB_STEP.reviewing),
        now: `${Helper} says the job is done.`,
        means:
          n > 0
            ? `${Helper} sent a note and ${photos(n)}. Look at them, and check the work yourself if you can.`
            : `${Helper} sent a note. Read it, and check the work yourself if you can.`,
        money: held,
        after: honor ? 'You decide whether to approve it.' : 'You decide whether to approve and pay.',
        primary: action('review_work', 'Review the completed work', 'primary'),
        show: { ...NO_BLOCKS, proofPhotos: n > 0 },
      };
    }

    case 'in_progress':
    case 'cancellation_requested': {
      if (input.submission?.status === 'revision_requested') {
        return {
          ...base,
          screenId: 'G',
          step: JOB_STEP.working,
          stage: stepLine(JOB_STEP.working),
          now: `You asked ${helper} for a change.`,
          means: `${Helper} will send the work again when it's done. You don't need to do anything until then.`,
          money: held,
          after: 'You review the work again and decide about payment.',
          primary: action('message', `Message ${helper}`, 'quiet', 'chat-bubble-outline'),
          show: { ...NO_BLOCKS, lastMessage: true, story: true },
        };
      }
      // E.2, only once Q-PRD-2 sets a threshold (FOCUS_POLICY.silenceThresholdHours).
      const threshold = FOCUS_POLICY.silenceThresholdHours;
      const since = input.awaitingReplySince;
      if (threshold !== null && since && hoursSince(since, now) >= threshold) {
        const day = formatJobDay(since, now);
        return {
          ...base,
          screenId: 'E.2',
          step: JOB_STEP.working,
          stage: stepLine(JOB_STEP.working),
          now: `You haven't heard from ${helper}.`,
          means: `${Helper} hasn't replied${day ? ` since ${day}` : ''}. People are sometimes just busy. Message ${helper}, or tell us and we'll help.`,
          money: held,
          after: null,
          primary: action('message', `Message ${helper}`, 'primary', 'chat-bubble-outline'),
          secondary: [action('report_no_reply', `Tell us ${helper} hasn't replied`, 'text')],
          show: { ...NO_BLOCKS, lastMessage: true },
        };
      }
      return {
        ...base,
        screenId: 'G',
        step: JOB_STEP.working,
        stage: stepLine(JOB_STEP.working),
        now: `${Helper} is working on your job.`,
        means: `${Helper} will let you know here when it's done. You don't need to do anything until then.`,
        money: held,
        after: 'You review the work and decide about payment.',
        primary: action('message', `Message ${helper}`, 'quiet', 'chat-bubble-outline'),
        show: { ...NO_BLOCKS, lastMessage: true, story: true },
      };
    }

    case 'open': {
      // E.3: nobody is hired until it's confirmed, and nothing here may charge again.
      if (input.paymentConfirmingFor) {
        const first = firstName(input.paymentConfirmingFor) ?? input.paymentConfirmingFor;
        const pending = pendingPaymentCopy(first);
        return {
          ...base,
          screenId: 'E.3',
          step: JOB_STEP.choosing,
          stage: stepLine(JOB_STEP.choosing),
          now: pending.now,
          means: pending.means,
          money: { kind: 'warn', text: pending.money },
          after: null,
          primary: action('back_to_jobs', 'Back to My Jobs', 'quiet'),
          show: NO_BLOCKS,
        };
      }
      const { money, checkAgain } = openJobMoney(input, amount);
      const more: StageAction<PosterActionKey>[] = [];
      if (input.applicantCount > 0) {
        const n = input.applicantCount;
        const window = formatExpiryWindow(input.expiryHours ?? DEFAULT_REQUEST_EXPIRY_HOURS);
        return {
          ...base,
          more,
          screenId: 'C',
          step: JOB_STEP.choosing,
          stage: stepLine(JOB_STEP.choosing),
          now: n === 1 ? '1 person wants to help.' : `${n} people want to help.`,
          means: honor
            ? n === 1
              ? 'They read your job and offered to do it for honor. Look at them, then decide.'
              : 'Each one read your job and offered to do it for honor. Look at each person, then choose one.'
            : n === 1
              ? `They read your job and offered to do it for ${amount}. Look at them, then decide.`
              : `Each one read your job and offered to do it for ${amount}. Look at each person, then choose one.`,
          money,
          after: 'The person you choose starts the work.',
          primary: action('see_people', n === 1 ? 'See this person' : 'See each person', 'primary'),
          show: { ...NO_BLOCKS, peopleStrip: true, offersCloseNote: `Offers close after ${window} if you don't answer.`, checkPaymentAgain: checkAgain },
        };
      }
      const waited = hoursSince(bounty.created_at, now);
      if (input.justPosted || waited < NUDGE_AFTER_HOURS) {
        return {
          ...base,
          more,
          screenId: 'A',
          step: JOB_STEP.posted,
          stage: stepLine(JOB_STEP.posted),
          now: 'Your job is live.',
          means: "People nearby can see it now. When someone offers to help, we'll send you a notification and show them here.",
          money,
          after: 'You choose one person to help.',
          primary: action('done', 'Done', 'primary'),
          show: { ...NO_BLOCKS, checkPaymentAgain: checkAgain },
        };
      }
      const days = Math.max(2, Math.floor(waited / 24));
      return {
        ...base,
        more,
        moreOpen: true,
        screenId: 'B',
        step: JOB_STEP.posted,
        stage: stepLine(JOB_STEP.posted),
        now: 'No one has offered yet.',
        means: `It's been ${days} days. A clear photo and a few details can help people decide.`,
        money,
        after: "We'll tell you as soon as someone offers.",
        primary: action('add_details', 'Add a photo or details', 'primary'),
        secondary: [action('keep_waiting', 'Keep waiting', 'text')],
        show: { ...NO_BLOCKS, checkPaymentAgain: checkAgain },
      };
    }

    case 'completed': {
      // Approved but the release is still settling.
      if (lifecycle.tone === 'progress') {
        return {
          ...base,
          screenId: 'I.3',
          step: JOB_STEP.finished,
          stage: stepLine(JOB_STEP.finished),
          now: 'You approved the work.',
          means: lifecycle.explanation,
          money: honor ? null : { kind: 'held', text: `Bounty is releasing your ${amount} to ${helper}.` },
          after: lifecycle.nextStep || null,
          primary: action('back_to_jobs', 'Back to My Jobs', 'quiet'),
          show: NO_BLOCKS,
        };
      }
      const when = onDay(bounty.completed_at ?? bounty.updated_at, now);
      const canRate = input.canRate !== false;
      return {
        ...base,
        screenId: 'I.3',
        step: JOB_STEP.finished,
        stage: stepLine(JOB_STEP.finished),
        now: honor ? `Done. ${Helper} finished the job.` : `Done. Released to ${helper}.`,
        means: honor
          ? 'It was for honor, so no money moved. Your job is finished.'
          : `${Helper} received your ${amount} in Bounty. Your job is finished.`,
        money: honor
          ? null
          : { kind: 'released', text: `Released to ${helper}${when ? ` ${when}` : ''}. No fees for you.` },
        after: null,
        primary: canRate ? action('send_rating', 'Send rating', 'primary') : action('back_to_jobs', 'Back to My Jobs', 'quiet'),
        secondary: canRate ? [action('skip_rating', 'Skip and go to My Jobs', 'text')] : [],
        show: { ...NO_BLOCKS, rating: canRate },
      };
    }

    default: {
      // Deadline passed, cancelled, archived, removed: the resolver's own words.
      const hired = !!bounty.accepted_by && lifecycle.status === 'deadline_passed';
      return {
        ...base,
        screenId: 'past',
        step: hired ? JOB_STEP.working : JOB_STEP.posted,
        stage: stepDetail(hired ? JOB_STEP.working : JOB_STEP.posted, lifecycle.headline),
        now: `${lifecycle.headline}.`,
        means: lifecycle.explanation,
        money: hired ? held : null,
        after: lifecycle.nextStep || null,
        primary: hired ? action('message', `Message ${helper}`, 'quiet', 'chat-bubble-outline') : action('repost', 'Post a new bounty', 'primary'),
        show: NO_BLOCKS,
      };
    }
  }
}

/** The workspace header's context line: "$60 · Posted Monday", "$60 · Ada is your helper". */
export function posterHeaderMeta(input: Pick<PosterStageInput, 'bounty' | 'helperName'>, now: Date = new Date()): string {
  const amount = formatJobAmount(input.bounty.amount, input.bounty.is_for_honor);
  const helper = firstName(input.helperName);
  if (input.bounty.accepted_by && helper && input.bounty.status !== 'completed') return `${amount} · ${helper} is your helper`;
  const day = formatJobDay(input.bounty.created_at, now);
  return day ? `${amount} · Posted ${day}` : amount;
}

// ── D: one applicant at a time ───────────────────────────────────────────

export interface ApplicantInput {
  message?: string | null;
  distance_mi?: number | null;
  profile?: {
    username?: string | null;
    created_at?: string | null;
    averageRating?: number | null;
    ratingCount?: number | null;
    hunterCompleted?: number | null;
  } | null;
}

export interface ApplicantView {
  name: string;
  first: string;
  since: string | null;
  note: string | null;
  facts: { icon: string; text: string; muted?: boolean }[];
  stage: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "About 2 miles away", "Under 1 mile away". Null when unknown. */
export function formatDistanceWords(miles: number | null | undefined): string | null {
  if (typeof miles !== 'number' || !Number.isFinite(miles) || miles < 0) return null;
  const n = Math.round(miles);
  if (n < 1) return 'Under 1 mile away';
  return n === 1 ? 'About 1 mile away' : `About ${n} miles away`;
}

/**
 * D. Only facts the app has: the ID line only when identity is verified (the
 * screen decides that with deriveCoarseVerificationStatus); the rating only
 * from MIN_RATING_SAMPLE ratings up, "No reviews yet" when there are none,
 * and nothing in between; distance only when the server stamped it.
 *
 * DESIGN-GAP: with 1-2 ratings the rating line is left out: an average below
 * MIN_RATING_SAMPLE isn't shown, and "No reviews yet" would be false.
 */
export function describeApplicant(
  req: ApplicantInput,
  opts: { index: number; total: number; verified: boolean; online?: boolean }
): ApplicantView {
  const name = req.profile?.username?.trim() || 'This person';
  const first = firstName(name) ?? name;
  const created = req.profile?.created_at ? new Date(req.profile.created_at) : null;
  const since =
    created && !Number.isNaN(created.getTime()) ? `On Bounty since ${MONTHS[created.getMonth()]} ${created.getFullYear()}` : null;
  const note = req.message?.trim() ? `“${req.message.trim()}”` : null;
  const facts: ApplicantView['facts'] = [];
  if (opts.verified) facts.push({ icon: 'verified-user', text: `Bounty checked ${first}'s photo ID` });
  const count = Number(req.profile?.ratingCount ?? 0) || 0;
  const avg = Number(req.profile?.averageRating);
  if (count >= MIN_RATING_SAMPLE && Number.isFinite(avg) && avg > 0) {
    facts.push({ icon: 'star', text: `${avg.toFixed(1)} out of 5 from ${count} reviews` });
  } else if (count === 0) {
    facts.push({ icon: 'star-outline', text: 'No reviews yet', muted: true });
  }
  const done = Number(req.profile?.hunterCompleted ?? 0) || 0;
  if (done > 0) facts.push({ icon: 'task-alt', text: `${done} ${done === 1 ? 'job' : 'jobs'} done on Bounty` });
  const distance = formatDistanceWords(req.distance_mi);
  if (opts.online) facts.push({ icon: 'computer', text: 'Online' });
  else facts.push(distance ? { icon: 'place', text: distance } : { icon: 'location-off', text: 'Distance not shown', muted: true });
  return { name, first, since, note, facts, stage: stepDetail(JOB_STEP.choosing, `Person ${opts.index + 1} of ${opts.total}`) };
}

/** 4b's line under the name: "4.8 · 14 jobs · about 2 miles away", from D's own facts. */
export function describeApplicantBrief(view: ApplicantView): string | null {
  const fact = (icon: string) => view.facts.find((f) => f.icon === icon)?.text ?? null;
  const rating = fact('star')?.match(/^[\d.]+/)?.[0] ?? null;
  const jobs = fact('task-alt')?.replace(/ done on Bounty$/, '') ?? null;
  const place = fact('place') ?? fact('computer');
  const parts = [rating, jobs, place ? (rating || jobs ? place.charAt(0).toLowerCase() + place.slice(1) : place) : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ── E: hiring confirmation (AcceptFundingGate) ───────────────────────────

/** "Priya's and Sam's offers close", "Priya's offer closes", "The other 4 offers close". */
export function othersCloseLine(names: readonly string[]): string {
  const firsts = names.map((n) => firstName(n) ?? n).filter(Boolean);
  if (firsts.length === 0) return 'Other offers close';
  if (firsts.length === 1) return `${firsts[0]}'s offer closes`;
  if (firsts.length > 3) return `The other ${firsts.length} offers close`;
  const owned = firsts.map((n) => `${n}'s`);
  return `${owned.slice(0, -1).join(', ')} and ${owned[owned.length - 1]} offers close`;
}

export interface HireCopyInput {
  hunterName: string;
  /** The reward. */
  amount: number;
  /** What the card is charged now (0 when the balance covers it). */
  charge: number;
  /** What comes from the Bounty balance. */
  fromBalance: number;
  /** A saved card will be charged (vs Apple Pay / the payment sheet). */
  paysByCard: boolean;
  otherApplicantNames?: readonly string[];
}

/**
 * DESIGN-GAP: the handoff adds "We'll tell you as soon as it is.", but no
 * notification fires when a deposit confirms, so it is left out; the screen
 * updates itself when the server confirms.
 */
function pendingPaymentCopy(first: string) {
  const known = first !== 'this hunter';
  return {
    now: "We're still confirming your payment.",
    means: `Please don't pay again. ${known ? `${first} isn't` : "The person you chose isn't"} your helper until it's confirmed.`,
    money: 'Your card payment is being confirmed. We check before any other charge.',
  };
}

export function describeHire(input: HireCopyInput) {
  const first = firstName(input.hunterName) ?? input.hunterName;
  const amount = formatJobAmount(input.amount);
  const charge = formatJobAmount(input.charge);
  const balance = formatJobAmount(input.fromBalance);
  const needsPayment = input.charge > 0;
  const source = !needsPayment
    ? 'From your Bounty balance.'
    : input.fromBalance > 0
      ? `${balance} from your Bounty balance and ${charge} from ${input.paysByCard ? 'your card' : 'your payment method'}.`
      : `${charge} from ${input.paysByCard ? 'your card' : 'your payment method'}.`;
  return {
    back: `Back to ${first}`,
    title: `Choose ${first} for ${amount}?`,
    label: `WHAT HAPPENS WHEN YOU CHOOSE ${first.toUpperCase()}`,
    items: [
      { icon: 'payments', title: `You pay ${amount} now`, detail: source },
      { icon: 'lock', title: 'Bounty holds it', detail: `${first} is paid only after you say the job is done.` },
      // TODO(E) Q-ENG-1: confirm the other offers are declined and the people
      // told when someone is chosen; this line only says their offers close.
      { icon: 'mark-email-read', title: othersCloseLine(input.otherApplicantNames ?? []), detail: 'Your job stops taking new offers.' },
      { icon: 'construction', title: `${first} starts the work`, detail: 'You can message each other any time.' },
    ],
    note: 'No fees for you.',
    primary: needsPayment ? `Pay ${charge} and choose ${first}` : `Choose ${first}`,
    cancel: 'Not yet',
    /** E.3, while a payment is still confirming. */
    pending: pendingPaymentCopy(first),
  };
}
