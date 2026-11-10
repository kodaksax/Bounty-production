/**
 * Server copy of the composer's draft (public.bounty_drafts), so a post started
 * on one device can be finished on another.
 *
 * The device copy (app/hooks/useBountyDraft.ts) stays the source of truth for
 * editing. This module only:
 *   - upserts the latest copy, debounced by SERVER_DRAFT_DEBOUNCE_MS, so a
 *     typing burst costs one request;
 *   - fetches the server copy when the composer loads;
 *   - deletes it on publish and on "Start over";
 *   - decides which copy wins (resolveDraftCopies: newer updated_at wins).
 *
 * Every server operation for a user runs in order on one queue. A delete
 * enqueued behind an in-flight upsert therefore runs after it, and a published
 * draft can't be written back by the last debounced save.
 *
 * Drafts can hold the exact pin of an in-person task. Nothing here may be sent
 * to analytics, and failures are logged without the draft.
 */

import { AppState, Platform } from 'react-native';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { isSupabaseConfigured, supabase } from '../supabase';
import { withTimeout } from '../utils/withTimeout';

export const SERVER_DRAFT_DEBOUNCE_MS = 2000;
/** How long the composer waits for the server copy before using the device's. */
export const SERVER_DRAFT_FETCH_TIMEOUT_MS = 3000;
const SERVER_DRAFT_WRITE_TIMEOUT_MS = 10000;
const TABLE = 'bounty_drafts';
/** The composer's step count. The table accepts more (see the migration). */
const MAX_STEP = 3;

/** One copy of a draft, on the device or on the server. */
export interface DraftCopy {
  draft: BountyDraft;
  /** The composer step it was left on, 1-based. */
  lastStep: number;
  /** ISO time of the last edit. Null for a device copy saved before sync existed. */
  updatedAt: string | null;
}

export type ServerDraftFetch =
  | { status: 'ok'; copy: DraftCopy | null }
  /** Offline, timed out, not configured, or the table is missing. */
  | { status: 'unavailable' };

export function clampStep(step: unknown): number {
  const n = typeof step === 'number' && Number.isFinite(step) ? Math.floor(step) : 1;
  return Math.min(MAX_STEP, Math.max(1, n));
}

function timeOf(iso: string | null | undefined): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

export interface DraftResolution {
  /** Which copy the composer should open. */
  winner: 'local' | 'server' | 'none';
  copy: DraftCopy | null;
  /** The device copy is newer than the server's (or the server has none): upload it. */
  pushLocal: boolean;
  /** The server holds a copy this device already published or discarded: delete it. */
  deleteServer: boolean;
  /** The server copy was removed elsewhere after this device last synced: drop the device copy. */
  clearLocal: boolean;
  /** The pending delete marker can go (nothing left on the server to delete). */
  forgetCleared: boolean;
}

/**
 * Pick which copy to open. Newer `updatedAt` wins.
 *
 * `local` is the device copy, `syncedAt` the updatedAt of the last device copy
 * the server confirmed, and `clearedAt` when this device last published or
 * discarded a draft whose server delete has not been confirmed yet.
 *
 *   - Server unavailable: open the device copy, and retry whatever is pending.
 *   - A server copy newer than both the device copy and this device's last
 *     clear wins. Otherwise a device copy at least as new wins. Otherwise the
 *     server copy is one this device already cleared: delete it.
 *   - No server copy, but the device copy was synced and hasn't changed since:
 *     another device published or discarded it, so drop it here too.
 *
 * Timestamps come from each device's clock. Ties go to the device copy.
 */
