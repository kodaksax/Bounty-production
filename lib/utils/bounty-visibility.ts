/**
 * Single authoritative answer to "may this bounty appear in this list?".
 *
 * Every bounty list used to decide that for itself: the home feed trusted the
 * server's `status = 'open'` query and never re-checked the rows it already
 * held, while the management lists (Work / Posts) inlined
 * `status !== 'archived' && status !== 'deleted'` at each load site. That is how
 * a bounty that had been completed, cancelled or removed could come back: the
 * state it was dropped from was local, and the next fetch — a paginated page
 * merge, a foreground refresh, a screen remount after a tab switch — re-added
 * whatever rows it received without re-applying the same lifecycle rules.
 *
 * Two mechanisms live here, and both must be applied *after every fetch*, not
 * only on first load:
 *
 *  1. `isBountyVisibleInOpenFeed` / `isBountyVisibleInManagementList` — the
 *     lifecycle filter. Purely a function of the backend row, so the UI always
 *     converges on the authoritative database state.
 *  2. The removed-bounty registry — a short-lived record of bounties this
 *     client just made ineligible (completed, deleted, discarded). It only
 *     exists to close the race between a mutation and a list query that was
 *     already in flight (or served from cache) when the mutation landed, so a
 *     stale row cannot be merged back into a list. Entries expire, so the
 *     backend always wins in the long run — this can hide a bounty, never
 *     resurrect one.
 *
 * Pure module (no React, no services) so the matrix is unit-testable — see
 * __tests__/unit/utils/bounty-visibility.test.ts.
 */
import type { Bounty, BountyStatus } from '../services/database.types';

/** The only status a bounty may have to be offered to hunters in the feed. */
export const OPEN_FEED_BOUNTY_STATUSES: readonly BountyStatus[] = ['open'];

/**
 * Statuses that remove a bounty from a poster's/hunter's active management
 * lists. 'archived' and 'deleted' are the soft-removal statuses (see
 * bountyService.delete and the "discard cancelled bounty" flow); everything
 * else — including 'completed' — still belongs in those lists, where it is
 * reachable through the "Completed" chip.
 */
export const REMOVED_BOUNTY_STATUSES: readonly BountyStatus[] = ['archived', 'deleted'];

type BountyLike = Pick<Bounty, 'id'> & { status?: Bounty['status'] | string | null };

/**
 * Eligible for the open/browse feed shown to hunters.
 *
 * A row with no status at all is treated as eligible: it can only come from a
 * projection that omitted the column, and the query that produced it already
 * asked for open bounties. Blanking the feed over a missing field would be a
 * worse failure than showing a row whose state is unknown — the filter exists
 * to drop rows that are *known* to be ineligible.
 */
export function isBountyVisibleInOpenFeed(bounty: BountyLike): boolean {
  const status = bounty?.status;
  if (status == null || status === '') return true;
  return OPEN_FEED_BOUNTY_STATUSES.includes(status as BountyStatus);
}

/** Eligible for a user's own Work / Posts management lists. */
export function isBountyVisibleInManagementList(bounty: BountyLike): boolean {
  return !REMOVED_BOUNTY_STATUSES.includes(bounty?.status as BountyStatus);
}

// ── Removed-bounty registry ────────────────────────────────────────────────

/**
 * Which lists a local removal applies to. A bounty that leaves the open feed
 * (accepted, completed, cancelled) is still a legitimate row in its own
 * poster's/hunter's management lists, so the two surfaces must be able to
 * suppress independently — a shared "hidden everywhere" flag would delete a
 * completed bounty from the "Completed" chip as well.
 */
export type BountyListScope = 'feed' | 'management';

/**
 * How long a locally-removed bounty stays suppressed. Long enough to outlive
 * any in-flight/cached list query and a few tab switches, short enough that a
 * bounty which legitimately returns to an eligible state (e.g. an accepted
 * request is withdrawn and the bounty reopens) is not hidden for the session.
 */
export const REMOVED_BOUNTY_TTL_MS = 5 * 60 * 1000;

const removedBounties = new Map<string, number>();

function registryKey(id: string | number, scope: BountyListScope): string {
  return `${scope}:${String(id)}`;
}

/**
 * Record that this client made a bounty ineligible for the given lists. Call it
 * at the same point the optimistic removal happens, so a refetch that started
 * before the mutation landed cannot merge the stale row back in. Omitting
 * `scopes` suppresses the bounty everywhere (a delete/discard).
 */
export function markBountyRemovedLocally(
  id: string | number,
  scopes: readonly BountyListScope[] = ['feed', 'management']
): void {
  if (id == null) return;
  const at = Date.now();
  for (const scope of scopes) removedBounties.set(registryKey(id, scope), at);
}

/** Undo a suppression — used when a bounty is knowingly restored. */
export function clearBountyRemovedLocally(
  id: string | number,
  scopes: readonly BountyListScope[] = ['feed', 'management']
): void {
  if (id == null) return;
  for (const scope of scopes) removedBounties.delete(registryKey(id, scope));
}

export function isBountyRemovedLocally(id: string | number, scope: BountyListScope): boolean {
  if (id == null) return false;
  const key = registryKey(id, scope);
  const at = removedBounties.get(key);
  if (at == null) return false;
  if (Date.now() - at > REMOVED_BOUNTY_TTL_MS) {
    removedBounties.delete(key);
    return false;
  }
  return true;
}

/** Test/reset helper — the registry is module state shared by every list. */
export function resetRemovedBountiesRegistry(): void {
  removedBounties.clear();
}

// ── List helpers ───────────────────────────────────────────────────────────

/**
 * The filter every open-feed fetch result must pass through — including the
 * incoming page of a "load more" and anything already held in local state.
 */
export function filterOpenFeedBounties<T extends BountyLike>(list: T[]): T[] {
  return (Array.isArray(list) ? list : []).filter(
    b => isBountyVisibleInOpenFeed(b) && !isBountyRemovedLocally(b.id, 'feed')
  );
}

/** The same guarantee for a user's own Work / Posts lists. */
export function filterManagementBounties<T extends BountyLike>(list: T[]): T[] {
  return (Array.isArray(list) ? list : []).filter(
    b => isBountyVisibleInManagementList(b) && !isBountyRemovedLocally(b.id, 'management')
  );
}
