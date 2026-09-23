/**
 * Onboarding Context
 * Manages state across onboarding flow screens to preserve data when navigating back
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from '../../hooks/use-auth-context';

export const ONBOARDING_STATE_KEY_BASE = '@bounty_onboarding_state';

/**
 * Bumped whenever OnboardingData's shape or the onboarding flow itself
 * changes meaningfully enough that a returning user's in-progress draft
 * should be discarded rather than resumed. Written to
 * `profiles.onboarding_version` on completion (see
 * hooks/useCompleteOnboarding.ts) so future onboarding redesigns can detect
 * which flow a user completed.
 *
 * 2 (2026-09-23): the funnel now ends on the founder note. Every screen after
 * it — the profile details form, the poster's first-bounty composer, the
 * hunter's nearby-discovery and sample application, phone capture and the
 * done summary — was removed, along with the draft fields only those screens
 * wrote. A v1 draft resumed under v2 therefore carries fields that no longer
 * exist, which the load path drops on merge.
 */
export const CURRENT_ONBOARDING_VERSION = 2;

// Debounce persistence so rapid keystrokes (e.g. typing bio/skills) don't each
// trigger a disk write. Short enough that a user who stops typing still sees
// their progress persisted almost immediately.
const PERSIST_DEBOUNCE_MS = 400;

/**
 * The AsyncStorage key for a given account's in-progress onboarding draft
 * (or the shared pre-auth draft when `userId` is null). Exported so account
 * deletion (lib/services/account-deletion-service.ts) can remove a user's
 * draft without duplicating this key format — a prior duplicate list drifted
 * out of sync with the real keys and silently stopped clearing anything.
 */
export function storageKeyFor(userId: string | null | undefined): string {
  return userId ? `${ONBOARDING_STATE_KEY_BASE}:${userId}` : ONBOARDING_STATE_KEY_BASE;
}

export interface OnboardingData {
  // Welcome screen — which of the two entry CTAs the user picked.
  // 'poster' = "Get something done", 'hunter' = "Start earning nearby"
  intent: 'poster' | 'hunter' | null;

  // Profile fields. Nothing in the funnel collects these any more (the details
  // form was removed with the post-founder-note screens); they stay because
  // useCompleteOnboarding still writes whichever are non-empty to the profile,
  // so a draft left by an older build is still honoured on completion.
  displayName: string;
  title: string;
  bio: string;
  /** The only one still written in-flow: app/onboarding/location.tsx sets it. */
  location: string;
  skills: string[];
  avatarUri: string;
  
  // Location step (app/onboarding/location.tsx), which sits between the style
  // step and role select. 'precise' = full GPS granted, 'approximate' = the
  // user chose the coarse option, so only a city/region is ever resolved,
  // 'denied' = the OS prompt was declined, 'skipped' = dismissed without
  // answering. Null until the step has been answered once.
  locationPrecision: 'precise' | 'approximate' | 'denied' | 'skipped' | null;

  // Same as the profile fields above: no screen collects a phone number any
  // more, but a draft that has one still gets written through on completion.
  phone: string;
}

const defaultOnboardingData: OnboardingData = {
  intent: null,
  displayName: '',
  title: '',
  bio: '',
  location: '',
  skills: [],
  avatarUri: '',
  locationPrecision: null,
  phone: '',
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

  // Persist state on changes, debounced so typing doesn't write to disk on
  // every keystroke. dataRef always holds the latest value so the unmount
  // flush below never writes stale data.
  const dataRef = useRef(data);
  dataRef.current = data;
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading || !loadedKeyRef.current) return;

    const key = loadedKeyRef.current;
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      AsyncStorage.setItem(key, JSON.stringify(data)).catch((error) => {
        console.error('[OnboardingContext] Error saving state:', error);
      });
    }, PERSIST_DEBOUNCE_MS);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [data, loading]);

  // Flush any pending debounced write immediately on unmount so navigating
  // away right after typing never loses the last keystrokes.
  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        AsyncStorage.setItem(loadedKeyRef.current || ONBOARDING_STATE_KEY_BASE, JSON.stringify(dataRef.current)).catch((error) => {
          console.error('[OnboardingContext] Error saving state on unmount:', error);
        });
      }
    };
  }, []);

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

  const value = useMemo(
    () => ({ data, updateData, clearData, loading }),
    [data, updateData, clearData, loading]
  );

  return (
    <OnboardingContext.Provider value={value}>
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
