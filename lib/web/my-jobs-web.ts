/**
 * My Jobs for the website (bountyfinder.net/bounty), built by the app's own
 * rules.
 *
 * The web-account Edge Function loads plain rows for the signed-in person and
 * calls {@link assembleWebMyJobs}. Everything it returns is decided by the same
 * pure code the app's My jobs tab runs (lib/my-jobs, lib/utils/bounty-lifecycle)
 * — wired the way hooks/useMyJobsData + hooks/useBountyStatusFilters wire it —
 * so the website can never disagree with the app about which job needs you,
 * what it says, or what happens to the money.
 *
 * Pure and UI-free: it is bundled for Deno by scripts/build-web-app-rules.mjs
 * (supabase/functions/_shared/generated/app-rules.js) and unit-tested under
 * Jest (__tests__/unit/web/my-jobs-web.test.ts).
 *
 * The payload carries names and ids only — never an email, phone or address.
 */
import { buildMyJobs, groupOffers } from '../my-jobs/build-my-jobs';
import { createManualPick, pickFeaturedJob, shouldShowSideLabels, type ManualPick } from '../my-jobs/featured-job';
import { getFeaturedFlag } from '../my-jobs/format';
import { getJobManageActions, getOfferAction, type ManageActionKey, type OfferActionKey } from '../my-jobs/manage-actions';
import type { JobTarget, MyJob, MyOffer } from '../my-jobs/types';
import type { BountyRequestWithDetails } from '../services/bounty-request-types';
import type { CompletionSubmission } from '../services/completion-types';
import type { Bounty } from '../services/database.types';
import type { Conversation } from '../types';
import { formatApplicantDistance, partitionApplicantsByDistance } from '../utils/applicant-distance';
import { resolveBountyLifecycle } from '../utils/bounty-lifecycle';
import { isBountyVisibleInManagementList } from '../utils/bounty-visibility';

/** A person as the website may show them: a name and an avatar URL, nothing else. */
export interface WebPerson {
  id: string;
  name: string | null;
  avatar: string | null;
}

export interface WebMyJobsRows {
  viewerId: string;
  /** Bounties the viewer posted. `username` is the poster's display name. */
  posted: Bounty[];
  /** The viewer's own applications, each with its bounty (whose `username` names the poster). */
  hunterRequests: BountyRequestWithDetails[];
  /** Pending applications on the viewer's open bounties, each with the applicant's `profile`. */
  pendingApplications: BountyRequestWithDetails[];
  /** The latest completion submission per bounty. */
  submissions: CompletionSubmission[];
  /** Bounties with an open or under-review dispute. */
  disputedBountyIds: string[];
  /** Pending cancellation requests and who asked. */
  cancellations: { bounty_id: string; requester_type: 'poster' | 'hunter' | null }[];
  /**
   * The viewer's 1:1 conversations. `name` is the other person's display
   * name (as the app's conversation list shows it); `unread` counts messages
   * from them since the viewer last read the thread.
   */
  conversations: Conversation[];
  /** Bounty id → still holding escrowed money (the server's payment rows decide). */
  holdsEscrow: Record<string, boolean>;
  /** The viewer's earlier pick from the switcher, as this function returned it. */
  pick?: ManualPick | null;
  /** Feature this job now (the switcher). Wins over `pick`. */
  pickKey?: string | null;
  now?: Date;
}

/** What the website can do from My jobs today. Edit, archive and hide stay app-only. */
const WEB_JOB_ACTIONS: ReadonlySet<ManageActionKey> = new Set(['take_down']);
const WEB_OFFER_ACTIONS: ReadonlySet<OfferActionKey> = new Set(['withdraw', 'open']);

export interface WebJob {
  key: string;
  bounty_id: string;
  side: MyJob['side'];
  title: string;
  needs_you: boolean;
  finished: boolean;
  rank: number;
  /** The pill on the photo, in words: "Needs you", "New message", "Bounty is on it", "Finished"… */
  flag: { kind: 'attn' | 'ok' | 'done' | 'help'; text: string; icon: string };
  context_line: string;
  status: MyJob['status'];
  detail: string | null;
  history_line: string | null;
  cta: { label: string; href: string | null; opens: 'page' | 'applicants' };
  counterpart_name: string | null;
  unread: number;
  cover_url: string | null;
  icon: string;
  pending_offer_count: number;
  actions: { key: ManageActionKey; label: string; tone: 'neutral' | 'danger'; disabled_reason: string | null }[];
  /** Who offered (open jobs you posted): nearest first, far-away people last. */
  applicants: WebApplicant[];
}

