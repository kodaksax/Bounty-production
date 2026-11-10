import { useCallback, useEffect, useRef, useState } from 'react';
import { resumeStepForDraft } from 'app/screens/CreateBounty/postStepFields';
import { storage } from '../../lib/storage';
import { clearDraftAbandoned } from '../../lib/storage/abandoned-draft';
import {
  cancelDraftReminder,
  scheduleDraftReminderSoon,
} from '../../lib/services/draft-reminder';
import {
  cancelServerDraftUpsert,
  clampStep,
  deleteServerDraft,
  fetchServerDraft,
  flushServerDraftUpsert,
  resolveDraftCopies,
  scheduleServerDraftUpsert,
  type DraftCopy,
  type ServerDraftFetch,
} from '../../lib/services/bounty-draft-sync';
import type { Attachment } from '../../lib/types';
import type { TrustTier } from '../../lib/utils/trust-tier';

const DRAFT_KEY_PREFIX = 'bounty-draft-v1';

function getDraftKey(userId?: string): string {
  return userId ? `${DRAFT_KEY_PREFIX}:${userId}` : DRAFT_KEY_PREFIX;
}

// Two small side keys next to the draft, kept apart from it so that writing
// them can never clobber a newer draft write:
//   :synced  — updatedAt of the last device copy the server confirmed. A copy
//              whose updatedAt is no newer is already on the server.
//   :cleared — when this device last published or discarded a draft whose
//              server delete hasn't been confirmed. A server copy no newer than
//              this is stale and gets deleted instead of restored.
function syncedKey(userId: string): string {
  return `${getDraftKey(userId)}:synced`;
}
function clearedKey(userId: string): string {
  return `${getDraftKey(userId)}:cleared`;
}

/**
 * What is stored under the draft key: the draft's own fields, plus the step it
 * was left on and the edit time. Top-level rather than nested so a build that
 * predates them still reads the draft. Both are absent on drafts saved before
 * 2026-11-10.
 */
type StoredDraftRecord = BountyDraft & { lastStep?: number; updatedAt?: string };

interface StoredDraft {
  draft: BountyDraft;
  lastStep: number | null;
  updatedAt: string | null;
}

function decodeStoredDraft(raw: string | null): StoredDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { lastStep, updatedAt, ...draft } = parsed as StoredDraftRecord;
    return {
      draft: { ...defaultDraft, ...draft },
      lastStep: typeof lastStep === 'number' ? clampStep(lastStep) : null,
      updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
    };
  } catch {
    return null;
  }
}

function encodeStoredDraft(copy: DraftCopy): string {
  const record: StoredDraftRecord = { ...copy.draft, lastStep: copy.lastStep };
  if (copy.updatedAt) record.updatedAt = copy.updatedAt;
  return JSON.stringify(record);
}

/** Record that the server now holds the copy last edited at `updatedAt`. */
async function markDraftSynced(userId: string, updatedAt: string): Promise<void> {
  await storage.setItem(syncedKey(userId), updatedAt);
  // A pending delete marker is moot once a newer copy has overwritten the row.
  const cleared = await storage.getItem(clearedKey(userId));
  if (cleared && Date.parse(cleared) < Date.parse(updatedAt)) {
    await storage.removeItem(clearedKey(userId));
  }
}

/** Delete the server copy; drop the delete marker once the server confirms. */
function deleteServerCopy(userId: string, clearedAt: string | null): void {
  void deleteServerDraft(userId).then(async (ok) => {
    if (!ok) return;
    if (clearedAt === null || (await storage.getItem(clearedKey(userId))) === clearedAt) {
      await storage.removeItem(clearedKey(userId));
    }
  });
}

/**
 * Whether a draft holds a post the poster has actually started. The title is
 * the bar — the same one CreateBountyFlow uses for `resumed_draft` — so a
 * template tap counts, while a draft holding only defaults does not.
 */
export function isBountyDraftInProgress(draft: Partial<BountyDraft> | null | undefined): boolean {
  return Boolean(draft?.title?.trim());
}

// The composer's draft lives in one useBountyDraft instance, but other
// surfaces (the Post tab's "unfinished post" dot) need to know whether one is
// in progress. Every save and clear broadcasts here so they follow along
// without re-reading storage on each keystroke.
type DraftPresenceListener = (draftKey: string, inProgress: boolean) => void;
const draftPresenceListeners = new Set<DraftPresenceListener>();

function notifyDraftPresence(draftKey: string, inProgress: boolean) {
  draftPresenceListeners.forEach((listener) => listener(draftKey, inProgress));
}

