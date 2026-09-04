/**
 * Whether a listing carries the three things a hunter needs to decide if a job
 * is worth taking: scope (a real description), where (a location for in-person
 * work), and when (any timing signal at all).
 *
 * Agents testing the hunter funnel repeatedly stopped at cards that read
 * "Move a couch — $10 — Location TBD" with no description and no date: there was
 * nothing to say yes to. The composer publishes after only title + amount (see
 * app/screens/CreateBounty — everything else is deferred to StepPostPublish), so
 * a listing can reach the feed with none of these filled in.
 *
 * This helper is the single definition of "incomplete" shared by:
 *   - the feed / search, which badge such listings and rank them below complete
 *     ones (components/bounty-feed.tsx, app/tabs/search.tsx), and
 *   - the post-publish screen, which nudges the poster to fill the gaps
 *     (app/screens/CreateBounty/quick/StepPostPublish.tsx).
 */

export type MissingDetail = 'scope' | 'location' | 'timing';

/**
 * A handful of characters ("asap", "help pls") is not scope — it tells a hunter
 * nothing. Short enough that any genuine one-line description clears it.
 */
export const MIN_MEANINGFUL_DESCRIPTION = 15;

export interface BountyCompleteness {
  isComplete: boolean;
  /** Which pieces are missing, in display order. Empty when complete. */
  missing: MissingDetail[];
}

interface CompletenessFacts {
  description?: string | null;
  isRemote: boolean;
  hasLocation: boolean;
  hasTiming: boolean;
}

function evaluate({ description, isRemote, hasLocation, hasTiming }: CompletenessFacts): BountyCompleteness {
  const missing: MissingDetail[] = [];
  if (!description || description.trim().length < MIN_MEANINGFUL_DESCRIPTION) {
    missing.push('scope');
  }
  // Location only matters for in-person work — a remote job is "located" by
  // definition.
  if (!isRemote && !hasLocation) {
    missing.push('location');
  }
  if (!hasTiming) {
    missing.push('timing');
  }
  return { isComplete: missing.length === 0, missing };
}

/** Shape accepted from a persisted bounty row (feed / search results). */
export interface BountyCompletenessInput {
  description?: string | null;
  location?: string | null;
  neighborhood?: string | null;
  work_type?: string | null;
  schedule_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  deadline?: string | null;
  latest_arrival_time?: string | null;
  duration_minutes?: number | null;
  is_time_sensitive?: boolean | null;
}

export function getBountyCompleteness(b: BountyCompletenessInput): BountyCompleteness {
  return evaluate({
    description: b.description,
    isRemote: b.work_type === 'online',
    hasLocation: Boolean(
      (b.neighborhood && String(b.neighborhood).trim()) ||
        (b.location && String(b.location).trim())
    ),
    hasTiming: Boolean(
      b.schedule_type ||
        b.start_date ||
        b.end_date ||
        b.deadline ||
        b.latest_arrival_time ||
        b.duration_minutes ||
        b.is_time_sensitive
    ),
  });
}

/** Shape accepted from an in-progress composer draft (BountyDraft). */
export interface DraftCompletenessInput {
  description?: string | null;
  location?: string | null;
  neighborhood?: string | null;
  workType?: string | null;
  scheduleType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  latestArrivalTime?: string | null;
  durationMinutes?: number | null;
}

export function getDraftCompleteness(d: DraftCompletenessInput): BountyCompleteness {
  return evaluate({
    description: d.description,
    isRemote: d.workType === 'online',
    hasLocation: Boolean(
      (d.neighborhood && String(d.neighborhood).trim()) ||
        (d.location && String(d.location).trim())
    ),
    hasTiming: Boolean(
      d.scheduleType ||
        d.startDate ||
        d.endDate ||
        d.latestArrivalTime ||
        d.durationMinutes
    ),
  });
}

const MISSING_LABELS: Record<MissingDetail, string> = {
  scope: 'what the job involves',
  location: 'where it is',
  timing: 'when it needs doing',
};

/** "where it is and when it needs doing" — for a sentence. */
export function describeMissingDetails(missing: MissingDetail[]): string {
  const parts = missing.map(m => MISSING_LABELS[m]);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

const MISSING_SHORT: Record<MissingDetail, string> = {
  scope: 'scope',
  location: 'location',
  timing: 'timing',
};

/** "No location or timing" — for a compact badge. */
export function summarizeMissingDetails(missing: MissingDetail[]): string {
  const parts = missing.map(m => MISSING_SHORT[m]);
  if (parts.length === 0) return '';
  const joined =
    parts.length === 1
      ? parts[0]
      : parts.length === 2
        ? `${parts[0]} or ${parts[1]}`
        : `${parts.slice(0, -1).join(', ')}, or ${parts[parts.length - 1]}`;
  return `No ${joined}`;
}