export interface WebApplicant {
  request_id: string;
  person: WebPerson;
  message: string | null;
  applied_at: string | null;
  distance_label: string | null;
  far: boolean;
  href: string;
}

export interface WebOffer {
  key: string;
  bounty_id: string;
  request_id: string;
  status: MyOffer['status'];
  title: string;
  poster_name: string | null;
  amount_label: string;
  status_text: string;
  status_icon: string;
  detail: string | null;
  subtitle: string;
  icon: string;
  cover_url: string | null;
  action: { key: OfferActionKey; label: string; tone: string } | null;
  href: string;
}

export interface WebMyJobs {
  jobs: WebJob[];
  offers: { waiting: WebOffer[]; chosen: WebOffer[]; not_going_ahead: WebOffer[] };
  /** The job to feature, or null (no jobs, or only old finished ones). */
  featured_key: string | null;
  featured_reason: 'auto' | 'manual' | null;
  /** Store and send back as `pick`. Null once the pick has been outranked or released. */
  pick: ManualPick | null;
  show_side_labels: boolean;
  /** Jobs that need the viewer — the My Bounties tab badge. */
  needs_you_count: number;
  total_unread: number;
}

/** The website's page for a job target: everything happens on /bounty?id=. */
export function webHref(target: Exclude<JobTarget, { kind: 'applicants' }>): string {
  const q = new URLSearchParams({ id: target.bountyId });
  if (target.kind === 'thread' && target.withId) q.set('with', String(target.withId));
  return `/bounty?${q.toString()}`;
}

function toWebApplicant(r: BountyRequestWithDetails, bountyId: string): WebApplicant {
  const hunterId = String(r.hunter_id ?? (r as any).user_id ?? '');
  const profile = (r as any).profile ?? null;
  return {
    request_id: String(r.id),
    person: {
      id: hunterId,
      name: profile?.username ?? profile?.display_name ?? null,
      avatar: profile?.avatar ?? null,
    },
    message: typeof r.message === 'string' && r.message.trim() ? r.message.trim().slice(0, 1000) : null,
    applied_at: r.created_at ?? null,
    distance_label: formatApplicantDistance((r as any).distance_mi),
    far: (r as any).is_far === true,
    href: webHref({ kind: 'thread', side: 'posted', bountyId, withId: hunterId }),
  };
}

function toWebJob(job: MyJob, applicants: readonly BountyRequestWithDetails[]): WebJob {
  const flag = getFeaturedFlag(job);
  const opensApplicants = job.cta.target.kind === 'applicants';
  const ordered = job.side === 'posted' && job.bounty.status === 'open'
    ? (() => {
        const { nearby, notNearby } = partitionApplicantsByDistance(applicants as BountyRequestWithDetails[]);
        return [...nearby, ...notNearby].map((r) => toWebApplicant(r, job.bountyId));
      })()
    : [];
  return {
    key: job.key,
    bounty_id: job.bountyId,
    side: job.side,
    title: job.title,
    needs_you: job.needsYou,
    finished: job.finished,
    rank: job.rank,
    flag: { kind: flag.kind, text: flag.text, icon: String(flag.icon) },
    context_line: job.contextLine,
    status: job.status,
    detail: job.detail,
    history_line: job.historyLine,
    cta: {
      label: job.cta.label,
      href: opensApplicants ? null : webHref(job.cta.target as Exclude<JobTarget, { kind: 'applicants' }>),
      opens: opensApplicants ? 'applicants' : 'page',
    },
    counterpart_name: job.counterpartName,
    unread: job.unread,
    cover_url: job.coverUri,
    icon: String(job.icon),
    pending_offer_count: job.pendingOfferCount,
    actions: getJobManageActions(job)
      .filter((a) => WEB_JOB_ACTIONS.has(a.key))
      .map((a) => ({ key: a.key, label: a.label, tone: a.tone, disabled_reason: a.disabledReason ?? null })),
    applicants: ordered,
  };
}

