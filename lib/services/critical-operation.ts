/**
 * Critical-operation registry.
 *
 * Tracks work that must not be interrupted by an OTA reload — anything that
 * moves money or leaves the backend in a half-written state if the JS context
 * disappears mid-sequence.
 *
 * The motivating case is bounty publishing: `bountyService.createBounty()` runs
 * first, then escrow funding, with an explicit rollback if funding fails (see
 * app/screens/CreateBounty/index.tsx). A reload between those two steps would
 * kill the rollback, leaving a created-but-unfunded bounty and no cleanup.
 *
 * Deliberately a plain module rather than React state: the callers that matter
 * most are services (stripe-service, payment flows) with no access to hooks.
 */

interface CriticalEntry {
  label: string;
  startedAt: number;
}

/**
 * Ceiling on how long a single operation can hold the lock. A caller that
 * throws past its `finally`, or a promise that never settles, would otherwise
 * block OTA updates for the rest of the process's life. Anything older than
 * this is treated as leaked and ignored — the update path is best-effort, so
 * failing open is the right direction.
 */
const MAX_OPERATION_MS = 3 * 60 * 1000;

const active = new Map<number, CriticalEntry>();
let nextId = 1;

/**
 * Mark a critical operation as started. Returns the release function — always
 * call it from a `finally` block.
 */
export function beginCriticalOperation(label: string): () => void {
  const id = nextId++;
  active.set(id, { label, startedAt: Date.now() });

  let released = false;
  return () => {
    // Guard against double-release: an id could otherwise be reused after
    // `nextId` wraps and clear an unrelated entry.
    if (released) return;
    released = true;
    active.delete(id);
  };
}

/** True while any non-stale critical operation is in flight. */
export function isCriticalOperationInProgress(): boolean {
  if (active.size === 0) return false;

  const now = Date.now();
  let live = false;
  for (const [id, entry] of active.entries()) {
    if (now - entry.startedAt > MAX_OPERATION_MS) {
      active.delete(id);
      continue;
    }
    live = true;
  }
  return live;
}

/** Labels of the operations currently holding the lock (diagnostics/logging). */
export function getActiveCriticalOperations(): string[] {
  return Array.from(active.values()).map((entry) => entry.label);
}

/** Wrap an async operation so it is registered for its whole duration. */
export async function withCriticalOperation<T>(
  label: string,
  operation: () => Promise<T>
): Promise<T> {
  const release = beginCriticalOperation(label);
  try {
    return await operation();
  } finally {
    release();
  }
}

/** Test helper — drops all entries. Not for production paths. */
export function __resetCriticalOperations(): void {
  active.clear();
}
