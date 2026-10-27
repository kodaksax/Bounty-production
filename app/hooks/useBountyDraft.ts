import { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from '../../lib/storage';
import type { Attachment } from '../../lib/types';
import type { TrustTier } from '../../lib/utils/trust-tier';

const DRAFT_KEY_PREFIX = 'bounty-draft-v1';

function getDraftKey(userId?: string): string {
  return userId ? `${DRAFT_KEY_PREFIX}:${userId}` : DRAFT_KEY_PREFIX;
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
 * Standalone function to clear a specific user's bounty draft from storage.
 * Safe to call outside of React (e.g. from auth-provider on sign-out).
 */
export async function clearBountyDraftForUser(userId?: string): Promise<void> {
  try {
    await storage.removeItem(getDraftKey(userId));
    notifyDraftPresence(getDraftKey(userId), false);
  } catch (error) {
    console.error('Failed to clear bounty draft for user', userId ?? '(anonymous)', ':', error);
  }
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
  const [isLoading, setIsLoading] = useState(true);
  // Counter ref to sequence async loads and ignore stale results
  const loadRequestCounterRef = useRef(0);

  // Load draft from AsyncStorage on mount (re-runs when userId changes)
  useEffect(() => {
    // Mark loading and capture a request id. If a new effect runs or the
    // component unmounts, incrementing the counter will make this request stale.
    setIsLoading(true);
    const requestId = ++loadRequestCounterRef.current;

    (async () => {
      try {
        const savedDraft = await storage.getItem(draftKey);

        // If another load started since this one, ignore the result.
        if (loadRequestCounterRef.current !== requestId) return;

        if (savedDraft) {
          setDraft(JSON.parse(savedDraft));
        } else {
          // No draft for this user — start fresh
          setDraft(defaultDraft);
        }
      } catch (error) {
        if (loadRequestCounterRef.current === requestId) {
          console.error('Failed to load bounty draft:', error);
        }
      } finally {
        if (loadRequestCounterRef.current === requestId) {
          setIsLoading(false);
        }
      }
    })();

    // Cleanup: bump the counter to invalidate any in-flight requests from
    // this effect when it re-runs or on unmount.
    return () => {
      loadRequestCounterRef.current++;
    };
  }, [draftKey, setDraft]);

  // Save draft to AsyncStorage
  const saveDraft = useCallback(async (draftData: Partial<BountyDraft>) => {
    try {
      // Merge against the latest draft (draftRef, not render-time state) so
      // several saves in one tick all survive, and persist that same value.
      const updatedValue: BountyDraft = { ...draftRef.current, ...draftData };
      setDraft(updatedValue);
      notifyDraftPresence(draftKey, isBountyDraftInProgress(updatedValue));
      await storage.setItem(draftKey, JSON.stringify(updatedValue));
    } catch (error) {
      console.error('Failed to save bounty draft:', error);
    }
  }, [draftKey, setDraft]);

  // Clear draft from AsyncStorage
  const clearDraft = useCallback(async () => {
    try {
      setDraft(defaultDraft);
      notifyDraftPresence(draftKey, false);
      await storage.removeItem(draftKey);
    } catch (error) {
      console.error('Failed to clear bounty draft:', error);
    }
  }, [draftKey, setDraft]);

  return {
    draft,
    saveDraft,
    clearDraft,
    isLoading,
  };
}

export default useBountyDraft;
