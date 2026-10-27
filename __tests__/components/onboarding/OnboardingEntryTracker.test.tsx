/**
 * components/onboarding/OnboardingEntryTracker.tsx decides WHEN an onboarding
 * entry is recorded; lib/analytics/onboarding-entry.ts decides started vs
 * resumed (covered in __tests__/lib/analytics/onboarding-entry.test.ts).
 *
 * The bug this guards: onboarding_started lived in the /onboarding gate, which
 * the first-time Welcome route (app/index.tsx) and the sign-up route to
 * /onboarding/style both bypass, so ~87% of entrants never produced it.
 */

import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

let mockPathname = '/onboarding';
jest.mock('expo-router', () => ({
  usePathname: () => mockPathname,
}));

const mockAuthContext = { session: null as any, isLoading: false };
jest.mock('hooks/use-auth-context', () => ({
  useAuthContext: () => mockAuthContext,
}));

const mockOnboarding = {
  data: { intent: null as 'poster' | 'hunter' | null },
  loading: false,
};
jest.mock('lib/context/onboarding-context', () => ({
  useOnboarding: () => mockOnboarding,
}));

const mockTrackOnboardingEntry = jest.fn().mockResolvedValue(undefined);
jest.mock('lib/analytics/onboarding-entry', () => ({
  ...jest.requireActual('lib/analytics/onboarding-entry'),
  trackOnboardingEntry: (...args: unknown[]) => mockTrackOnboardingEntry(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { OnboardingEntryTracker } = require('../../../components/onboarding/OnboardingEntryTracker');

const SIGNED_IN = { user: { id: 'user-abc' } };

beforeEach(() => {
  mockTrackOnboardingEntry.mockClear();
  mockPathname = '/onboarding';
  mockAuthContext.session = null;
  mockAuthContext.isLoading = false;
  mockOnboarding.data.intent = null;
  mockOnboarding.loading = false;
});

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe('OnboardingEntryTracker', () => {
  it('records a first-time visitor routed straight to Welcome by the root gate', async () => {
    mockPathname = '/onboarding/welcome';

    render(<OnboardingEntryTracker />);

    await waitFor(() =>
      expect(mockTrackOnboardingEntry).toHaveBeenCalledWith({ step: 'welcome', userId: null, intent: null })
    );
  });

  it('records a new account that sign-up sends straight to the style step', async () => {
    mockPathname = '/onboarding/style';
    mockAuthContext.session = SIGNED_IN;

    render(<OnboardingEntryTracker />);

    await waitFor(() =>
      expect(mockTrackOnboardingEntry).toHaveBeenCalledWith({ step: 'style', userId: 'user-abc', intent: null })
    );
  });

  it('records a signed-in poster resumed at the poster profile step, with the intent', async () => {
    mockPathname = '/onboarding/poster-profile';
    mockAuthContext.session = SIGNED_IN;
    mockOnboarding.data.intent = 'poster';

    render(<OnboardingEntryTracker />);

    await waitFor(() =>
      expect(mockTrackOnboardingEntry).toHaveBeenCalledWith({
        step: 'poster-profile',
        userId: 'user-abc',
        intent: 'poster',
      })
    );
  });

  it('records a signed-in hunter resumed at payout setup, with the intent', async () => {
    mockPathname = '/onboarding/payouts';
    mockAuthContext.session = SIGNED_IN;
    mockOnboarding.data.intent = 'hunter';

    render(<OnboardingEntryTracker />);

    await waitFor(() =>
      expect(mockTrackOnboardingEntry).toHaveBeenCalledWith({ step: 'payouts', userId: 'user-abc', intent: 'hunter' })
    );
  });

  it('records nothing on the /onboarding gate, which may still send an onboarded user to the app', async () => {
    mockPathname = '/onboarding';
    mockAuthContext.session = SIGNED_IN;

    render(<OnboardingEntryTracker />);
    await settle();

    expect(mockTrackOnboardingEntry).not.toHaveBeenCalled();
  });

  it('records nothing for a signed-in user bounced off Welcome, then records the step they reach', async () => {
    mockPathname = '/onboarding/welcome';
    mockAuthContext.session = SIGNED_IN;

    const view = render(<OnboardingEntryTracker />);
    await settle();
    expect(mockTrackOnboardingEntry).not.toHaveBeenCalled();

    mockPathname = '/onboarding/style';
    view.rerender(<OnboardingEntryTracker />);

    await waitFor(() => expect(mockTrackOnboardingEntry).toHaveBeenCalledTimes(1));
    expect(mockTrackOnboardingEntry).toHaveBeenCalledWith({ step: 'style', userId: 'user-abc', intent: null });
  });

  it('waits for auth and the onboarding draft before deciding', async () => {
    mockPathname = '/onboarding/style';
    mockAuthContext.isLoading = true;
    mockOnboarding.loading = true;

    const view = render(<OnboardingEntryTracker />);
    await settle();
    expect(mockTrackOnboardingEntry).not.toHaveBeenCalled();

    mockAuthContext.isLoading = false;
    mockAuthContext.session = SIGNED_IN;
    mockOnboarding.loading = false;
    view.rerender(<OnboardingEntryTracker />);

    await waitFor(() =>
      expect(mockTrackOnboardingEntry).toHaveBeenCalledWith({ step: 'style', userId: 'user-abc', intent: null })
    );
  });

  it('records once per mount across rerenders and step-to-step navigation', async () => {
    mockPathname = '/onboarding/welcome';
    const view = render(<OnboardingEntryTracker />);
    await waitFor(() => expect(mockTrackOnboardingEntry).toHaveBeenCalledTimes(1));

    view.rerender(<OnboardingEntryTracker />);
    mockPathname = '/onboarding/username';
    view.rerender(<OnboardingEntryTracker />);
    mockAuthContext.session = SIGNED_IN;
    mockPathname = '/onboarding/style';
    view.rerender(<OnboardingEntryTracker />);
    mockOnboarding.data.intent = 'hunter';
    view.rerender(<OnboardingEntryTracker />);
    await settle();

    expect(mockTrackOnboardingEntry).toHaveBeenCalledTimes(1);
  });

  it('records nothing outside onboarding', async () => {
    mockPathname = '/tabs/bounty-app';
    mockAuthContext.session = SIGNED_IN;

    render(<OnboardingEntryTracker />);
    await settle();

    expect(mockTrackOnboardingEntry).not.toHaveBeenCalled();
  });
});
