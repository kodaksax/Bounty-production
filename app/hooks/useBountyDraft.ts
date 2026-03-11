import { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from '../../lib/storage';
import type { Attachment } from '../../lib/types';

const DRAFT_KEY_PREFIX = 'bounty-draft-v1';

function getDraftKey(userId?: string): string {
  return userId ? `${DRAFT_KEY_PREFIX}:${userId}` : DRAFT_KEY_PREFIX;
}

/**
 * Standalone function to clear a specific user's bounty draft from storage.
 * Safe to call outside of React (e.g. from auth-provider on sign-out).
 */
export async function clearBountyDraftForUser(userId?: string): Promise<void> {
  try {
    await storage.removeItem(getDraftKey(userId));
  } catch (error) {
    console.error('Failed to clear bounty draft for user', userId ?? '(anonymous)', ':', error);
  }
}

export interface BountyDraft {
  title: string;
  category?: string;
  description: string;
  amount: number;
  isForHonor: boolean;
  location: string;
  workType: 'online' | 'in_person';
  timeline?: string;
  skills?: string;
  attachments?: Attachment[];
}

const defaultDraft: BountyDraft = {
  title: '',
  category: '',
  description: '',
  amount: 0,
  isForHonor: false,
  location: '',
  workType: 'in_person',
  timeline: '',
  skills: '',
  attachments: [],
};

export function useBountyDraft(userId?: string) {
  const draftKey = getDraftKey(userId);
  const [draft, setDraft] = useState<BountyDraft>(defaultDraft);
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
  }, [draftKey]);

  // Save draft to AsyncStorage
  const saveDraft = useCallback(async (draftData: Partial<BountyDraft>) => {
    try {
      // Use a functional update so we always merge against the latest state
      // even if multiple updates are queued. Capture the derived value and
      // persist that exact snapshot to storage to avoid races.
      let updatedValue: BountyDraft | undefined;
      setDraft(prev => {
        updatedValue = { ...prev, ...draftData };
        return updatedValue;
      });

      // Persist the value derived from the same `prev` snapshot.
      await storage.setItem(draftKey, JSON.stringify(updatedValue!));
    } catch (error) {
      console.error('Failed to save bounty draft:', error);
    }
  }, [draftKey]);

  // Clear draft from AsyncStorage
  const clearDraft = useCallback(async () => {
    try {
      setDraft(defaultDraft);
      await storage.removeItem(draftKey);
    } catch (error) {
      console.error('Failed to clear bounty draft:', error);
    }
  }, [draftKey]);

  return {
    draft,
    saveDraft,
    clearDraft,
    isLoading,
  };
}

export default useBountyDraft;