export function resolveDraftCopies(
  local: DraftCopy | null,
  syncedAt: string | null,
  clearedAt: string | null,
  server: ServerDraftFetch
): DraftResolution {
  const base = { pushLocal: false, deleteServer: false, clearLocal: false, forgetCleared: false };
  const localUnsynced = local !== null && !(timeOf(syncedAt) >= timeOf(local.updatedAt) && local.updatedAt !== null);

  if (server.status === 'unavailable') {
    return {
      ...base,
      winner: local ? 'local' : 'none',
      copy: local,
      pushLocal: localUnsynced,
      deleteServer: clearedAt !== null && local === null,
    };
  }

  const remote = server.copy;
  if (!remote) {
    if (local && !localUnsynced) {
      return { ...base, winner: 'none', copy: null, clearLocal: true, forgetCleared: true };
    }
    return { ...base, winner: local ? 'local' : 'none', copy: local, pushLocal: local !== null, forgetCleared: true };
  }

  const tServer = timeOf(remote.updatedAt);
  const tLocal = local ? timeOf(local.updatedAt) : Number.NEGATIVE_INFINITY;
  const tCleared = timeOf(clearedAt);

  if (tServer > tLocal && tServer > tCleared) {
    return { ...base, winner: 'server', copy: remote, forgetCleared: clearedAt !== null };
  }
  if (local && tLocal >= tServer) {
    return { ...base, winner: 'local', copy: local, pushLocal: tLocal > tServer || local.updatedAt === null };
  }
  // The server copy is no newer than this device's last publish/discard (and
  // any device copy is older still).
  return { ...base, winner: 'none', copy: null, deleteServer: true, clearLocal: local !== null };
}

// ---------------------------------------------------------------------------
// Server I/O

let deviceNameCache: string | null | undefined;

/**
 * The model ("Pixel 7", "iPad Pro"), not the user-set device name, which is
 * often the owner's own name.
 */
export function serverDraftDeviceName(): string | null {
  if (deviceNameCache !== undefined) return deviceNameCache;
  let name: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Device = require('expo-device');
    name = Device?.modelName || null;
  } catch {
    name = null;
  }
  deviceNameCache = (name || Platform.OS || '').slice(0, 100) || null;
  return deviceNameCache;
}

/**
 * Attachments that only exist on this device (a picked photo not yet uploaded)
 * mean nothing on another one, so only uploaded files travel.
 */
function draftForServer(draft: BountyDraft): BountyDraft {
  const attachments = (draft.attachments || []).filter((a) => {
    const uri = a.remoteUri || a.uri || '';
    return /^https?:\/\//i.test(uri);
  });
  return { ...draft, attachments };
}

function logFailure(what: string, error: unknown) {
  // Message only: the error must never carry the draft into a log sink.
  const message = error instanceof Error ? error.message : (error as { message?: string } | null)?.message;
  if (__DEV__) console.warn(`[bounty-draft-sync] ${what} failed: ${message ?? 'unknown error'}`);
}

/** The signed-in user's server copy. Never throws. */
export async function fetchServerDraft(
  userId: string,
  timeoutMs: number = SERVER_DRAFT_FETCH_TIMEOUT_MS
): Promise<ServerDraftFetch> {
  if (!isSupabaseConfigured || !userId) return { status: 'unavailable' };
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase
          .from(TABLE)
          .select('draft, last_step, updated_at')
          .eq('user_id', userId)
          .maybeSingle()
      ),
      timeoutMs
    );
    if (error) {
      logFailure('fetch', error);
      return { status: 'unavailable' };
    }
    if (!data || typeof data.draft !== 'object' || data.draft === null || Array.isArray(data.draft)) {
      return { status: 'ok', copy: null };
    }
    return {
      status: 'ok',
      copy: {
        draft: data.draft as BountyDraft,
        lastStep: clampStep(data.last_step),
        updatedAt: typeof data.updated_at === 'string' ? data.updated_at : null,
      },
    };
  } catch (error) {
    logFailure('fetch', error);
    return { status: 'unavailable' };
  }
}

async function upsertNow(userId: string, copy: DraftCopy): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { error } = await withTimeout(
      Promise.resolve(
        supabase.from(TABLE).upsert(
          {
            user_id: userId,
            draft: draftForServer(copy.draft),
            last_step: clampStep(copy.lastStep),
            updated_at: copy.updatedAt ?? new Date().toISOString(),
            device_name: serverDraftDeviceName(),
          },
          { onConflict: 'user_id' }
        )
      ),
      SERVER_DRAFT_WRITE_TIMEOUT_MS
    );
    if (error) {
      logFailure('upsert', error);
      return false;
    }
    return true;
  } catch (error) {
    logFailure('upsert', error);
    return false;
  }
}

