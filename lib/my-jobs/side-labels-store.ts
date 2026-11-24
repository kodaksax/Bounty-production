/**
 * Whether this account works both sides — posts jobs AND offers to do them —
 * as My Jobs last worked it out (lib/my-jobs/featured-job#shouldShowSideLabels).
 *
 * The job workspaces show the side label ("You posted this", "You're doing
 * this") only for such accounts, exactly like My Jobs. They don't load the
 * other side's jobs themselves, so My Jobs remembers its answer here, per
 * user, in memory and in storage. Until My Jobs has run once the answer is
 * `false`: a one-sided account never gains a label it shouldn't have, and a
 * two-sided account sees labels from its next My Jobs visit on.
 */
import * as React from 'react';
import { storage } from '../storage';

const memory = new Map<string, boolean>();
const listeners = new Set<() => void>();

function storageKey(userId: string): string {
  return `@bounty/my_jobs_both_sides/${userId}`;
}

export function rememberWorksBothSides(userId: string | null | undefined, value: boolean): void {
  if (!userId || memory.get(userId) === value) return;
  memory.set(userId, value);
  listeners.forEach((l) => l());
  Promise.resolve(storage.setItem(storageKey(userId), value ? '1' : '0')).catch(() => {});
}

export function useWorksBothSides(userId: string | null | undefined): boolean {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  React.useEffect(() => {
    if (!userId || memory.has(userId)) return;
    let active = true;
    Promise.resolve(storage.getItem(storageKey(userId)))
      .then((raw) => {
        if (!active || memory.has(userId)) return;
        memory.set(userId, raw === '1');
        bump();
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId]);
  return !!userId && memory.get(userId) === true;
}

/** Test seam. */
export function __resetWorksBothSidesForTests(): void {
  memory.clear();
}
