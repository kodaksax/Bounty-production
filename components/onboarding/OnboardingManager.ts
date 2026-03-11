// components/onboarding/OnboardingManager.ts
// Manages the contextual onboarding workflow for new users.
// Persists progress to AsyncStorage so it survives app restarts.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type OnboardingStep =
  | 'expand_bounty'
  | 'view_requests'
  | 'accept_hunter'
  | 'review_submission'
  | 'release_payment';

export type OnboardingState = Record<OnboardingStep, boolean>;

const STORAGE_KEY = '@bounty_workflow_onboarding';

const ORDERED_STEPS: OnboardingStep[] = [
  'expand_bounty',
  'view_requests',
  'accept_hunter',
  'review_submission',
  'release_payment',
];

const DEFAULT_STATE: OnboardingState = {
  expand_bounty: false,
  view_requests: false,
  accept_hunter: false,
  review_submission: false,
  release_payment: false,
};

type Listener = (state: OnboardingState) => void;

class OnboardingManager {
  private state: OnboardingState = { ...DEFAULT_STATE };
  private loaded = false;
  private listeners: Set<Listener> = new Set();

  /** Load persisted state. Call once on app boot (or lazily on first use). */
  async load(): Promise<OnboardingState> {
    if (this.loaded) return this.state;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<OnboardingState>;
        this.state = { ...DEFAULT_STATE, ...parsed };
      }
    } catch (e) {
      console.error('[OnboardingManager] Failed to load state from AsyncStorage:', e);
    }
    this.loaded = true;
    return this.state;
  }

  /** Mark a step as completed and persist. */
  async completeStep(step: OnboardingStep): Promise<void> {
    if (this.state[step]) return; // already completed — no-op
    this.state = { ...this.state, [step]: true };
    this.notify();
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('[OnboardingManager] Failed to persist step completion:', e);
    }
  }

  /** Returns the first incomplete step, or null if all steps are done. */
  getCurrentStep(): OnboardingStep | null {
    for (const step of ORDERED_STEPS) {
      if (!this.state[step]) return step;
    }
    return null;
  }

  /** Returns a copy of the current state. */
  getState(): OnboardingState {
    return { ...this.state };
  }

  /** Returns true when every step is completed. */
  isComplete(): boolean {
    return ORDERED_STEPS.every((s) => this.state[s]);
  }

  /** Reset all steps and persist. */
  async resetOnboarding(): Promise<void> {
    this.state = { ...DEFAULT_STATE };
    this.loaded = true;
    this.notify();
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('[OnboardingManager] Failed to reset onboarding state:', e);
    }
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.getState();
    this.listeners.forEach((l) => l(snapshot));
  }
}

/** Singleton instance shared across the app. */
export const onboardingManager = new OnboardingManager();

/** Ordered list of all steps (exported for use by UI components). */
export { ORDERED_STEPS };
