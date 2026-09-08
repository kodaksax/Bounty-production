// lib/utils/hunter-hidden-bounties.ts
//
// Persisted, per-user record of bounties a hunter hid from their own "In
// Progress" list via the "Hide" / "Remove from List" actions on a completed
// bounty card (components/my-posting-expandable.tsx, rendered with
// variant="hunter").
//
// Those two actions never touch the bounty itself — the poster and every
// other viewer still see it exactly as before — so this is a purely local
// viewing preference, not a fact about the bounty's lifecycle (that case is
// already handled by lib/utils/bounty-visibility.ts for archived/deleted
// bounties). Before this module existed, "Hide"/"Remove from List" only ever
// called `setHiddenByUser(true)` — component-local React state with nothing
// behind it. The card the user just hid would reappear the moment the screen
// remounted (navigating to another bottom-nav tab unmounts InboxScreen /
// PostingsScreen entirely — see app/tabs/bounty-app.tsx's conditional
// rendering) or the app restarted, because nothing had actually been
// recorded anywhere for the next fetch to respect. That's issue #779.
//
// Storing this in AsyncStorage (via lib/storage.ts's cross-platform wrapper)
// rather than a DB column matches its scope: nobody but this hunter, on this
// device, needs to know a card was dismissed from their own list.
import { storage } from '../storage';

function storageKey(userId: string): string {
  return `@bounty/hunter_hidden_bounties/${userId}`;
}

function normalizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** All bounty ids this hunter has hidden from their In Progress list. */
export async function loadHunterHiddenBountyIds(
  userId: string | undefined | null
): Promise<Set<string>> {
  if (!userId) return new Set();
  try {
    const stored = await storage.getItem(storageKey(userId));
    if (!stored) return new Set();
    return new Set(normalizeIds(JSON.parse(stored)));
  } catch {
    // A corrupt/unreadable entry must not resurrect every previously-hidden
    // bounty at once — fall back to "nothing hidden yet" instead.
    return new Set();
  }
}

/**
 * Record that `bountyId` should stay off this hunter's In Progress list.
 * Idempotent — hiding an already-hidden bounty is a no-op write.
 */
export async function hideBountyForHunter(
  userId: string | undefined | null,
  bountyId: string | number
): Promise<void> {
  if (!userId || bountyId == null) return;
  const ids = await loadHunterHiddenBountyIds(userId);
  const key = String(bountyId);
  if (ids.has(key)) return;
  ids.add(key);
  await storage.setItem(storageKey(userId), JSON.stringify(Array.from(ids)));
}

/** Undo a hide — not currently wired to any UI, kept for symmetry/testability. */
export async function unhideBountyForHunter(
  userId: string | undefined | null,
  bountyId: string | number
): Promise<void> {
  if (!userId || bountyId == null) return;
  const ids = await loadHunterHiddenBountyIds(userId);
  const key = String(bountyId);
  if (!ids.has(key)) return;
  ids.delete(key);
  await storage.setItem(storageKey(userId), JSON.stringify(Array.from(ids)));
}

/**
 * The filter every In Progress list must pass through, mirroring the shape
 * of filterManagementBounties/filterOpenFeedBounties in bounty-visibility.ts.
 */
export function filterHunterHiddenBounties<T extends { id: string | number }>(
  list: T[],
  hiddenIds: ReadonlySet<string>
): T[] {
  if (!Array.isArray(list) || list.length === 0 || hiddenIds.size === 0) {
    return Array.isArray(list) ? list : [];
  }
  return list.filter((b) => !hiddenIds.has(String(b.id)));
}
