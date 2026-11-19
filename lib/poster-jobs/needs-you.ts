/**
 * Does one of the poster's jobs need her right now?
 *
 * The answer comes from the job page's own next step (posterNextStep in
 * lib/utils/poster-plain-copy.ts), not a separate list, so Home and the job
 * page can never disagree about it. A job needs her when:
 *
 *   - its next step is "Your move" (whoActs 'you'): offers waiting, work to
 *     check, "Haven't heard from…", a cancellation to answer, a finish date
 *     that passed; or
 *   - a report or dispute is open on it, whoever filed it. "Tell us they
 *     haven't replied" files a bounty_disputes row too (reason_code
 *     hunter_unresponsive / missed_deadline), so both live in that table.
 *     Content reports (the `reports` table) are readable by admins only, so
 *     the app cannot see one filed against her job.
 *
 * Used by the session prompt gate (lib/moments/sessionPromptGate.ts) to hold
 * every prompt while a job needs her. Home's "Your jobs" reuses it.
 */
import type { Bounty } from '../services/database.types';
import { asUtcIso } from '../services/poster-job-activity';
import { isSupabaseConfigured, supabase } from '../supabase';
import { resolveBountyLifecycle } from '../utils/bounty-lifecycle';
import { bountyHoldsUnreleasedEscrow } from '../utils/payment-architecture';
import {
  derivePosterMoney,
  posterNextStep,
  QUIET_HELPER_HOURS,
  type PosterNextStep,
} from '../utils/poster-plain-copy';

/** Everything posterNextStep needs about one job, read for many jobs at once. */
export interface PosterJobFacts {
  bounty: Pick<
    Bounty,
    'id' | 'status' | 'amount' | 'is_for_honor' | 'accepted_by'
  > & {
    end_date?: string | null;
    payment_architecture_version?: number | null;
    payment_status?: string | null;
    settlement_state?: string | null;
    escrow_status?: string | null;
  };
  /** Pending offers (open jobs only). */
  offerCount: number;
  /** Latest completion submission, when there is one. */
  submissionStatus: string | null;
  submittedAt: string | null;
  /** An open or under-review dispute/report on this job. */
  hasDispute: boolean;
  hasCancellationRequest: boolean;
  cancellationRequestedByRole: 'poster' | 'hunter' | null;
  /** When she chose the helper. */
  hiredAt: string | null;
  lastHelperMessageAt: string | null;
  /** True when the message read succeeded; an unknown is never "quiet". */
  messagesKnown: boolean;
}

/** The job page's next step for this job. */
export function posterJobNextStep(facts: PosterJobFacts, now: Date = new Date()): PosterNextStep {
  const { bounty } = facts;
  const state = resolveBountyLifecycle({
    bounty,
    role: 'poster',
    submissionStatus: facts.submissionStatus,
    submittedAt: facts.submittedAt,
    applicationCount: facts.offerCount,
    hasDispute: facts.hasDispute,
    hasCancellationRequest: facts.hasCancellationRequest,
    cancellationRequestedByRole: facts.cancellationRequestedByRole,
    paymentState: bountyHoldsUnreleasedEscrow(bounty) ? 'held' : 'released',
    now,
  });
  return posterNextStep({
    status: state.status,
    hasDispute: facts.hasDispute,
    hasCancellationRequest: facts.hasCancellationRequest,
    posterMustAnswerCancellation: facts.cancellationRequestedByRole === 'hunter',
    offerCount: facts.offerCount,
    helperName: null,
    hired: !!bounty.accepted_by,
    amount: Number(bounty.amount) || 0,
    isForHonor: !!bounty.is_for_honor,
    money: derivePosterMoney({ bounty, openJobCharge: null }),
    reviewDeadline: state.reviewDeadline ?? null,
    hiredAt: facts.hiredAt,
    lastHelperMessageAt: facts.lastHelperMessageAt,
    messagesKnown: facts.messagesKnown,
    now,
  });
}

/** THE rule: does this job need her? */
export function posterJobNeedsYou(facts: PosterJobFacts, now: Date = new Date()): boolean {
  if (facts.hasDispute) return true;
  return posterJobNextStep(facts, now).whoActs === 'you';
}

export interface PosterJobsAttention {
  facts: PosterJobFacts[];
  /** Ids of her jobs that need her, in the order given. */
  needingYou: string[];
  /** An open dispute/report she is part of on a job not in `facts`. */
  otherOpenDispute: boolean;
  needsYou: boolean;
}

/**
 * Reads what posterJobNeedsYou needs for `bounties` (her live jobs), on top
 * of the offer counts and latest submissions the caller already has.
 * Throws when a read that could hide a "Your move" fails, so the caller can
 * treat the answer as unknown rather than "nothing needs you". A failed
 * message read only means "not known to be quiet", exactly as on the job page.
 */
