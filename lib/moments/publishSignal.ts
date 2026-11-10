/**
 * Moments Queue — "the user just published a bounty" signal.
 *
 * MomentsProvider learns whether a user has published from a head-count query
 * that only runs on refresh() (mount and app foreground). A poster who
 * publishes mid-session would keep every held moment held (see registry.ts's
 * heldUntilFirstPost) until she next backgrounded the app, and the
 * notification ask meant for right after publishing would miss its moment.
 * The composer calls notifyBountyPublished from its success path; the
 * provider listens and treats the user as published straight away.
 *
 * Module-level so it doesn't depend on the composer being mounted inside the
 * provider. The per-user record also covers a publish that was queued offline
 * (no bounties row yet), so a refresh() before the queue drains doesn't take
 * it back.
 */

type Listener = (userId: string) => void;

const listeners = new Set<Listener>();
const publishedThisRuntime = new Set<string>();

export function notifyBountyPublished(userId: string | null | undefined): void {
  if (!userId) return;
  publishedThisRuntime.add(userId);
  for (const listener of listeners) {
    try {
      listener(userId);
    } catch (err) {
      console.error('[moments] publish listener threw', err);
    }
  }
}

/** True once this runtime has seen `userId` publish a bounty. */
export function hasPublishedThisRuntime(userId: string | null | undefined): boolean {
  return !!userId && publishedThisRuntime.has(userId);
}

/** Returns an unsubscribe function. */
export function onBountyPublished(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only. */
export function resetPublishSignalForTests(): void {
  listeners.clear();
  publishedThisRuntime.clear();
}
