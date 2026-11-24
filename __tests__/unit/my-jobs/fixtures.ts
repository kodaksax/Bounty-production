/**
 * Builders for My Jobs unit tests. The lifecycle is the real shared resolver,
 * wired the way hooks/useBountyStatusFilters wires it, so the tests exercise
 * the same states the app shows.
 */
import type { BuildMyJobsInput } from '../../../lib/my-jobs/build-my-jobs';
import type { BountyRequestWithDetails } from '../../../lib/services/bounty-request-service';
import type { CompletionSubmission } from '../../../lib/services/completion-service';
import type { Bounty } from '../../../lib/services/database.types';
import type { Conversation } from '../../../lib/types';
import type { BountyLifecycleInput } from '../../../lib/utils/bounty-lifecycle';
import { resolveBountyLifecycle } from '../../../lib/utils/bounty-lifecycle';

export const ME = 'me';
export const NOW = new Date('2026-11-21T12:00:00Z');

export function bounty(over: Partial<Bounty> & { id: string }): Bounty {
  return {
    title: `Job ${over.id}`,
    description: '',
    amount: 60,
    is_for_honor: false,
    location: '',
    status: 'open',
    poster_id: ME,
    created_at: '2026-11-16T10:00:00Z',
    ...over,
  } as Bounty;
}

export function request(
  over: Partial<BountyRequestWithDetails> & { bounty: Bounty; id?: string }
): BountyRequestWithDetails {
  return {
    id: over.id ?? `req-${over.bounty.id}-${over.hunter_id ?? ME}`,
    bounty_id: String(over.bounty.id),
    hunter_id: ME,
    status: 'pending',
    created_at: '2026-11-17T10:00:00Z',
    profile: { id: over.hunter_id ?? ME, username: 'Someone' },
    ...over,
  } as BountyRequestWithDetails;
}

export function conversation(over: Partial<Conversation> & { id: string; participantIds: string[] }): Conversation {
  return { isGroup: false, name: 'Someone', ...over } as Conversation;
}

/**
 * `lifecycleExtras` stands in for the per-bounty overlays the data hook loads
 * (dispute, cancellation request, escrow state).
 */
export function makeInput(
  over: Partial<BuildMyJobsInput> = {},
  lifecycleExtras: Partial<BountyLifecycleInput> = {}
): BuildMyJobsInput {
  const submissions = new Map<string, CompletionSubmission>();
  const hunterRequests = over.hunterRequests ?? [];
  const pending = over.pendingApplicationsByBounty ?? new Map();
  const requestStatus = new Map(hunterRequests.map((r) => [String(r.bounty.id), r.status]));
  const input: BuildMyJobsInput = {
    viewerId: ME,
    postedBounties: [],
    hunterRequests,
    pendingApplicationsByBounty: pending,
    conversations: [],
    now: NOW,
    getSubmission: (id) => submissions.get(id),
    getLifecycle: (b, variant) => {
      const submission = input.getSubmission(String(b.id));
      return resolveBountyLifecycle({
        bounty: b,
        role: variant === 'owner' ? 'poster' : 'hunter',
        viewerId: ME,
        requestStatus: variant === 'hunter' ? requestStatus.get(String(b.id)) ?? null : null,
        submissionStatus: submission?.status ?? null,
        submissionIsMine: !!submission && submission.hunter_id === ME,
        applicationCount: variant === 'owner' ? pending.get(String(b.id))?.length ?? 0 : 0,
        now: NOW,
        ...lifecycleExtras,
      });
    },
    ...over,
  };
  return input;
}

export function submission(over: Partial<CompletionSubmission> & { bounty_id: string }): CompletionSubmission {
  return {
    hunter_id: 'hunter-1',
    message: 'Done',
    proof_items: [],
    status: 'pending',
    submitted_at: '2026-11-21T09:00:00Z',
    ...over,
  };
}