/**
 * Remove a user's draft from THIS DEVICE (sign-out, user switch). Safe to call
 * outside React. The server copy is kept on purpose: it is what lets the
 * poster pick the draft up after signing in again, here or elsewhere.
 */
export async function clearBountyDraftForUser(userId?: string): Promise<void> {
  try {
    // The session is already gone, so a pending upload would only be refused.
    cancelServerDraftUpsert(userId);
    await storage.removeItem(getDraftKey(userId));
    notifyDraftPresence(getDraftKey(userId), false);
    if (userId) {
      await storage.removeItem(syncedKey(userId));
      await cancelDraftReminder(userId);
      await clearDraftAbandoned(userId);
    }
  } catch (error) {
    console.error('Failed to clear bounty draft for user', userId ?? '(anonymous)', ':', error);
  }
}

/**
 * `userId`'s saved device draft and the step it was left on, when it holds a
 * post in progress, else null. Read once from storage, outside React.
 */
export async function readSavedBountyDraft(
  userId?: string
): Promise<{ draft: BountyDraft; lastStep: number | null } | null> {
  const saved = decodeStoredDraft(await storage.getItem(getDraftKey(userId)));
  if (!saved || !isBountyDraftInProgress(saved.draft)) return null;
  return { draft: saved.draft, lastStep: saved.lastStep };
}

/**
 * `userId`'s saved draft when it holds a post in progress, else null. Read
 * once from storage, outside React — for surfaces that only need to know
 * what is waiting.
 */
export async function readBountyDraftInProgress(userId?: string): Promise<BountyDraft | null> {
  return (await readSavedBountyDraft(userId))?.draft ?? null;
}

/**
 * Whether `userId` has an unfinished post saved — read from storage once, then
 * kept current by the composer's saves and clears. Read-only: it never loads
 * or writes the draft itself.
 */
export function useBountyDraftInProgress(userId?: string): boolean {
  const draftKey = getDraftKey(userId);
  const [inProgress, setInProgress] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // A broadcast that lands before the storage read finishes is newer than
    // whatever that read returns, so it wins.
    let heardBroadcast = false;
    const listener: DraftPresenceListener = (key, next) => {
      if (key !== draftKey) return;
      heardBroadcast = true;
      setInProgress(next);
    };
    draftPresenceListeners.add(listener);
    setInProgress(false);

    (async () => {
      try {
        const saved = await storage.getItem(draftKey);
        if (cancelled || heardBroadcast) return;
        setInProgress(saved ? isBountyDraftInProgress(JSON.parse(saved)) : false);
      } catch {
        // An unreadable draft is treated as no draft — this only drives a hint.
      }
    })();

    return () => {
      cancelled = true;
      draftPresenceListeners.delete(listener);
    };
  }, [draftKey]);

  return inProgress;
}

export interface BountyDraft {
  title: string;
  category?: string;
  requirements?: import('../../lib/capabilities').BountyRequirementsInput | null;
  description: string;
  amount: number;
  isForHonor: boolean;
  location: string;
  // ZIP of the bounty's own address, from the picked place or the geocoder
  // (StepWhere). Drives the exact-ZIP "New Bounty Near You" match, so it
  // must never come from anywhere but this address.
  zipCode?: string;
  // Exact-precision coordinates + unit, set by the map location picker.
  // Privacy-sensitive: only ever shown to the poster and the accepted
  // hunter post-acceptance (see get_bounty_exact_location() RPC).
  latitude?: number;
  longitude?: number;
  unit?: string;
  neighborhood?: string;
  workType: 'online' | 'in_person';
  timeline?: string;
  skills?: string;
  attachments?: Attachment[];
  // Structured schedule (Phase 1: time as first-class citizen)
  scheduleType?: 'asap' | 'scheduled' | 'flexible';
  startDate?: string;           // ISO 8601
  endDate?: string;             // ISO 8601
  latestArrivalTime?: string;   // ISO 8601
  durationMinutes?: number;
  conditionalEndNote?: string;
  // Bounty-level trust requirement system (see lib/utils/trust-tier.ts).
  // Poster-controlled, seeded from detectTrustTier's recommendation at the
  // review step; 'standard'/false when never touched.
  trustTier?: TrustTier;
  requiresIdVerified?: boolean;
}

