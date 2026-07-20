/**
 * Onboarding Context
 * Manages state across onboarding flow screens to preserve data when navigating back
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuthContext } from '../../hooks/use-auth-context';

const ONBOARDING_STATE_KEY_BASE = '@bounty_onboarding_state';

/**
 * Bumped whenever OnboardingData's shape or the onboarding flow itself
 * changes meaningfully enough that a returning user's in-progress draft
 * should be discarded rather than resumed. Written to
 * `profiles.onboarding_version` on completion (see app/onboarding/done.tsx)
 * so future onboarding redesigns can detect which flow a user completed.
 */
export const CURRENT_ONBOARDING_VERSION = 1;

function storageKeyFor(userId: string | null | undefined): string {
  return userId ? `${ONBOARDING_STATE_KEY_BASE}:${userId}` : ONBOARDING_STATE_KEY_BASE;
}

export interface OnboardingData {
  // Welcome screen — which of the two entry CTAs the user picked.
  // 'poster' = "Get something done", 'hunter' = "Start earning nearby"
  intent: 'poster' | 'hunter' | null;

  // Details screen
  displayName: string;
  title: string;
  bio: string;
  location: string;
  skills: string[];
  avatarUri: string;
  
  // Phone screen
  phone: string;

  // Poster task-prompt screen (details, when intent === 'poster')
  taskDescription: string;
  price: string;
  schedule: 'saturday' | 'flexible' | null;

  // Set immediately after the onboarding poster flow successfully creates a
  // bounty (details.tsx createBountyNow). Used to (a) redirect straight to
  // /onboarding/bounty-posted instead of re-rendering the composer if the
  // user navigates back into details.tsx, preventing a duplicate bounty, and
  // (b) let bounty-posted.tsx render a summary of what was just posted.
  firstBountyPostedId: string | null;
  firstBountyPostedTitle: string | null;
  firstBountyPostedAmount: number | null;

  // Set immediately after the onboarding hunter flow successfully applies to
  // a sample bounty (details.tsx handleApplyToSample). Used to (a) redirect
  // straight to /onboarding/application-submitted instead of re-rendering the
  // sample-bounty screen if the user navigates back into details.tsx,
  // preventing a duplicate application, and (b) let application-submitted.tsx
  // track/reference what was just applied to.
  firstAppliedBountyId: string | null;
  firstAppliedBountyTitle: string | null;
  firstBountyRequestId: string | null;
}

const defaultOnboardingData: OnboardingData = {
  intent: null,
  displayName: '',
  title: '',
  bio: '',
  location: '',
  skills: [],
  avatarUri: '',
  phone: '',
  taskDescription: '',
  price: '',
  schedule: null,
  firstBountyPostedId: null,
  firstBountyPostedTitle: null,
  firstBountyPostedAmount: null,
  firstAppliedBountyId: null,
  firstAppliedBountyTitle: null,
  firstBountyRequestId: null,
};

interface OnboardingContextType {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  clearData: () => Promise<void>;
  loading: boolean;
}

const OnboardingContext = createContext<OnboardingContextType | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  // Scope the draft to whichever account is currently signed in. Onboarding
  // starts before auth (welcome.tsx picks an intent pre-login), so an
  // "anonymous" draft is written first under the base key; once a session
  // resolves we migrate that draft onto the user-scoped key so it isn't lost,
  // then remove the anon copy. This prevents a second, different account
  // signing in on the same device from inheriting the first account's
  // abandoned draft (bio, intent, task description, etc).
  const { session } = useAuthContext();
  const userId = session?.user?.id ?? null;

  const [data, setData] = useState<OnboardingData>(defaultOnboardingData);
  const [loading, setLoading] = useState(true);
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = storageKeyFor(userId);
    if (loadedKeyRef.current === key) return;

    let cancelled = false;
    const loadState = async () => {
      setLoading(true);
      try {
        let stored = await AsyncStorage.getItem(key);

        if (!stored && userId) {
          const anonDraft = await AsyncStorage.getItem(ONBOARDING_STATE_KEY_BASE);
          if (anonDraft) {
            await AsyncStorage.setItem(key, anonDraft);
            await AsyncStorage.removeItem(ONBOARDING_STATE_KEY_BASE);
            stored = anonDraft;
          }
        }

        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed && typeof parsed === 'object' && !cancelled) {
              setData({ ...defaultOnboardingData, ...parsed });
            }
          } catch (parseError) {
            console.error('[OnboardingContext] Error parsing stored state:', parseError);
            await AsyncStorage.removeItem(key);
            if (!cancelled) setData(defaultOnboardingData);
          }
        } else if (!cancelled) {
          setData(defaultOnboardingData);
        }
      } catch (error) {
        console.error('[OnboardingContext] Error loading state:', error);
      } finally {
        if (!cancelled) {
          loadedKeyRef.current = key;
          setLoading(false);
        }
      }
    };
    loadState();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Persist state on changes, to whichever key we most recently loaded.
  useEffect(() => {
    if (!loading && loadedKeyRef.current) {
      AsyncStorage.setItem(loadedKeyRef.current, JSON.stringify(data)).catch((error) => {
        console.error('[OnboardingContext] Error saving state:', error);
      });
    }
  }, [data, loading]);

  const updateData = useCallback((updates: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  }, []);

  const clearData = useCallback(async () => {
    try {
      const key = loadedKeyRef.current || storageKeyFor(userId);
      await AsyncStorage.removeItem(key);
      setData(defaultOnboardingData);
    } catch (error) {
      console.error('[OnboardingContext] Error clearing state:', error);
    }
  }, [userId]);

  return (
    <OnboardingContext.Provider value={{ data, updateData, clearData, loading }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextType {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}