async function deleteNow(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { error } = await withTimeout(
      Promise.resolve(supabase.from(TABLE).delete().eq('user_id', userId)),
      SERVER_DRAFT_WRITE_TIMEOUT_MS
    );
    if (error) {
      logFailure('delete', error);
      return false;
    }
    return true;
  } catch (error) {
    logFailure('delete', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ordering + debounce

const queues = new Map<string, Promise<unknown>>();

/** Runs `op` after every earlier operation for this user has settled. */
function enqueue<T>(userId: string, op: () => Promise<T>): Promise<T> {
  const previous = queues.get(userId) ?? Promise.resolve();
  const run = previous.then(op, op);
  const settled = run.catch(() => undefined);
  queues.set(userId, settled);
  void settled.then(() => {
    if (queues.get(userId) === settled) queues.delete(userId);
  });
  return run;
}

interface PendingUpsert {
  timer: ReturnType<typeof setTimeout>;
  copy: DraftCopy;
  onSynced?: (updatedAt: string) => void;
}
const pending = new Map<string, PendingUpsert>();

let appStateSubscribed = false;
function flushOnBackground() {
  if (appStateSubscribed) return;
  appStateSubscribed = true;
  try {
    AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        for (const userId of Array.from(pending.keys())) void flushServerDraftUpsert(userId);
      }
    });
  } catch {
    // AppState may be unavailable in some test environments.
  }
}

function runUpsert(userId: string, job: PendingUpsert): Promise<boolean> {
  return enqueue(userId, async () => {
    const ok = await upsertNow(userId, job.copy);
    if (ok && job.copy.updatedAt) job.onSynced?.(job.copy.updatedAt);
    return ok;
  });
}

/**
 * Upload `copy` SERVER_DRAFT_DEBOUNCE_MS after the last call for this user.
 * `onSynced` runs with the uploaded copy's updatedAt once the server has it.
 */
export function scheduleServerDraftUpsert(
  userId: string,
  copy: DraftCopy,
  onSynced?: (updatedAt: string) => void
): void {
  if (!userId) return;
  flushOnBackground();
  const existing = pending.get(userId);
  if (existing) clearTimeout(existing.timer);
  const job: PendingUpsert = {
    copy,
    onSynced,
    timer: setTimeout(() => {
      if (pending.get(userId) === job) pending.delete(userId);
      void runUpsert(userId, job);
    }, SERVER_DRAFT_DEBOUNCE_MS),
  };
  pending.set(userId, job);
}

/** Send the pending upload now (the composer is going away, or the app is). */
export async function flushServerDraftUpsert(userId: string | undefined): Promise<void> {
  if (!userId) return;
  const job = pending.get(userId);
  if (!job) return;
  clearTimeout(job.timer);
  pending.delete(userId);
  await runUpsert(userId, job);
}

/** Drop the pending upload without sending it (sign-out). */
export function cancelServerDraftUpsert(userId: string | undefined): void {
  if (!userId) return;
  const job = pending.get(userId);
  if (!job) return;
  clearTimeout(job.timer);
  pending.delete(userId);
}

/**
 * Delete the server copy (publish, "Start over"). Cancels any pending upload
 * first and runs after any upload already in flight. Resolves true once the
 * server confirms. Never throws.
 */
export function deleteServerDraft(userId: string | undefined): Promise<boolean> {
  if (!userId) return Promise.resolve(false);
  cancelServerDraftUpsert(userId);
  return enqueue(userId, () => deleteNow(userId));
}

/** Test seam. */
export function __resetBountyDraftSyncForTests(): void {
  for (const job of pending.values()) clearTimeout(job.timer);
  pending.clear();
  queues.clear();
  deviceNameCache = undefined;
}