const defaultDraft: BountyDraft = {
  title: '',
  category: '',
  description: '',
  amount: 0,
  isForHonor: false,
  location: '',
  zipCode: '',
  latitude: undefined,
  longitude: undefined,
  unit: undefined,
  neighborhood: undefined,
  workType: 'in_person',
  timeline: '',
  skills: '',
  attachments: [],
  scheduleType: undefined,
  startDate: undefined,
  endDate: undefined,
  latestArrivalTime: undefined,
  durationMinutes: undefined,
  conditionalEndNote: undefined,
};

/** Which copy the composer opened: this device's, the server's, or none. */
export type BountyDraftSource = 'local' | 'server' | null;

/**
 * The composer's draft. The device copy is written at once on every change;
 * the server copy (public.bounty_drafts, lib/services/bounty-draft-sync.ts)
 * follows 2 s after the last one. On load the newer of the two wins, so a
 * draft started on one device opens on another after sign-in.
 */
export function useBountyDraft(userId?: string) {
  const draftKey = getDraftKey(userId);
  const [draft, setDraftState] = useState<BountyDraft>(defaultDraft);
  // The latest draft, updated synchronously. saveDraft merges against this
  // rather than reading the value out of a setState updater: React defers an
  // updater when another update is already pending in the same event (a
  // template tap marks the composer started, then saves), so the value it
  // captured was still undefined when written and storage got "undefined".
  const draftRef = useRef<BountyDraft>(defaultDraft);
  const setDraft = useCallback((next: BountyDraft) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);
  // The composer step the draft was left on. Read once, when the composer
  // opens, to put the poster back there.
  const [lastStep, setLastStepState] = useState(1);
  const lastStepRef = useRef(1);
  const [source, setSource] = useState<BountyDraftSource>(null);
  const [isLoading, setIsLoading] = useState(true);
  // The key the current draft was loaded for. Until it matches, the hook is
  // loading — including the render in which userId changes, before the load
  // effect has run.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // Counter ref to sequence async loads and ignore stale results
  const loadRequestCounterRef = useRef(0);

  const applyCopy = useCallback(
    (copy: DraftCopy | null, from: BountyDraftSource) => {
      const nextDraft = copy ? { ...defaultDraft, ...copy.draft } : defaultDraft;
      // Drafts saved before lastStep existed reopen on the first step they
      // still need, as the old "Continue your post" banner offered.
      const step = copy ? clampStep(copy.lastStep ?? resumeStepForDraft(nextDraft)) : 1;
      setDraft(nextDraft);
      lastStepRef.current = step;
      setLastStepState(step);
      setSource(copy ? from : null);
    },
    [setDraft]
  );

  // Load on mount (re-runs when userId changes): the device copy, then the
  // server's, bounded by SERVER_DRAFT_FETCH_TIMEOUT_MS. The Post tab is
  // preloaded beside Home, so the wait is normally over before anyone looks.
  useEffect(() => {
    // Mark loading and capture a request id. If a new effect runs or the
    // component unmounts, incrementing the counter will make this request stale.
    setIsLoading(true);
    const requestId = ++loadRequestCounterRef.current;
    const isStale = () => loadRequestCounterRef.current !== requestId;

    (async () => {
      try {
        const local = decodeStoredDraft(await storage.getItem(draftKey));
        const [synced, cleared] = userId
          ? await Promise.all([storage.getItem(syncedKey(userId)), storage.getItem(clearedKey(userId))])
          : [null, null];
        const localCopy: DraftCopy | null = local
          ? { draft: local.draft, lastStep: local.lastStep ?? resumeStepForDraft(local.draft), updatedAt: local.updatedAt }
          : null;
        const server: ServerDraftFetch = userId ? await fetchServerDraft(userId) : { status: 'unavailable' };
        if (isStale()) return;

        const resolution = resolveDraftCopies(localCopy, synced, cleared, server);
        let opened = resolution.copy;

        if (resolution.winner === 'server' && opened) {
          // Keep it on this device too, so it survives going offline.
          await storage.setItem(draftKey, encodeStoredDraft(opened));
          if (userId && opened.updatedAt) await storage.setItem(syncedKey(userId), opened.updatedAt);
        } else if (resolution.winner === 'local' && opened && opened.updatedAt === null) {
          // A draft from before sync existed: date it now so it can be compared.
          opened = { ...opened, updatedAt: new Date().toISOString() };
          await storage.setItem(draftKey, encodeStoredDraft(opened));
        }
        if (userId) {
          if (resolution.clearLocal) {
            await storage.removeItem(draftKey);
            await storage.removeItem(syncedKey(userId));
            void cancelDraftReminder(userId);
            void clearDraftAbandoned(userId);
          }
          if (resolution.forgetCleared && cleared) await storage.removeItem(clearedKey(userId));
          if (resolution.deleteServer) deleteServerCopy(userId, cleared);
          if (resolution.pushLocal && opened) {
            scheduleServerDraftUpsert(userId, opened, (at) => void markDraftSynced(userId, at));
          }
        }
        if (isStale()) return;

        applyCopy(opened, resolution.winner === 'server' ? 'server' : 'local');
        notifyDraftPresence(draftKey, Boolean(opened && isBountyDraftInProgress(opened.draft)));
      } catch (error) {
        if (!isStale()) {
          console.error('Failed to load bounty draft:', error);
        }
      } finally {
        if (!isStale()) {
          setLoadedKey(draftKey);
          setIsLoading(false);
        }
      }
    })();

    // Cleanup: bump the counter to invalidate any in-flight requests from
    // this effect when it re-runs or on unmount. Leaving the composer sends
    // the pending server write now instead of waiting out the debounce.
    return () => {
      loadRequestCounterRef.current++;
      void flushServerDraftUpsert(userId);
    };
  }, [draftKey, userId, applyCopy]);

  /** Write the current draft + step to this device now, and to the server soon. */
  const persist = useCallback(
    async (nextDraft: BountyDraft) => {
      const copy: DraftCopy = {
        draft: nextDraft,
        lastStep: lastStepRef.current,
        updatedAt: new Date().toISOString(),
      };
      await storage.setItem(draftKey, encodeStoredDraft(copy));
      if (userId) scheduleServerDraftUpsert(userId, copy, (at) => void markDraftSynced(userId, at));
    },
    [draftKey, userId]
  );

  // Save draft to AsyncStorage
  const saveDraft = useCallback(async (draftData: Partial<BountyDraft>) => {
    try {
      // Merge against the latest draft (draftRef, not render-time state) so
      // several saves in one tick all survive, and persist that same value.
      const updatedValue: BountyDraft = { ...draftRef.current, ...draftData };
      const inProgress = isBountyDraftInProgress(updatedValue);
      setDraft(updatedValue);
      notifyDraftPresence(draftKey, inProgress);
      await persist(updatedValue);
      // The 24h "your draft is waiting" reminder follows the last edit.
      if (userId) {
        if (inProgress) scheduleDraftReminderSoon(userId, updatedValue);
        else void cancelDraftReminder(userId);
      }
    } catch (error) {
      console.error('Failed to save bounty draft:', error);
    }
  }, [draftKey, setDraft, userId, persist]);

  /**
   * Record the step the poster moved to, so leaving and coming back (or
   * opening the draft on another device) lands there. Only for a post in
   * progress: an empty composer has nothing to come back to.
   */
  const saveStep = useCallback(async (step: number) => {
    const next = clampStep(step);
    if (next === lastStepRef.current) return;
    lastStepRef.current = next;
    setLastStepState(next);
    if (!isBountyDraftInProgress(draftRef.current)) return;
    try {
      await persist(draftRef.current);
    } catch (error) {
      console.error('Failed to save bounty draft step:', error);
    }
  }, [persist]);

  // Clear the draft on this device and on the server (publish, "Start over").
  const clearDraft = useCallback(async () => {
    try {
      const clearedAt = new Date().toISOString();
      setDraft(defaultDraft);
      lastStepRef.current = 1;
      setLastStepState(1);
      setSource(null);
      notifyDraftPresence(draftKey, false);
      await storage.removeItem(draftKey);
      // Published or discarded: nothing left to remind about, and no draft
      // for the app-open resume prompt to offer.
      if (userId) {
        await storage.removeItem(syncedKey(userId));
        // Kept until the server confirms the delete, so a copy left behind by
        // a failed delete (offline publish) is deleted on the next load rather
        // than restored.
        await storage.setItem(clearedKey(userId), clearedAt);
        deleteServerCopy(userId, clearedAt);
        await cancelDraftReminder(userId);
        await clearDraftAbandoned(userId);
      }
    } catch (error) {
      console.error('Failed to clear bounty draft:', error);
    }
  }, [draftKey, setDraft, userId]);

  return {
    draft,
    /** The step the loaded draft was left on (1 for no draft). */
    lastStep,
    /** Which copy was opened. */
    source,
    saveDraft,
    saveStep,
    clearDraft,
    isLoading: isLoading || loadedKey !== draftKey,
  };
}

export default useBountyDraft;
