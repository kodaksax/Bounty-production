/**
 * Regression coverage for the reported beta bug:
 * "successful account creation sends the user back to the Welcome/Login screen".
 *
 * app/onboarding/index.tsx is the gate every post-registration navigation used
 * to funnel through. It routed to `/onboarding/welcome` whenever the local
 * onboarding draft had no `intent` — and `/onboarding/welcome` is the PRE-AUTH
 * screen (role CTAs + a "Log In" button). A brand-new, fully-authenticated user
 * therefore landed on a screen telling them to sign in.
 *
 * `intent` is absent far more often than it looks:
 *   - the 'onboarding-skip-role-selection' TEST arm never sets one (its single
 *     "Get started" CTA skips role selection entirely), so every user in that
 *     arm hit this,
 *   - the draft is persisted with a 400ms debounce and migrated from an
 *     anonymous key to a user-scoped one once a session appears — any failure
 *     or interruption in that chain loses it.
 *
 * The invariant these tests lock in: a signed-in user is NEVER routed to
 * /onboarding/welcome, whatever the draft or the profile says.
 */

import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
}));

const mockAuthContext = {
  session: null as any,
  isLoading: false,
};
jest.mock('hooks/use-auth-context', () => ({
  useAuthContext: () => mockAuthContext,
}));

const mockAuthProfile = {
  profile: null as any,
  loading: false,
  profileFetchError: null as string | null,
  refreshProfile: jest.fn().mockResolvedValue(undefined),
};
jest.mock('hooks/useAuthProfile', () => ({
  useAuthProfile: () => mockAuthProfile,
}));

const mockOnboarding = {
  data: { intent: null as 'poster' | 'hunter' | null },
  loading: false,
};
jest.mock('lib/context/onboarding-context', () => ({
  useOnboarding: () => mockOnboarding,
}));

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

const mockHasLocalOnboardingFlag = jest.fn().mockResolvedValue(false);
jest.mock('lib/storage/onboarding', () => ({
  hasLocalOnboardingFlag: (...args: unknown[]) => mockHasLocalOnboardingFlag(...args),
}));

jest.mock('lib/utils/error-logger', () => ({
  logger: { warning: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

// Imported after the mocks so the module picks them up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OnboardingIndex = require('../../../app/onboarding/index').default;

const SIGNED_IN = { user: { id: 'user-abc' } };

function resetState() {
  mockReplace.mockClear();
  mockAuthContext.session = null;
  mockAuthContext.isLoading = false;
  mockAuthProfile.profile = null;
  mockAuthProfile.loading = false;
  mockAuthProfile.profileFetchError = null;
  mockOnboarding.data.intent = null;
  mockOnboarding.loading = false;
  mockHasLocalOnboardingFlag.mockClear().mockResolvedValue(false);
}

describe('onboarding gate (app/onboarding/index.tsx)', () => {
  beforeEach(resetState);

  describe('authenticated user (the Bug A path)', () => {
    it('routes a freshly registered user with NO intent into onboarding, not Welcome', async () => {
      mockAuthContext.session = SIGNED_IN;
      // Brand-new account: the backend created the row with onboarding_completed false.
      mockAuthProfile.profile = { username: 'newuser', onboarding_completed: false };
      mockOnboarding.data.intent = null;

      render(<OnboardingIndex />);

      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      expect(mockReplace).toHaveBeenCalledWith('/onboarding/style');
      expect(mockReplace).not.toHaveBeenCalledWith('/onboarding/welcome');
    });

    it('routes a signed-in user with no profile row yet into onboarding, not Welcome', async () => {
      mockAuthContext.session = SIGNED_IN;
      mockAuthProfile.profile = null;
      mockOnboarding.data.intent = null;

      render(<OnboardingIndex />);

      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      expect(mockReplace).toHaveBeenCalledWith('/onboarding/style');
      expect(mockReplace).not.toHaveBeenCalledWith('/onboarding/welcome');
    });

    it('resumes a signed-in user who already picked a role', async () => {
      mockAuthContext.session = SIGNED_IN;
      mockAuthProfile.profile = { username: 'newuser', onboarding_completed: false };
      mockOnboarding.data.intent = 'poster';

      render(<OnboardingIndex />);

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/onboarding/style'));
      expect(mockReplace).not.toHaveBeenCalledWith('/onboarding/welcome');
    });

    it('sends an already-onboarded user straight to the app', async () => {
      mockAuthContext.session = SIGNED_IN;
      mockAuthProfile.profile = { username: 'veteran', onboarding_completed: true };

      render(<OnboardingIndex />);

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app'));
    });

    it('trusts the local completion flag when the Supabase write never landed', async () => {
      // done.tsx writes the AsyncStorage flag before/independently of the
      // profile write; a failed profile write must not walk the user back
      // through onboarding on their next entry.
      mockAuthContext.session = SIGNED_IN;
      mockAuthProfile.profile = { username: 'veteran', onboarding_completed: false };
      mockHasLocalOnboardingFlag.mockResolvedValue(true);

      render(<OnboardingIndex />);

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app'));
    });

    it('never falls through to Welcome when the routing logic throws', async () => {
      mockAuthContext.session = SIGNED_IN;
      mockAuthProfile.profile = { username: 'newuser', onboarding_completed: false };
      mockHasLocalOnboardingFlag.mockRejectedValue(new Error('storage exploded'));

      render(<OnboardingIndex />);

      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      expect(mockReplace).not.toHaveBeenCalledWith('/onboarding/welcome');
    });
  });

  describe('gating on unsettled state', () => {
    it('does not route while auth is still initializing', async () => {
      mockAuthContext.isLoading = true;
      mockAuthContext.session = null;

      render(<OnboardingIndex />);

      await new Promise(resolve => setTimeout(resolve, 20));
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('does not route while the profile fetch is still unresolved', async () => {
      mockAuthContext.session = SIGNED_IN;
      mockAuthProfile.loading = true;

      render(<OnboardingIndex />);

      await new Promise(resolve => setTimeout(resolve, 20));
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('does not route while the local onboarding draft is still loading', async () => {
      mockAuthContext.session = SIGNED_IN;
      mockOnboarding.loading = true;

      render(<OnboardingIndex />);

      await new Promise(resolve => setTimeout(resolve, 20));
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('unauthenticated visitor', () => {
    it('starts a genuine first-time visitor at Welcome', async () => {
      mockAuthContext.session = null;
      mockOnboarding.data.intent = null;

      render(<OnboardingIndex />);

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/onboarding/welcome'));
    });

    it('resumes a logged-out visitor who already picked a role at the sign-in step', async () => {
      mockAuthContext.session = null;
      mockOnboarding.data.intent = 'hunter';

      render(<OnboardingIndex />);

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/onboarding/username'));
    });
  });

  describe('profile fetch failure', () => {
    it('retries rather than guessing, and never routes to Welcome for a signed-in user', async () => {
      mockAuthContext.session = SIGNED_IN;
      mockAuthProfile.profile = null;
      mockAuthProfile.profileFetchError = 'network down';

      render(<OnboardingIndex />);

      await waitFor(() => expect(mockAuthProfile.refreshProfile).toHaveBeenCalled());
      expect(mockReplace).not.toHaveBeenCalledWith('/onboarding/welcome');
    });
  });
});