function toWebOffer(offer: MyOffer): WebOffer {
  const action = getOfferAction(offer);
  return {
    key: offer.key,
    bounty_id: offer.bountyId,
    request_id: String(offer.request.id),
    status: offer.status,
    title: offer.title,
    poster_name: offer.posterName,
    amount_label: offer.amountLabel,
    status_text: offer.statusText,
    status_icon: String(offer.statusIcon),
    detail: offer.detail,
    subtitle: offer.subtitle,
    icon: String(offer.icon),
    cover_url: offer.coverUri,
    action: WEB_OFFER_ACTIONS.has(action.key) ? { key: action.key, label: action.label, tone: action.tone } : null,
    href: webHref({ kind: 'thread', side: 'doing', bountyId: offer.bountyId }),
  };
}

export function assembleWebMyJobs(rows: WebMyJobsRows): WebMyJobs {
  const now = rows.now ?? new Date();
  const viewerId = String(rows.viewerId);
  // filterManagementBounties without the app-only local-removal registry.
  const posted = rows.posted.filter((b) => isBountyVisibleInManagementList(b));
  const hunterRequests = rows.hunterRequests.filter((r) => r?.bounty && isBountyVisibleInManagementList(r.bounty));

  const pendingByBounty = new Map<string, BountyRequestWithDetails[]>();
  for (const r of rows.pendingApplications) {
    if (r.status !== 'pending') continue;
    const key = String(r.bounty_id);
    const list = pendingByBounty.get(key);
    if (list) list.push(r);
    else pendingByBounty.set(key, [r]);
  }
  const submissions = new Map<string, CompletionSubmission>();
  for (const s of rows.submissions) if (!submissions.has(String(s.bounty_id))) submissions.set(String(s.bounty_id), s);
  const disputed = new Set(rows.disputedBountyIds.map(String));
  const cancellations = new Map(rows.cancellations.map((c) => [String(c.bounty_id), c.requester_type ?? null]));
  const requestStatus = new Map<string, string>();
  const rejection = new Map<string, string | null>();
  for (const r of hunterRequests) {
    const id = String(r.bounty.id);
    if (!requestStatus.has(id)) {
      requestStatus.set(id, r.status);
      rejection.set(id, (r as any).rejection_source ?? null);
    }
  }

  // hooks/useBountyStatusFilters.getLifecycle + useMyJobsData.getLifecycleOverlay.
  const getLifecycle = (b: Bounty, variant: 'owner' | 'hunter') => {
    const id = String(b.id);
    const submission = submissions.get(id);
    const requestedBy = cancellations.has(id) ? cancellations.get(id) ?? null : undefined;
    return resolveBountyLifecycle({
      bounty: b,
      role: variant === 'owner' ? 'poster' : 'hunter',
      viewerId,
      requestStatus: variant === 'hunter' ? requestStatus.get(id) ?? null : null,
      requestRejectionSource: variant === 'hunter' ? rejection.get(id) ?? null : null,
      submissionStatus: submission?.status ?? null,
      submissionIsMine: !!submission && String(submission.hunter_id) === viewerId,
      submittedAt: submission?.submitted_at ?? null,
      applicationCount: variant === 'owner' ? pendingByBounty.get(id)?.length ?? 0 : 0,
      hasDispute: disputed.has(id),
      hasCancellationRequest: requestedBy !== undefined,
      cancellationRequestedByRole: requestedBy ?? null,
      paymentState: rows.holdsEscrow[id] ? 'held' : 'released',
      now,
    });
  };

  const model = buildMyJobs({
    viewerId,
    postedBounties: posted,
    hunterRequests,
    pendingApplicationsByBounty: pendingByBounty,
    conversations: rows.conversations,
    getLifecycle,
    getSubmission: (id) => submissions.get(id),
    now,
  });

  const pick = rows.pickKey ? createManualPick(model.jobs, rows.pickKey) : rows.pick ?? null;
  const featured = pickFeaturedJob(model.jobs, pick, now);
  const keptPick = featured?.reason === 'manual' ? pick : null;
  const grouped = groupOffers(model.offers);

  return {
    jobs: model.jobs.map((j) => toWebJob(j, pendingByBounty.get(j.bountyId) ?? [])),
    offers: {
      waiting: grouped.waiting.map(toWebOffer),
      chosen: grouped.chosen.map(toWebOffer),
      not_going_ahead: grouped.not_going_ahead.map(toWebOffer),
    },
    featured_key: featured?.job.key ?? null,
    featured_reason: featured?.reason ?? null,
    pick: keptPick,
    show_side_labels: shouldShowSideLabels(model.jobs, model.offers),
    needs_you_count: model.jobs.filter((j) => j.needsYou).length,
    total_unread: rows.conversations.reduce((n, c) => n + (c.unread ?? 0), 0),
  };
}
