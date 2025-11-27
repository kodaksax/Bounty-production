/**
 * Onboarding Context
 * Manages state across onboarding flow screens to preserve data when navigating back
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ONBOARDING_STATE_KEY = '@bounty_onboarding_state';

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
          const parsed = JSON.parse(stored);
          setData({ ...defaultOnboardingData, ...parsed });
        }
      } catch (error) {
        console.error('[OnboardingContext] Error loading state:', error);
      } finally {
        setLoading(false);
      }
    };
    loadState();
  }, []);

  // Persist state on changes
  useEffect(() => {
    if (!loading) {
      AsyncStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(data)).catch((error) => {
        console.error('[OnboardingContext] Error saving state:', error);
      });
    }
  }, [data, loading]);

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
