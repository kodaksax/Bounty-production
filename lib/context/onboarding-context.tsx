/**
 * Onboarding Context
 * Manages state across onboarding flow screens to preserve data when navigating back
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ONBOARDING_STATE_KEY = '@bounty_onboarding_state';
// Debounce persistence so rapid keystrokes (e.g. typing bio/skills) don't each
// trigger a disk write. Short enough that a user who stops typing still sees
// their progress persisted almost immediately.
const PERSIST_DEBOUNCE_MS = 400;

export interface OnboardingData {
  // Username screen
  username: string;
  accepted: boolean;
  
  // Details screen
  displayName: string;
  title: string;
  bio: string;
  location: string;
  skills: string[];
  avatarUri: string;
  
  // Phone screen
  phone: string;
}

const defaultOnboardingData: OnboardingData = {
  username: '',
  accepted: false,
  displayName: '',
  title: '',
  bio: '',
  location: '',
  skills: [],
  avatarUri: '',
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
  const [data, setData] = useState<OnboardingData>(defaultOnboardingData);
  const [loading, setLoading] = useState(true);

  // Load persisted state on mount
  useEffect(() => {
    const loadState = async () => {
      try {
        const stored = await AsyncStorage.getItem(ONBOARDING_STATE_KEY);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            // Validate the parsed data has the expected structure
            if (parsed && typeof parsed === 'object') {
              setData({ ...defaultOnboardingData, ...parsed });
            }
          } catch (parseError) {
            console.error('[OnboardingContext] Error parsing stored state:', parseError);
            // Clear corrupted data
            await AsyncStorage.removeItem(ONBOARDING_STATE_KEY);
          }
        }
      } catch (error) {
        console.error('[OnboardingContext] Error loading state:', error);
      } finally {
        setLoading(false);
      }
    };
    loadState();
  }, []);

  // Persist state on changes, debounced so typing doesn't write to disk on
  // every keystroke. dataRef always holds the latest value so the unmount
  // flush below never writes stale data.
  const dataRef = useRef(data);
  dataRef.current = data;
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading) return;

    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      AsyncStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(data)).catch((error) => {
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
        AsyncStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(dataRef.current)).catch((error) => {
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
      await AsyncStorage.removeItem(ONBOARDING_STATE_KEY);
      setData(defaultOnboardingData);
    } catch (error) {
      console.error('[OnboardingContext] Error clearing state:', error);
    }
  }, []);

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
