/**
 * Focus-first analytics: the four additive events the poster handoff asks
 * for (featured_job_viewed, job_switcher_opened, job_switched,
 * workspace_primary_tapped). snake_case properties, per
 * docs/analytics/EVENT_TAXONOMY_CUTOVER.md; analyticsService dual-sends the
 * camelCase keys. Every call is best-effort and never throws.
 */
import type { MyJob } from '../my-jobs/types';
import { analyticsService } from './analytics-service';

function fire(event: Parameters<typeof analyticsService.trackEvent>[0], props: Record<string, unknown>) {
  void analyticsService.trackEvent(event, props as never).catch(() => {});
}

function jobProps(job: MyJob) {
  return {
    bounty_id: job.bountyId,
    side: job.side,
    rank: job.rank,
    needs_you: job.needsYou,
    finished: job.finished,
  };
}

export function trackFeaturedJobViewed(job: MyJob, reason: 'auto' | 'manual'): void {
  fire('featured_job_viewed', { ...jobProps(job), reason });
}

export function trackJobSwitcherOpened(jobCount: number, offerCount: number): void {
  fire('job_switcher_opened', { job_count: jobCount, offer_count: offerCount });
}

export function trackJobSwitched(job: MyJob, fromBountyId: string | null): void {
  fire('job_switched', { ...jobProps(job), from_bounty_id: fromBountyId });
}

export function trackWorkspacePrimaryTapped(args: {
  bountyId: string;
  side: 'posted' | 'doing';
  screenId: string;
  action: string;
}): void {
  fire('workspace_primary_tapped', {
    bounty_id: args.bountyId,
    side: args.side,
    screen_id: args.screenId,
    action: args.action,
  });
}