export async function readPosterJobsAttention(params: {
  userId: string;
  bounties: PosterJobFacts['bounty'][];
  offerCounts: Map<string, number>;
  latestSubmissions: Map<string, { status?: string | null; submitted_at?: string | null }>;
  now?: Date;
}): Promise<PosterJobsAttention> {
  const { userId, bounties, offerCounts, latestSubmissions } = params;
  const now = params.now ?? new Date();
  const ids = bounties.map(b => String(b.id));
  const hiredIds = bounties.filter(b => b.accepted_by).map(b => String(b.id));

  const [disputes, cancellations, accepted] = isSupabaseConfigured
    ? await Promise.all([
        readOpenDisputes(userId, ids),
        ids.length ? readPendingCancellations(ids) : Promise.resolve(new Map()),
        hiredIds.length ? readAcceptedAt(hiredIds) : Promise.resolve(new Map()),
      ])
    : [new Set<string>(), new Map(), new Map()];

  const facts: PosterJobFacts[] = await Promise.all(
    bounties.map(async bounty => {
      const id = String(bounty.id);
      const submission = latestSubmissions.get(id);
      const cancellation = cancellations.get(id) ?? null;
      const helperId = bounty.accepted_by ? String(bounty.accepted_by) : null;
      const hiredAt = helperId ? accepted.get(`${id}:${helperId}`) ?? null : null;
      // Only a hire old enough to be "quiet" needs the message read.
      const quietPossible =
        bounty.status === 'in_progress' &&
        !!helperId &&
        !!hiredAt &&
        now.getTime() - new Date(hiredAt).getTime() >= QUIET_HELPER_HOURS * 3600_000;
      let lastHelperMessageAt: string | null = null;
      let messagesKnown = false;
      if (quietPossible && helperId) {
        try {
          lastHelperMessageAt = await readLastHelperMessage(id, helperId);
          messagesKnown = true;
        } catch {
          messagesKnown = false;
        }
      }
      return {
        bounty,
        offerCount: bounty.status === 'open' ? offerCounts.get(id) ?? 0 : 0,
        submissionStatus: submission?.status ?? null,
        submittedAt: submission?.submitted_at ?? null,
        hasDispute: disputes.has(id),
        hasCancellationRequest: !!cancellation,
        cancellationRequestedByRole: cancellation,
        hiredAt,
        lastHelperMessageAt,
        messagesKnown,
      };
    })
  );

  const needingYou = facts.filter(f => posterJobNeedsYou(f, now)).map(f => String(f.bounty.id));
  const known = new Set(ids);
  const otherOpenDispute = [...disputes].some(id => !known.has(id));
  return { facts, needingYou, otherOpenDispute, needsYou: needingYou.length > 0 || otherOpenDispute };
}

/**
 * Bounty ids with an open or under-review dispute she can see (RLS: poster or
 * chosen helper): any on her live jobs, whoever filed it, plus any she is a
 * party to elsewhere.
 */
async function readOpenDisputes(userId: string, bountyIds: string[]): Promise<Set<string>> {
  const open = ['open', 'under_review'];
  const [mine, onJobs] = await Promise.all([
    supabase
      .from('bounty_disputes')
      .select('bounty_id')
      .in('status', open)
      .or(`initiator_id.eq.${userId},respondent_id.eq.${userId}`),
    bountyIds.length
      ? supabase.from('bounty_disputes').select('bounty_id').in('status', open).in('bounty_id', bountyIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (mine.error) throw mine.error;
  if (onJobs.error) throw onJobs.error;
  const ids = new Set<string>();
  for (const row of [...(mine.data ?? []), ...(onJobs.data ?? [])] as { bounty_id?: string | null }[]) {
    if (row?.bounty_id) ids.add(String(row.bounty_id));
  }
  return ids;
}

/** Pending cancellation per bounty → who asked. Latest row wins. */
async function readPendingCancellations(
  bountyIds: string[]
): Promise<Map<string, 'poster' | 'hunter'>> {
  const { data, error } = await supabase
    .from('bounty_cancellations')
    .select('bounty_id, status, requester_type, created_at')
    .in('bounty_id', bountyIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const latest = new Map<string, { status: string; requester: 'poster' | 'hunter' }>();
  for (const row of (data ?? []) as any[]) {
    const id = row?.bounty_id != null ? String(row.bounty_id) : null;
    if (!id || latest.has(id)) continue;
    latest.set(id, { status: String(row.status ?? ''), requester: row.requester_type });
  }
  const pending = new Map<string, 'poster' | 'hunter'>();
  latest.forEach((v, id) => {
    if (v.status === 'pending') pending.set(id, v.requester);
  });
  return pending;
}

/** `${bountyId}:${hunterId}` → accepted_at (UTC ISO). */
async function readAcceptedAt(bountyIds: string[]): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('bounty_requests')
    .select('bounty_id, hunter_id, accepted_at')
    .in('bounty_id', bountyIds)
    .eq('status', 'accepted');
  if (error) throw error;
  const out = new Map<string, string>();
  for (const row of (data ?? []) as any[]) {
    if (!row?.bounty_id || !row?.hunter_id || !row?.accepted_at) continue;
    out.set(`${row.bounty_id}:${row.hunter_id}`, asUtcIso(row.accepted_at));
  }
  return out;
}

/** The helper's latest typed message on this job (system rows excluded). */
async function readLastHelperMessage(bountyId: string, helperId: string): Promise<string | null> {
  const { data: conversations, error: convError } = await supabase
    .from('conversations')
    .select('id')
    .eq('bounty_id', bountyId);
  if (convError) throw convError;
  const ids = (conversations ?? []).map((c: any) => String(c.id)).filter(Boolean);
  if (ids.length === 0) return null;
  const { data, error } = await supabase
    .from('messages')
    .select('created_at')
    .in('conversation_id', ids)
    .eq('sender_id', helperId)
    .eq('message_type', 'text')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row?.created_at ? asUtcIso(row.created_at) : null;
}
