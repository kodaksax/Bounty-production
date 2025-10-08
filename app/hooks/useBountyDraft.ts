import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const DRAFT_KEY = 'bounty-draft-v1';

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
};

export function useBountyDraft() {
  const [draft, setDraft] = useState<BountyDraft>(defaultDraft);
  const [isLoading, setIsLoading] = useState(true);

  // Load draft from AsyncStorage on mount
  useEffect(() => {
    (async () => {
      try {
        const savedDraft = await AsyncStorage.getItem(DRAFT_KEY);
        if (savedDraft) {
          setDraft(JSON.parse(savedDraft));
        }
      } catch (error) {
        console.warn('Failed to load bounty draft:', error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Save draft to AsyncStorage
  const saveDraft = useCallback(async (draftData: Partial<BountyDraft>) => {
    try {
      const updated = { ...draft, ...draftData };
      setDraft(updated);
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(updated));
    } catch (error) {
      console.warn('Failed to save bounty draft:', error);
    }
  }, [draft]);

  // Clear draft from AsyncStorage
  const clearDraft = useCallback(async () => {
    try {
      setDraft(defaultDraft);
      await AsyncStorage.removeItem(DRAFT_KEY);
    } catch (error) {
      console.warn('Failed to clear bounty draft:', error);
    }
  }, []);

  return {
    draft,
    saveDraft,
    clearDraft,
    isLoading,
  };
}
