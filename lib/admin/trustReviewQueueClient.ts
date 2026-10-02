// Support / founder queue for stalled bounties (trust-spine T6 / T22).
//
// Backed by admin_trust_review_queue() / admin_update_trust_review_item()
// from supabase/migrations/20261002120100_review_window_and_recourse_queue.sql.
// Items arrive two ways: the review-window cron (a submission waited 72h on
// the poster) and every new dispute (e.g. a poster's "Hunter hasn't
// responded"). The queue moves no money; settling escrow stays in the
// dispute screen and the wallet/payment functions.
import { supabase } from '../supabase';

export type TrustReviewKind = 'completion_review_overdue' | 'dispute';
export type TrustReviewStatus = 'open' | 'contacted' | 'resolved';
export type TrustReviewAdminResolution =
  | 'released_by_support'
  | 'refunded_by_support'
  | 'hunter_cancelled'
  | 'no_action_needed'
  | 'other';

export interface TrustReviewItem {
  id: string;
  kind: TrustReviewKind;
  reasonCode: string | null;
  status: TrustReviewStatus;
  openedAt: string;
  dueAt: string | null;
  bountyId: string | null;
  bountyTitle: string | null;
  bountyStatus: string | null;
  amount: number | null;
  isForHonor: boolean;
  posterId: string | null;
  posterName: string | null;
  hunterId: string | null;
  hunterName: string | null;
  submissionId: string | null;
  disputeId: number | null;
  disputeReason: string | null;
  autoReleaseEligible: boolean | null;
  autoReleaseBlockers: string[];
  facts: Record<string, unknown>;
  resolution: string | null;
  resolutionSource: 'system' | 'admin' | null;
  resolvedAt: string | null;
  notes: string | null;
}

export const TRUST_REVIEW_RESOLUTION_LABELS: Record<TrustReviewAdminResolution, string> = {
  released_by_support: 'Released to hunter',
  refunded_by_support: 'Refunded to poster',
  hunter_cancelled: 'Hunter stepped off',
  no_action_needed: 'No action needed',
  other: 'Other',
};

export function describeTrustReviewItem(item: TrustReviewItem): string {
  if (item.kind === 'completion_review_overdue') {
    return item.facts?.legacy ? 'Review overdue (before rollout)' : 'Review overdue (72h)';
  }
  switch (item.reasonCode) {
    case 'hunter_unresponsive':
      return "Poster: hunter hasn't responded";
    case 'poster_unresponsive':
      return "Hunter: poster hasn't responded";
    case 'work_quality':
      return 'Dispute: work quality';
    case 'missed_deadline':
      return 'Dispute: missed time';
    case 'scope_disagreement':
      return 'Dispute: scope';
    case 'communication':
      return 'Dispute: communication';
    default:
      return 'Dispute';
  }
}

function mapRow(r: Record<string, any>): TrustReviewItem {
  return {
    id: r.id,
    kind: r.kind,
    reasonCode: r.reason_code ?? null,
    status: r.status,
    openedAt: r.opened_at,
    dueAt: r.due_at ?? null,
    bountyId: r.bounty_id ?? null,
    bountyTitle: r.bounty_title ?? null,
    bountyStatus: r.bounty_status ?? null,
    amount: r.amount == null ? null : Number(r.amount),
    isForHonor: !!r.is_for_honor,
    posterId: r.poster_id ?? null,
    posterName: r.poster_name ?? null,
    hunterId: r.hunter_id ?? null,
    hunterName: r.hunter_name ?? null,
    submissionId: r.submission_id ?? null,
    disputeId: r.dispute_id ?? null,
    disputeReason: r.dispute_reason ?? null,
    autoReleaseEligible: r.auto_release_eligible ?? null,
    autoReleaseBlockers: Array.isArray(r.auto_release_blockers) ? r.auto_release_blockers : [],
    facts: (r.facts && typeof r.facts === 'object' ? r.facts : {}) as Record<string, unknown>,
    resolution: r.resolution ?? null,
    resolutionSource: r.resolution_source ?? null,
    resolvedAt: r.resolved_at ?? null,
    notes: r.notes ?? null,
  };
}

export async function fetchTrustReviewQueue(includeResolved = false): Promise<TrustReviewItem[]> {
  const { data, error } = await supabase.rpc('admin_trust_review_queue', {
    p_include_resolved: includeResolved,
  });
  if (error) throw new Error(error.message);
  return ((data as Record<string, any>[] | null) ?? []).map(mapRow);
}

export async function updateTrustReviewItem(
  id: string,
  status: TrustReviewStatus,
  resolution?: TrustReviewAdminResolution,
  notes?: string
): Promise<void> {
  const { error } = await supabase.rpc('admin_update_trust_review_item', {
    p_id: id,
    p_status: status,
    p_resolution: resolution ?? null,
    p_notes: notes ?? null,
  });
  if (error) throw new Error(error.message);
}
