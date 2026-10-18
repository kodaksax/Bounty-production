/**
 * Root auth gate (app/index.tsx): where a signed-in, onboarded user lands on
 * a cold start. They reopen the tab they last left (within the restore
 * window), otherwise the feed, and a later re-run of the gate must never move
 * them off the tab they are on now.
 */

import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockReplace = jest.fn();
let mockSearchParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockSearchParams,
}));

let mockBootstrap: any = { status: 'authenticated', onboardingComplete: true };
jest.mock('../../hooks/useAppBootstrap', () => ({
  useAppBootstrap: () => mockBootstrap,
}));

let mockAuth: any;
jest.mock('../../hooks/use-auth-context', () => ({
  useAuthContext: () => mockAuth,
}));

const mockGetRestorableLastScreen = jest.fn();
jest.mock('../../lib/storage/last-screen', () => ({
  getRestorableLastScreen: (...args: any[]) => mockGetRestorableLastScreen(...args),
}));

jest.mock('../../lib/storage/onboarding', () => ({
  hasDeviceSignedInBefore: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../lib/utils/auth-diagnostics', () => ({
  logAuthLifecycleEvent: jest.fn(),
}));
jest.mock('../../app/auth/sign-in-form', () => ({ SignInForm: () => null }));
jest.mock('../../app/initial-navigation/initialNavigation', () => ({
  markInitialNavigationDone: jest.fn(),
}));

const Index = require('../../app/index').default;

describe('root auth gate — resume last tab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = {};
    mockBootstrap = { status: 'authenticated', onboardingComplete: true };
    mockAuth = {
      session: { user: { id: 'user-1' } },
      isPasswordRecovery: false,
      accountBlockedReason: null,
      environmentError: false,
      isAuthStale: false,
      attemptRefresh: jest.fn(),
    };
  });

  it('reopens the tab the user last left', async () => {
    mockGetRestorableLastScreen.mockResolvedValue('wallet');
    render(<Index />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app?screen=wallet')
    );
    expect(mockGetRestorableLastScreen).toHaveBeenCalledWith('user-1');
  });

  it('lands on the feed when there is nothing to restore', async () => {
    mockGetRestorableLastScreen.mockResolvedValue(null);
    render(<Index />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app'));
  });

  it('honours a redirect_to deep link over the remembered tab', async () => {
    mockSearchParams = { redirect_to: '/tabs/postings-screen' };
    mockGetRestorableLastScreen.mockResolvedValue('wallet');
    render(<Index />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/tabs/postings-screen'));
    expect(mockGetRestorableLastScreen).not.toHaveBeenCalled();
  });

  it('sends an un-onboarded user to onboarding, not a remembered tab', async () => {
    mockBootstrap = { status: 'authenticated', onboardingComplete: false };
    render(<Index />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/onboarding'));
    expect(mockGetRestorableLastScreen).not.toHaveBeenCalled();
  });

  it('does not re-route when the gate re-runs after the user has moved on', async () => {
    mockGetRestorableLastScreen.mockResolvedValue('wallet');
    const { rerender } = render(<Index />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

    // The user has since switched to Profile (saved), and a stale/recovered
    // connection flips isAuthStale, re-running the gate effect.
    mockGetRestorableLastScreen.mockResolvedValue('profile');
    mockAuth = { ...mockAuth, isAuthStale: true };
    rerender(<Index />);
    mockAuth = { ...mockAuth, isAuthStale: false };
    rerender(<Index />);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockGetRestorableLastScreen).toHaveBeenCalledTimes(1);
  });
});
